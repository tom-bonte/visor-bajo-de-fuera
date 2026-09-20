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
const { getDayQuota, MAX_BOAT_CAP, EMAIL_MAP, USER_CENTER_KEYS, CENTERS, BDF_COLLECTIONS } = require('../../config.js');
const {
    addPlazasToSalidas, removeSalidaFromList, sumSalidasPlazas,
    syncAllocationsFromSalidas
} = require('../../bdf-logic.js');

const FIREBASE_API_KEY = 'AIzaSyBe7X5AUC-PpcJSCYgMzyyUMJMPqxtTdiw';
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
    const nuevas = parseInt(body.pax, 10);
    if (!validDate(dateStr)) return respond(400, { error: 'Fecha no válida.' });
    if (!Number.isInteger(nuevas) || nuevas <= 0 || nuevas > MAX_BOAT_CAP) {
        return respond(400, { error: `Introduce un número de plazas entre 1 y ${MAX_BOAT_CAP}.` });
    }
    // Cambiar una salida de centro sólo lo puede hacer el administrador.
    const nuevoCentro = body.newCenterCode ? normCenter(body.newCenterCode) : null;
    if (nuevoCentro && !quien.isAdmin) {
        return respond(403, { error: 'Sólo el administrador puede cambiar una salida de centro.' });
    }
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
        if (nuevoCentro && nuevoCentro !== normCenter(objetivo.centerCode)) {
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

    if (fallo) return respond(409, { error: fallo });
    if (!resultado.ok) return respond(409, { error: 'Otro centro ha cambiado ese día a la vez. Vuelve a intentarlo.', detalle: resultado.detail });
    return respond(200, { ok: true });
}

const OPERACIONES = {
    addSalida: opAddSalida,
    editSalida: opEditSalida,
    deleteSalida: opDeleteSalida
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
