/**
 * @file netlify/functions/bdf-write.js
 * @description Único camino por el que se modifican las plazas de Bajo de Fuera.
 *
 * El problema que resuelve: las reglas de Firestore pueden comprobar que un día
 * queda VÁLIDO (ocho escuelas como mucho, números sensatos, nunca más de 30
 * plazas), pero no pueden comprobar DE QUIÉN son las plazas que has tocado, y
 * eso es precisamente lo que hay que impedir. No es un descuido de las reglas:
 * un intercambio modifica legítimamente los registros de dos escuelas en la
 * misma escritura, así que "sólo puedes tocar lo tuyo" sería mentira la mitad
 * de las veces.
 *
 * Aquí sí se puede comprobar: el servidor sabe quién eres (por tu token de
 * sesión), vuelve a leer el día tal y como está en ese instante, aplica la
 * misma aritmética que usa la app y escribe con una condición previa, de forma
 * que si otra escuela ha tocado el día entre medias no se escribe nada y se
 * vuelve a empezar.
 *
 * Variables de entorno: FIREBASE_SERVICE_ACCOUNT (ver lib/firestore-admin.js).
 */
const admin = require('./lib/firestore-admin');
const { normCenter } = require('../../utils.js');
const { getDayQuota, MAX_BOAT_CAP, EMAIL_MAP, USER_CENTER_KEYS, CENTERS, BDF_COLLECTIONS, firebaseConfig } = require('../../config.js');
const {
    addPlazasToSalidas, removeSalidaFromList, sumSalidasPlazas,
    syncAllocationsFromSalidas, applySwapToSalidas, applyTransferToSalidas
} = require('../../bdf-logic.js');

// Identificador público del proyecto: se toma de config.js en lugar de
// repetirlo aquí. Además de no duplicarlo, así este fichero no contiene
// ninguna cadena con forma de clave de Google, que es lo que hace fallar al
// escáner de secretos de Netlify al desplegar.
const FIREBASE_API_KEY = firebaseConfig.apiKey;
const VERIFY_URL = 'https://identitytoolkit.googleapis.com/v1/accounts:lookup';
const ADMIN_EMAIL = 'admin@visor.local';
const MAX_NOTE = 200;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function respond(statusCode, payload) {
    return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) };
}

/** Quién llama: se comprueba contra Google, no se cree lo que diga el cliente. */
async function identify(idToken) {
    const res = await fetch(`${VERIFY_URL}?key=${encodeURIComponent(FIREBASE_API_KEY)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken })
    });
    if (!res.ok) return null;
    const data = await res.json();
    const email = ((data.users && data.users[0] && data.users[0].email) || '').toLowerCase();
    if (!email) return null;

    const userKey = Object.keys(EMAIL_MAP).find(k => EMAIL_MAP[k] === email);
    if (!userKey) return null;
    return {
        email,
        userKey,
        isAdmin: email === ADMIN_EMAIL,
        center: USER_CENTER_KEYS[userKey] || null   // el admin no tiene centro propio
    };
}

/** El centro sobre el que se actúa, comprobando que se tiene derecho a hacerlo. */
function targetCenter(quien, pedido) {
    const code = normCenter(pedido || quien.center || '');
    if (!code || !CENTERS[code]) return { error: 'Centro desconocido.' };
    if (!quien.isAdmin && code !== quien.center) {
        return { error: 'Sólo puedes gestionar las plazas de tu propio centro.' };
    }
    return { code };
}

/**
 * Fecha real, no sólo con la forma correcta. '2026-02-31' pasa el formato y
 * JavaScript la convierte alegremente en el 3 de marzo: eso escribiría plazas
 * en un día que nadie ha pedido.
 */
function validDate(dateStr) {
    if (typeof dateStr !== 'string' || !DATE_RE.test(dateStr)) return false;
    const [a, m, d] = dateStr.split('-').map(Number);
    const fecha = new Date(a, m - 1, d);
    return fecha.getFullYear() === a && fecha.getMonth() === m - 1 && fecha.getDate() === d;
}

function cleanNote(note) {
    return String(note || '').trim().slice(0, MAX_NOTE);
}

function nowStamp() {
    return { __timestamp: new Date().toISOString() };
}

/** Documento de día listo para escribir, recalculando siempre las allocations. */
function dayPayload(dateStr, cap, salidas) {
    return {
        date: dateStr,
        totalQuota: cap,
        salidas: salidas,
        allocations: syncAllocationsFromSalidas(salidas),
        updatedAt: nowStamp()
    };
}

function historyOp(actionType, centerKey, details) {
    return admin.createOp(BDF_COLLECTIONS.HISTORY, admin.newDocId(), {
        actionType,
        centerKey,
        details: details || {},
        timestamp: nowStamp()
    });
}

/**
 * Invariante de la reserva: un día nunca puede pasar de su cupo, y ninguna
 * escuela puede quedar con un número imposible. Se comprueba sobre el día ya
 * calculado, justo antes de escribirlo, con los datos recién leídos.
 */
function checkDay(dateStr, salidas, dayData) {
    const cap = getDayQuota(dateStr, dayData);
    const total = sumSalidasPlazas(salidas);
    if (total > cap) {
        return { error: `No caben: el día ${dateStr} admite ${cap} plazas y quedarían ${total}.` };
    }
    if (salidas.length > 8) {
        return { error: 'Un día no puede tener más de ocho escuelas.' };
    }
    for (const s of salidas) {
        const p = Number(s.plazas);
        if (!Number.isInteger(p) || p <= 0 || p > MAX_BOAT_CAP) {
            return { error: `Reparto imposible para ${s.centerCode}: ${s.plazas} plazas.` };
        }
        if (!CENTERS[normCenter(s.centerCode)]) {
            return { error: `Centro desconocido en el día: ${s.centerCode}.` };
        }
    }
    return { cap, total };
}

// =========================================================================
// OPERACIONES
// =========================================================================

async function opAddSalida(quien, body) {
    const { dateStr, note } = body;
    const pax = parseInt(body.pax, 10);
    if (!validDate(dateStr)) return respond(400, { error: 'Fecha no válida.' });
    if (!Number.isInteger(pax) || pax <= 0 || pax > MAX_BOAT_CAP) {
        return respond(400, { error: `Introduce un número de plazas entre 1 y ${MAX_BOAT_CAP}.` });
    }
    const centro = targetCenter(quien, body.centerCode);
    if (centro.error) return respond(403, { error: centro.error });

    let fallo = null;
    const resultado = await admin.runTransaction(async () => {
        const dia = await admin.readDoc(BDF_COLLECTIONS.DAYS, dateStr);
        const salidas = JSON.parse(JSON.stringify(dia.data.salidas || []));

        addPlazasToSalidas(salidas, dateStr, centro.code, pax, cleanNote(note));

        const revision = checkDay(dateStr, salidas, dia.data);
        if (revision.error) { fallo = revision.error; return null; }

        return [
            admin.writeOp(BDF_COLLECTIONS.DAYS, dateStr, dayPayload(dateStr, revision.cap, salidas), dia.updateTime),
            historyOp('add_salida', quien.userKey, { date: dateStr, center: centro.code, pax: pax })
        ];
    });

    if (fallo) return respond(409, { error: fallo });
    if (!resultado.ok) return respond(409, { error: 'Otro centro ha cambiado ese día a la vez. Vuelve a intentarlo.', detalle: resultado.detail });
    return respond(200, { ok: true });
}

async function opDeleteSalida(quien, body) {
    const { dateStr, salidaId } = body;
    if (!validDate(dateStr)) return respond(400, { error: 'Fecha no válida.' });
    const centro = targetCenter(quien, body.centerCode);
    if (centro.error) return respond(403, { error: centro.error });

    let fallo = null;
    const resultado = await admin.runTransaction(async () => {
        const dia = await admin.readDoc(BDF_COLLECTIONS.DAYS, dateStr);
        const salidas = JSON.parse(JSON.stringify(dia.data.salidas || []));

        // Sólo se puede borrar lo propio: se comprueba sobre el dato recién
        // leído, no sobre lo que el navegador diga que hay.
        const objetivo = salidas.find(s => s.id === salidaId) ||
                         salidas.find(s => normCenter(s.centerCode) === centro.code);
        if (!objetivo) { fallo = 'Esas plazas ya no existen.'; return null; }
        if (!quien.isAdmin && normCenter(objetivo.centerCode) !== quien.center) {
            fallo = 'Esas plazas son de otro centro.'; return null;
        }

        const tras = removeSalidaFromList(salidas, objetivo.id, normCenter(objetivo.centerCode));
        if (!tras.removed) { fallo = 'No se ha podido eliminar el registro.'; return null; }

        const revision = checkDay(dateStr, tras.salidas, dia.data);
        if (revision.error) { fallo = revision.error; return null; }

        return [
            admin.writeOp(BDF_COLLECTIONS.DAYS, dateStr, dayPayload(dateStr, revision.cap, tras.salidas), dia.updateTime),
            historyOp('delete_salida', quien.userKey, {
                date: dateStr, center: normCenter(objetivo.centerCode), pax: Number(objetivo.plazas) || 0
            })
        ];
    });

    if (fallo) return respond(409, { error: fallo });
    if (!resultado.ok) return respond(409, { error: 'Otro centro ha cambiado ese día a la vez. Vuelve a intentarlo.', detalle: resultado.detail });
    return respond(200, { ok: true });
}

async function opEditSalida(quien, body) {
    const { dateStr, salidaId, note } = body;
    let falloEstado = 409;
    const nuevas = parseInt(body.pax, 10);
    if (!validDate(dateStr)) return respond(400, { error: 'Fecha no válida.' });
    if (!Number.isInteger(nuevas) || nuevas <= 0 || nuevas > MAX_BOAT_CAP) {
        return respond(400, { error: `Introduce un número de plazas entre 1 y ${MAX_BOAT_CAP}.` });
    }
    // Cambiar una salida DE CENTRO sólo lo puede hacer el administrador. Ojo:
    // que venga un centro no significa que haya cambio; eso sólo se sabe al
    // comparar con el registro real, más abajo, dentro de la transacción.
    const nuevoCentro = body.newCenterCode ? normCenter(body.newCenterCode) : null;
    if (nuevoCentro && !CENTERS[nuevoCentro]) {
        return respond(400, { error: 'Centro desconocido.' });
    }

    let fallo = null;
    const resultado = await admin.runTransaction(async () => {
        const dia = await admin.readDoc(BDF_COLLECTIONS.DAYS, dateStr);
        const salidas = JSON.parse(JSON.stringify(dia.data.salidas || []));

        const objetivo = salidas.find(s => s.id === salidaId) ||
                         salidas.find(s => normCenter(s.centerCode) === normCenter(body.centerCode || quien.center));
        if (!objetivo) { fallo = 'Esas plazas ya no existen.'; return null; }
        if (!quien.isAdmin && normCenter(objetivo.centerCode) !== quien.center) {
            fallo = 'Esas plazas son de otro centro.'; return null;
        }

        const antes = Number(objetivo.plazas) || 0;
        const cambiaDeCentro = !!nuevoCentro && nuevoCentro !== normCenter(objetivo.centerCode);
        if (cambiaDeCentro && !quien.isAdmin) {
            fallo = 'Sólo el administrador puede cambiar una salida de centro.';
            falloEstado = 403;
            return null;
        }

        if (cambiaDeCentro) {
            // Mover el registro entero a otro centro: se quita de uno y se suma
            // al otro, para no dejar dos registros de la misma escuela.
            const tras = removeSalidaFromList(salidas, objetivo.id, normCenter(objetivo.centerCode));
            addPlazasToSalidas(tras.salidas, dateStr, nuevoCentro, nuevas, cleanNote(note));
            salidas.length = 0;
            tras.salidas.forEach(s => salidas.push(s));
        } else {
            objetivo.plazas = nuevas;
            objetivo.pax = nuevas;
            if (note !== undefined) objetivo.note = cleanNote(note);
            objetivo.updatedAt = new Date().toISOString();
        }

        const revision = checkDay(dateStr, salidas, dia.data);
        if (revision.error) { fallo = revision.error; return null; }

        return [
            admin.writeOp(BDF_COLLECTIONS.DAYS, dateStr, dayPayload(dateStr, revision.cap, salidas), dia.updateTime),
            historyOp('edit_salida', quien.userKey, {
                date: dateStr, center: nuevoCentro || normCenter(objetivo.centerCode), from: antes, to: nuevas
            })
        ];
    });

    if (fallo) return respond(falloEstado, { error: fallo });
    if (!resultado.ok) return respond(409, { error: 'Otro centro ha cambiado ese día a la vez. Vuelve a intentarlo.', detalle: resultado.detail });
    return respond(200, { ok: true });
}

/** Mover plazas propias de un día a otro (Section 2). */
async function opMoveSalida(quien, body) {
    const { sourceDate, targetDate, salidaId } = body;
    const pax = parseInt(body.pax, 10);
    if (!validDate(sourceDate) || !validDate(targetDate)) return respond(400, { error: 'Fecha no válida.' });
    if (sourceDate === targetDate) return respond(400, { error: 'El día de origen y el de destino son el mismo.' });
    if (!Number.isInteger(pax) || pax <= 0 || pax > MAX_BOAT_CAP) {
        return respond(400, { error: `Introduce un número de plazas entre 1 y ${MAX_BOAT_CAP}.` });
    }
    const centro = targetCenter(quien, body.centerCode);
    if (centro.error) return respond(403, { error: centro.error });

    let fallo = null;
    const resultado = await admin.runTransaction(async () => {
        const origen = await admin.readDoc(BDF_COLLECTIONS.DAYS, sourceDate);
        const destino = await admin.readDoc(BDF_COLLECTIONS.DAYS, targetDate);
        const salidasOrigen = JSON.parse(JSON.stringify(origen.data.salidas || []));
        const salidasDestino = JSON.parse(JSON.stringify(destino.data.salidas || []));

        const objetivo = salidasOrigen.find(s => s.id === salidaId) ||
                         salidasOrigen.find(s => normCenter(s.centerCode) === centro.code);
        if (!objetivo) { fallo = 'Esas plazas ya no existen en el día de origen.'; return null; }
        if (!quien.isAdmin && normCenter(objetivo.centerCode) !== quien.center) {
            fallo = 'Esas plazas son de otro centro.'; return null;
        }

        const disponibles = Number(objetivo.plazas) || 0;
        if (disponibles < pax) {
            fallo = `En el día de origen sólo hay ${disponibles} plazas y quieres mover ${pax}.`; return null;
        }

        const nota = (objetivo.note || '').trim();
        if (disponibles > pax) {
            objetivo.plazas = disponibles - pax;
            objetivo.pax = objetivo.plazas;
            objetivo.updatedAt = new Date().toISOString();
        } else {
            const tras = removeSalidaFromList(salidasOrigen, objetivo.id, normCenter(objetivo.centerCode));
            salidasOrigen.length = 0;
            tras.salidas.forEach(x => salidasOrigen.push(x));
        }
        addPlazasToSalidas(salidasDestino, targetDate, normCenter(objetivo.centerCode), pax, nota);

        const revOrigen = checkDay(sourceDate, salidasOrigen, origen.data);
        if (revOrigen.error) { fallo = revOrigen.error; return null; }
        const revDestino = checkDay(targetDate, salidasDestino, destino.data);
        if (revDestino.error) { fallo = revDestino.error; return null; }

        return [
            admin.writeOp(BDF_COLLECTIONS.DAYS, sourceDate, dayPayload(sourceDate, revOrigen.cap, salidasOrigen), origen.updateTime),
            admin.writeOp(BDF_COLLECTIONS.DAYS, targetDate, dayPayload(targetDate, revDestino.cap, salidasDestino), destino.updateTime),
            historyOp('move_salida', quien.userKey, {
                from: sourceDate, to: targetDate, center: normCenter(objetivo.centerCode), pax: pax
            })
        ];
    });

    if (fallo) return respond(409, { error: fallo });
    if (!resultado.ok) return respond(409, { error: 'Otro centro ha cambiado esos días a la vez. Vuelve a intentarlo.', detalle: resultado.detail });
    return respond(200, { ok: true });
}

/**
 * Ceder plazas a otra escuela el mismo día (Sections 3 y 3.1).
 * Sólo puede cederlas quien las tiene: por eso el cedente es siempre quien llama.
 */
async function opSpotTransfer(quien, body) {
    const { dateStr, toCenter, note, givingSalidaId } = body;
    const plazas = parseInt(body.spots, 10);
    if (!validDate(dateStr)) return respond(400, { error: 'Fecha no válida.' });
    if (!Number.isInteger(plazas) || plazas <= 0 || plazas > MAX_BOAT_CAP) {
        return respond(400, { error: 'Número de plazas no válido.' });
    }
    const cedente = targetCenter(quien, body.fromCenter);
    if (cedente.error) return respond(403, { error: cedente.error });

    const receptor = normCenter(toCenter);
    if (!CENTERS[receptor]) return respond(400, { error: 'Centro receptor desconocido.' });
    if (receptor === cedente.code) return respond(400, { error: 'No se pueden ceder plazas a uno mismo.' });

    const resultado = await aplicarCesion(quien, {
        dateStr, givingCenter: cedente.code, receivingCenter: receptor,
        spots: plazas, note: cleanNote(note), givingSalidaId: givingSalidaId || null,
        actionType: 'spot_transfer'
    });
    if (resultado.error) return respond(409, { error: resultado.error });
    return respond(200, { ok: true });
}

/**
 * Motor común de las cesiones: lo usan la cesión directa y la aceptación de una
 * petición de plazas. Una cesión MUEVE plazas; nunca puede crearlas ni perderlas,
 * y eso se comprueba antes de escribir.
 */
async function aplicarCesion(quien, opciones, escriturasExtra = () => []) {
    const { dateStr, givingCenter, receivingCenter, spots, note, givingSalidaId, actionType } = opciones;
    let fallo = null;

    const resultado = await admin.runTransaction(async () => {
        const dia = await admin.readDoc(BDF_COLLECTIONS.DAYS, dateStr);
        const salidas = JSON.parse(JSON.stringify(dia.data.salidas || []));
        const antes = sumSalidasPlazas(salidas);

        const aplicada = applyTransferToSalidas(salidas, {
            dateStr, normFrom: givingCenter, normTo: receivingCenter, givingSalidaId, spots, note
        });
        if (!aplicada) {
            fallo = `${CENTERS[givingCenter].name} ya no tiene esas plazas disponibles ese día.`;
            return null;
        }

        const despues = sumSalidasPlazas(salidas);
        if (despues !== antes) {
            fallo = `Integridad: la cesión alteraría el total de plazas del día (${antes} → ${despues}).`;
            return null;
        }

        const revision = checkDay(dateStr, salidas, dia.data);
        if (revision.error) { fallo = revision.error; return null; }

        return [
            admin.writeOp(BDF_COLLECTIONS.DAYS, dateStr, dayPayload(dateStr, revision.cap, salidas), dia.updateTime),
            historyOp(actionType, quien.userKey, {
                date: dateStr, fromCenter: givingCenter, toCenter: receivingCenter, spots: spots
            }),
            ...escriturasExtra()
        ];
    });

    if (fallo) return { error: fallo };
    if (!resultado.ok) return { error: 'Otro centro ha cambiado ese día a la vez. Vuelve a intentarlo.' };
    return { ok: true };
}

/** Proponer un intercambio o pedir plazas: siempre EN NOMBRE PROPIO. */
async function opCreateRequest(quien, body) {
    const datos = body.request || {};
    const tipo = datos.type;
    if (tipo !== 'swap' && tipo !== 'request') return respond(400, { error: 'Tipo de solicitud desconocido.' });

    const iniciador = normCenter(datos.initiatorCenter);
    const destinatario = normCenter(datos.targetCenter);
    if (!CENTERS[iniciador] || !CENTERS[destinatario]) return respond(400, { error: 'Centro desconocido.' });
    if (iniciador === destinatario) return respond(400, { error: 'No se puede negociar con uno mismo.' });

    // La suplantación era posible hasta ahora: crear una solicitud a nombre de
    // otra escuela disparaba un aviso de WhatsApp firmado por ella.
    if (!quien.isAdmin && iniciador !== quien.center) {
        return respond(403, { error: 'Sólo puedes proponer en nombre de tu propio centro.' });
    }

    const limpio = { type: tipo, initiatorCenter: iniciador, targetCenter: destinatario, status: 'pending', createdAt: nowStamp() };

    if (tipo === 'swap') {
        for (const campo of ['dateA', 'dateB']) {
            if (!validDate(datos[campo])) return respond(400, { error: 'Fecha no válida en la propuesta.' });
            limpio[campo] = datos[campo];
        }
        for (const campo of ['paxA', 'retainedPaxA', 'paxB', 'retainedPaxB']) {
            const n = parseInt(datos[campo], 10);
            if (!Number.isInteger(n) || n < 0 || n > MAX_BOAT_CAP) return respond(400, { error: 'Reparto de plazas no válido.' });
            limpio[campo] = n;
        }
        limpio.centerA = normCenter(datos.centerA);
        limpio.centerB = normCenter(datos.centerB);
        if (!CENTERS[limpio.centerA] || !CENTERS[limpio.centerB]) return respond(400, { error: 'Centro desconocido en la propuesta.' });
        limpio.salidaIdA = String(datos.salidaIdA || '');
        limpio.salidaIdB = String(datos.salidaIdB || '');
    } else {
        if (!validDate(datos.date)) return respond(400, { error: 'Fecha no válida en la petición.' });
        const n = parseInt(datos.requestedPax, 10);
        if (!Number.isInteger(n) || n <= 0 || n > MAX_BOAT_CAP) return respond(400, { error: 'Número de plazas no válido.' });
        limpio.date = datos.date;
        limpio.requestedPax = n;
        limpio.isFull = !!datos.isFull;
        limpio.targetSalidaId = String(datos.targetSalidaId || '');
    }

    const id = admin.newDocId();
    const resultado = await admin.runTransaction(async () => [
        admin.createOp(BDF_COLLECTIONS.REQUESTS, id, limpio),
        historyOp(tipo === 'swap' ? 'swap_request' : 'petition', quien.userKey, {
            initiatorCenter: iniciador, targetCenter: destinatario, date: limpio.date || limpio.dateA
        })
    ]);
    if (!resultado.ok) return respond(409, { error: 'No se ha podido registrar la propuesta.' });
    return respond(200, { ok: true, id });
}

/** Sólo el destinatario (o el admin) acepta. Aquí se aplica el acuerdo. */
async function opAcceptRequest(quien, body) {
    const requestId = String(body.requestId || '');
    if (!requestId) return respond(400, { error: 'Falta la solicitud.' });

    const peticion = await admin.readDoc(BDF_COLLECTIONS.REQUESTS, requestId);
    if (!peticion.exists) return respond(409, { error: 'Esa solicitud ya no existe.' });
    const req = peticion.data;
    if (req.status && req.status !== 'pending') return respond(409, { error: 'Esa solicitud ya estaba resuelta.' });
    if (!quien.isAdmin && normCenter(req.targetCenter) !== quien.center) {
        return respond(403, { error: 'Sólo el centro destinatario puede aceptar esta solicitud.' });
    }

    const borrarPeticion = () => [admin.deleteOp(BDF_COLLECTIONS.REQUESTS, requestId, peticion.updateTime)];

    if (req.type === 'request') {
        // Cede quien recibió la petición; recibe quien la hizo.
        const resultado = await aplicarCesion(quien, {
            dateStr: req.date,
            givingCenter: normCenter(req.targetCenter),
            receivingCenter: normCenter(req.initiatorCenter),
            spots: Number(req.requestedPax) || 0,
            note: cleanNote(req.note),
            givingSalidaId: req.targetSalidaId || null,
            actionType: 'accept_petition'
        }, borrarPeticion);
        if (resultado.error) return respond(409, { error: resultado.error });
        return respond(200, { ok: true });
    }

    if (req.type !== 'swap') return respond(400, { error: 'Tipo de solicitud desconocido.' });

    let fallo = null;
    const resultado = await admin.runTransaction(async () => {
        const diaA = await admin.readDoc(BDF_COLLECTIONS.DAYS, req.dateA);
        const diaB = await admin.readDoc(BDF_COLLECTIONS.DAYS, req.dateB);
        const salidasA = JSON.parse(JSON.stringify(diaA.data.salidas || []));
        const salidasB = JSON.parse(JSON.stringify(diaB.data.salidas || []));
        const antes = sumSalidasPlazas(salidasA) + sumSalidasPlazas(salidasB);

        applySwapToSalidas(salidasA, salidasB, {
            normA: normCenter(req.centerA), normB: normCenter(req.centerB),
            salidaIdA: req.salidaIdA, salidaIdB: req.salidaIdB,
            dateA: req.dateA, dateB: req.dateB,
            safePaxA: Number(req.paxA) || 0, retainedPaxA: Number(req.retainedPaxA) || 0,
            safePaxB: Number(req.paxB) || 0, retainedPaxB: Number(req.retainedPaxB) || 0
        });

        // Un intercambio mueve plazas entre dos días: el total de los dos no cambia.
        const despues = sumSalidasPlazas(salidasA) + sumSalidasPlazas(salidasB);
        if (despues !== antes) {
            fallo = `Integridad: el intercambio alteraría el total de plazas (${antes} → ${despues}).`;
            return null;
        }

        const revA = checkDay(req.dateA, salidasA, diaA.data);
        if (revA.error) { fallo = revA.error; return null; }
        const revB = checkDay(req.dateB, salidasB, diaB.data);
        if (revB.error) { fallo = revB.error; return null; }

        return [
            admin.writeOp(BDF_COLLECTIONS.DAYS, req.dateA, dayPayload(req.dateA, revA.cap, salidasA), diaA.updateTime),
            admin.writeOp(BDF_COLLECTIONS.DAYS, req.dateB, dayPayload(req.dateB, revB.cap, salidasB), diaB.updateTime),
            historyOp('accept_swap', quien.userKey, {
                dateA: req.dateA, dateB: req.dateB,
                centerA: normCenter(req.centerA), centerB: normCenter(req.centerB),
                paxA: Number(req.paxA) || 0, paxB: Number(req.paxB) || 0
            }),
            ...borrarPeticion()
        ];
    });

    if (fallo) return respond(409, { error: fallo });
    if (!resultado.ok) return respond(409, { error: 'Alguien ha cambiado esos días a la vez. Vuelve a intentarlo.', detalle: resultado.detail });
    return respond(200, { ok: true });
}

/** Retirar una propuesta propia. */
async function opCancelRequest(quien, body) {
    return await cerrarPeticion(quien, body, 'initiatorCenter', 'cancel_request',
        'Sólo el centro que la propuso puede retirarla.');
}

/** Rechazar una propuesta recibida. */
async function opRejectRequest(quien, body) {
    return await cerrarPeticion(quien, body, 'targetCenter', 'reject_request',
        'Sólo el centro destinatario puede rechazarla.');
}

async function cerrarPeticion(quien, body, campoPermitido, actionType, mensajeProhibido) {
    const requestId = String(body.requestId || '');
    if (!requestId) return respond(400, { error: 'Falta la solicitud.' });

    const peticion = await admin.readDoc(BDF_COLLECTIONS.REQUESTS, requestId);
    if (!peticion.exists) return respond(200, { ok: true, yaNoExistia: true });

    const req = peticion.data;
    if (!quien.isAdmin && normCenter(req[campoPermitido]) !== quien.center) {
        return respond(403, { error: mensajeProhibido });
    }

    const resultado = await admin.runTransaction(async () => [
        admin.deleteOp(BDF_COLLECTIONS.REQUESTS, requestId, peticion.updateTime),
        historyOp(actionType, quien.userKey, {
            initiatorCenter: normCenter(req.initiatorCenter),
            targetCenter: normCenter(req.targetCenter),
            date: req.date || req.dateA || ''
        })
    ]);
    if (!resultado.ok) return respond(409, { error: 'No se ha podido cerrar la solicitud. Vuelve a intentarlo.' });
    return respond(200, { ok: true });
}

const OPERACIONES = {
    addSalida: opAddSalida,
    editSalida: opEditSalida,
    deleteSalida: opDeleteSalida,
    moveSalida: opMoveSalida,
    spotTransfer: opSpotTransfer,
    createRequest: opCreateRequest,
    acceptRequest: opAcceptRequest,
    cancelRequest: opCancelRequest,
    rejectRequest: opRejectRequest
};

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') return respond(405, { error: 'Método no permitido.' });

    const headers = event.headers || {};
    const rawAuth = headers.authorization || headers.Authorization || '';
    const idToken = rawAuth.startsWith('Bearer ') ? rawAuth.slice(7).trim() : '';
    if (!idToken) return respond(401, { error: 'Falta el token de sesión.' });

    let body;
    try {
        body = JSON.parse(event.body || '{}');
    } catch (e) {
        return respond(400, { error: 'Cuerpo de la petición no válido.' });
    }

    const operacion = OPERACIONES[body.op];
    if (!operacion) return respond(400, { error: 'Operación desconocida.' });

    let quien;
    try {
        quien = await identify(idToken);
    } catch (e) {
        console.error('[bdf-write] Error verificando el token:', e);
        return respond(502, { error: 'No se pudo verificar la sesión.' });
    }
    if (!quien) return respond(401, { error: 'Sesión no válida o caducada.' });

    try {
        return await operacion(quien, body);
    } catch (e) {
        console.error(`[bdf-write] ${body.op} ha fallado:`, e);
        return respond(500, { error: 'No se ha podido guardar el cambio.' });
    }
};

// Para los tests
exports._internals = { identify, targetCenter, checkDay, validDate, cleanNote, OPERACIONES };
