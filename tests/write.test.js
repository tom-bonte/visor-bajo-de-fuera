/**
 * Tests de la función que escribe las plazas (netlify/functions/bdf-write.js).
 *
 * Es la pieza que sustituye a "la escuela escribe directamente en la base de
 * datos", así que lo que se comprueba aquí no es que funcione el camino feliz,
 * sino que NO funcionen los caminos que hoy están abiertos: tocar las plazas de
 * otra escuela, pasarse del cupo, o hacerse pasar por otro.
 *
 * No hay red: se sustituyen la lectura, la escritura y la comprobación del
 * token, de modo que el test ejercita las decisiones reales de la función.
 */
const path = require('path');

// Credenciales de mentira: la función necesita saber el proyecto para componer
// las rutas de los documentos, pero en estos tests nunca se firma nada ni se
// sale a la red.
process.env.FIREBASE_SERVICE_ACCOUNT = process.env.FIREBASE_SERVICE_ACCOUNT || JSON.stringify({
    client_email: 'pruebas@ejemplo.iam.gserviceaccount.com',
    private_key: '-----BEGIN PRIVATE KEY-----\nficticia\n-----END PRIVATE KEY-----\n',
    project_id: 'reserva-marina-cdp'
});
const { section, check, ok, report } = require('./assert');

const RUTA_ADMIN = path.join(__dirname, '..', 'netlify', 'functions', 'lib', 'firestore-admin.js');
const RUTA_FUNCION = path.join(__dirname, '..', 'netlify', 'functions', 'bdf-write.js');

const admin = require(RUTA_ADMIN);
const funcion = require(RUTA_FUNCION);

// -------------------------------------------------------------------------
// Banco de pruebas: una base de datos de mentira y un Google de mentira.
// -------------------------------------------------------------------------
let dbDia = null;          // lo que devuelve la lectura del día
let commitsHechos = [];    // lo que se ha intentado escribir
let commitDevuelve = { ok: true };
let sesion = 'moondive@visor.local';

// Días y solicitudes adicionales para las operaciones de dos documentos.
let dbExtra = {};   // { 'bdf_days/2026-07-15': {...}, 'bdf_requests/r1': {...} }

admin.readDoc = async (coleccion, docId) => {
    const clave = `${coleccion}/${docId}`;
    if (Object.prototype.hasOwnProperty.call(dbExtra, clave)) {
        const valor = dbExtra[clave];
        if (!valor) return { exists: false, data: {}, updateTime: null };
        return { exists: true, data: JSON.parse(JSON.stringify(valor)), updateTime: '2026-09-20T10:00:00.000000Z' };
    }
    if (coleccion !== 'bdf_days') return { exists: false, data: {}, updateTime: null };
    if (!dbDia) return { exists: false, data: {}, updateTime: null };
    return { exists: true, data: JSON.parse(JSON.stringify(dbDia)), updateTime: '2026-09-20T10:00:00.000000Z' };
};
admin.commit = async (writes) => {
    commitsHechos.push(writes);
    return commitDevuelve;
};

global.fetch = async () => ({
    ok: sesion !== null,
    json: async () => ({ users: [{ email: sesion }] })
});

function prepara(salidas, quien = 'moondive@visor.local') {
    dbDia = salidas === null ? null : { date: '2026-07-14', totalQuota: 30, salidas: salidas };
    dbExtra = {};
    commitsHechos = [];
    commitDevuelve = { ok: true };
    sesion = quien;
}

/** Un día concreto de la base de datos de mentira. */
function pon(fecha, salidas) {
    dbExtra[`bdf_days/${fecha}`] = { date: fecha, salidas: salidas };
}

/** Una solicitud pendiente. */
function ponSolicitud(id, datos) {
    dbExtra[`bdf_requests/${id}`] = { status: 'pending', ...datos };
}

/** Las salidas escritas para una fecha concreta. */
function salidasDe(fecha) {
    const ultimo = commitsHechos[commitsHechos.length - 1] || [];
    const doc = ultimo.find(w => w.update && w.update.name.endsWith(`bdf_days/${fecha}`));
    if (!doc) return null;
    return (doc.update.fields.salidas.arrayValue.values || []).map(v => ({
        centro: v.mapValue.fields.centerCode.stringValue,
        plazas: Number(v.mapValue.fields.plazas.integerValue)
    }));
}

/** ¿Se ha borrado la solicitud en la misma operación? */
function solicitudBorrada(id) {
    const ultimo = commitsHechos[commitsHechos.length - 1] || [];
    return ultimo.some(w => w.delete && w.delete.endsWith(`bdf_requests/${id}`));
}

async function llama(body, opciones = {}) {
    const res = await funcion.handler({
        httpMethod: opciones.metodo || 'POST',
        headers: opciones.sinToken ? {} : { authorization: 'Bearer token-de-prueba' },
        body: JSON.stringify(body)
    });
    return { estado: res.statusCode, cuerpo: JSON.parse(res.body) };
}

/** Las salidas tal y como habrían quedado escritas en el día. */
function salidasEscritas() {
    if (commitsHechos.length === 0) return null;
    const ultimo = commitsHechos[commitsHechos.length - 1];
    const dia = ultimo.find(w => w.update && w.update.name.includes('bdf_days'));
    if (!dia) return null;
    return (dia.update.fields.salidas.arrayValue.values || []).map(v => ({
        centro: v.mapValue.fields.centerCode.stringValue,
        plazas: Number(v.mapValue.fields.plazas.integerValue)
    }));
}

(async () => {

// -------------------------------------------------------------------------
section('Una escuela sólo toca lo suyo');

prepara([{ id: 's1', centerCode: 'MD', plazas: 10, pax: 10 }, { id: 's2', centerCode: 'M', plazas: 8, pax: 8 }]);
let r = await llama({ op: 'addSalida', dateStr: '2026-07-14', pax: 4 });
check('Moondive añade a su propio centro', r.estado, 200);
check('y el día queda como debe', salidasEscritas(), [{ centro: 'MD', plazas: 14 }, { centro: 'M', plazas: 8 }]);

prepara([{ id: 's1', centerCode: 'MD', plazas: 10, pax: 10 }, { id: 's2', centerCode: 'M', plazas: 8, pax: 8 }]);
r = await llama({ op: 'addSalida', dateStr: '2026-07-14', pax: 4, centerCode: 'M' });
check('Moondive NO puede añadir en nombre de Mangamar', r.estado, 403);
check('y no se ha escrito nada', commitsHechos.length, 0);

prepara([{ id: 's1', centerCode: 'MD', plazas: 10, pax: 10 }, { id: 's2', centerCode: 'M', plazas: 8, pax: 8 }]);
r = await llama({ op: 'deleteSalida', dateStr: '2026-07-14', salidaId: 's2', centerCode: 'M' });
check('Moondive NO puede borrar la salida de Mangamar', r.estado, 403);
check('tampoco se ha escrito nada', commitsHechos.length, 0);

// El caso importante: pedir el borrado de otra escuela diciendo que es tuyo.
prepara([{ id: 's1', centerCode: 'MD', plazas: 10, pax: 10 }, { id: 's2', centerCode: 'M', plazas: 8, pax: 8 }]);
r = await llama({ op: 'deleteSalida', dateStr: '2026-07-14', salidaId: 's2', centerCode: 'MD' });
check('ni mintiendo sobre el centro: se mira el dato real', r.estado, 409);
ok('y lo dice claro', /otro centro/i.test(r.cuerpo.error));
check('sigue sin escribirse nada', commitsHechos.length, 0);

prepara([{ id: 's1', centerCode: 'MD', plazas: 10, pax: 10 }, { id: 's2', centerCode: 'M', plazas: 8, pax: 8 }]);
r = await llama({ op: 'editSalida', dateStr: '2026-07-14', salidaId: 's2', pax: 1 });
check('tampoco puede encoger las plazas de otro', r.estado, 409);

prepara([{ id: 's1', centerCode: 'MD', plazas: 10, pax: 10 }]);
r = await llama({ op: 'deleteSalida', dateStr: '2026-07-14', salidaId: 's1' });
check('borrar lo propio sí', r.estado, 200);
check('el día se queda vacío', salidasEscritas(), []);

// -------------------------------------------------------------------------
section('El cupo del día es infranqueable');

prepara([{ id: 's1', centerCode: 'M', plazas: 8, pax: 8 }]);
r = await llama({ op: 'addSalida', dateStr: '2026-07-14', pax: 25 });
check('30 plazas en julio: 8 + 25 no caben', r.estado, 409);
ok('y explica cuántas caben', /admite 30/.test(r.cuerpo.error));
check('nada escrito', commitsHechos.length, 0);

dbDia = { date: '2026-01-14', totalQuota: 13, salidas: [{ id: 's1', centerCode: 'M', plazas: 8, pax: 8 }] };
commitsHechos = [];
r = await llama({ op: 'addSalida', dateStr: '2026-01-14', pax: 6 });
check('13 plazas en enero: 8 + 6 tampoco', r.estado, 409);

dbDia = { date: '2026-01-14', totalQuota: 13, salidas: [{ id: 's1', centerCode: 'M', plazas: 8, pax: 8 }] };
commitsHechos = [];
r = await llama({ op: 'addSalida', dateStr: '2026-01-14', pax: 5 });
check('pero 8 + 5 = 13 sí', r.estado, 200);

// -------------------------------------------------------------------------
section('Números y fechas imposibles');

prepara([]);
check('cero plazas', (await llama({ op: 'addSalida', dateStr: '2026-07-14', pax: 0 })).estado, 400);
check('plazas negativas', (await llama({ op: 'addSalida', dateStr: '2026-07-14', pax: -5 })).estado, 400);
check('plazas de mentira', (await llama({ op: 'addSalida', dateStr: '2026-07-14', pax: 'diez' })).estado, 400);
check('más de un barco entero', (await llama({ op: 'addSalida', dateStr: '2026-07-14', pax: 31 })).estado, 400);
check('fecha con otro formato', (await llama({ op: 'addSalida', dateStr: '14/07/2026', pax: 5 })).estado, 400);
check('fecha inventada', (await llama({ op: 'addSalida', dateStr: '2026-02-31', pax: 5 })).estado, 400);
check('nada de esto llegó a escribirse', commitsHechos.length, 0);

// -------------------------------------------------------------------------
section('El administrador sí puede, las escuelas no');

prepara([{ id: 's1', centerCode: 'M', plazas: 8, pax: 8 }], 'admin@visor.local');
r = await llama({ op: 'addSalida', dateStr: '2026-07-14', pax: 5, centerCode: 'M' });
check('el admin añade en nombre de Mangamar', r.estado, 200);
check('y suma sobre lo que ya tenía', salidasEscritas(), [{ centro: 'M', plazas: 13 }]);

prepara([{ id: 's1', centerCode: 'M', plazas: 8, pax: 8 }], 'admin@visor.local');
r = await llama({ op: 'editSalida', dateStr: '2026-07-14', salidaId: 's1', pax: 8, newCenterCode: 'D' });
check('el admin puede cambiar una salida de centro', r.estado, 200);
check('y queda a nombre del nuevo', salidasEscritas(), [{ centro: 'D', plazas: 8 }]);

prepara([{ id: 's1', centerCode: 'MD', plazas: 8, pax: 8 }]);
r = await llama({ op: 'editSalida', dateStr: '2026-07-14', salidaId: 's1', pax: 8, newCenterCode: 'D' });
check('una escuela NO puede regalar su salida a otra por esta vía', r.estado, 403);

// -------------------------------------------------------------------------
section('Quién llama');

prepara([]);
check('sin token', (await llama({ op: 'addSalida', dateStr: '2026-07-14', pax: 5 }, { sinToken: true })).estado, 401);
check('por GET', (await llama({ op: 'addSalida', dateStr: '2026-07-14', pax: 5 }, { metodo: 'GET' })).estado, 405);
check('operación inventada', (await llama({ op: 'borrarlotodo', dateStr: '2026-07-14' })).estado, 400);

prepara([], null);
check('token que Google rechaza', (await llama({ op: 'addSalida', dateStr: '2026-07-14', pax: 5 })).estado, 401);

prepara([], 'intruso@otrodominio.com');
check('cuenta que no es de ningún centro', (await llama({ op: 'addSalida', dateStr: '2026-07-14', pax: 5 })).estado, 401);

// -------------------------------------------------------------------------
section('Si dos escuelas escriben a la vez');

prepara([{ id: 's1', centerCode: 'M', plazas: 8, pax: 8 }]);
commitDevuelve = { ok: false, conflict: true, detail: 'FAILED_PRECONDITION' };
r = await llama({ op: 'addSalida', dateStr: '2026-07-14', pax: 5 });
check('se reintenta varias veces', commitsHechos.length, 4);
check('y al final se avisa en vez de pisar', r.estado, 409);
ok('con un mensaje que se entiende', /a la vez/i.test(r.cuerpo.error));

// -------------------------------------------------------------------------
section('Lo que se escribe está completo y limpio');

prepara([]);
await llama({ op: 'addSalida', dateStr: '2026-07-14', pax: 6, note: '  nitrox  ' });
const ultimo = commitsHechos[commitsHechos.length - 1];
const dia = ultimo.find(w => w.update.name.includes('bdf_days'));
const historial = ultimo.find(w => w.update.name.includes('bdf_history_logs'));

ok('se escribe el día', !!dia);
ok('y el historial, en la misma operación', !!historial);
check('el historial dice quién ha sido', historial.update.fields.centerKey.stringValue, 'moondive');
check('y qué hizo', historial.update.fields.actionType.stringValue, 'add_salida');
ok('el día lleva su cupo', dia.update.fields.totalQuota.integerValue === '30');
ok('y las allocations recalculadas', !!dia.update.fields.allocations);
check('la nota va sin espacios sobrantes',
    dia.update.fields.salidas.arrayValue.values[0].mapValue.fields.note.stringValue, 'nitrox');
ok('el día existente se escribe sólo si nadie lo ha tocado', !!dia.currentDocument.updateTime);

// Un día que aún no existe en la base de datos.
prepara(null);
await llama({ op: 'addSalida', dateStr: '2026-07-14', pax: 6 });
const diaNuevo = commitsHechos[0].find(w => w.update.name.includes('bdf_days'));
check('un día nuevo se crea sólo si de verdad no existía', diaNuevo.currentDocument, { exists: false });

prepara([]);
await llama({ op: 'addSalida', dateStr: '2026-07-14', pax: 6, note: 'x'.repeat(500) });
const notaLarga = commitsHechos[0].find(w => w.update.name.includes('bdf_days'))
    .update.fields.salidas.arrayValue.values[0].mapValue.fields.note.stringValue;
check('una nota kilométrica se recorta', notaLarga.length, 200);


// -------------------------------------------------------------------------
section('Mover plazas propias de un día a otro');

prepara([]);
pon('2026-07-14', [{ id: 's1', centerCode: 'MD', plazas: 10, pax: 10 }]);
pon('2026-07-15', [{ id: 's2', centerCode: 'M', plazas: 6, pax: 6 }]);
r = await llama({ op: 'moveSalida', sourceDate: '2026-07-14', targetDate: '2026-07-15', salidaId: 's1', pax: 4 });
check('Moondive mueve 4 de sus 10 plazas', r.estado, 200);
check('el día de origen se queda con 6', salidasDe('2026-07-14'), [{ centro: 'MD', plazas: 6 }]);
check('y el de destino recibe las 4', salidasDe('2026-07-15'), [{ centro: 'M', plazas: 6 }, { centro: 'MD', plazas: 4 }]);

prepara([]);
pon('2026-07-14', [{ id: 's1', centerCode: 'M', plazas: 10, pax: 10 }]);
pon('2026-07-15', []);
r = await llama({ op: 'moveSalida', sourceDate: '2026-07-14', targetDate: '2026-07-15', salidaId: 's1', pax: 4 });
check('nadie mueve las plazas de otra escuela', r.estado, 409);
check('sin escribir nada', commitsHechos.length, 0);

prepara([]);
pon('2026-07-14', [{ id: 's1', centerCode: 'MD', plazas: 3, pax: 3 }]);
pon('2026-07-15', []);
r = await llama({ op: 'moveSalida', sourceDate: '2026-07-14', targetDate: '2026-07-15', salidaId: 's1', pax: 8 });
check('no se puede mover más de lo que se tiene', r.estado, 409);

prepara([]);
pon('2026-07-14', [{ id: 's1', centerCode: 'MD', plazas: 10, pax: 10 }]);
pon('2026-01-15', [{ id: 's2', centerCode: 'M', plazas: 11, pax: 11 }]);
r = await llama({ op: 'moveSalida', sourceDate: '2026-07-14', targetDate: '2026-01-15', salidaId: 's1', pax: 10 });
check('ni aunque quepan en origen, si no caben en destino', r.estado, 409);

prepara([]);
pon('2026-07-14', [{ id: 's1', centerCode: 'MD', plazas: 10, pax: 10 }]);
r = await llama({ op: 'moveSalida', sourceDate: '2026-07-14', targetDate: '2026-07-14', salidaId: 's1', pax: 4 });
check('mover a la misma fecha no tiene sentido', r.estado, 400);

// -------------------------------------------------------------------------
section('Ceder plazas a otra escuela');

prepara([{ id: 's1', centerCode: 'MD', plazas: 10, pax: 10 }, { id: 's2', centerCode: 'M', plazas: 8, pax: 8 }]);
r = await llama({ op: 'spotTransfer', dateStr: '2026-07-14', toCenter: 'M', spots: 4 });
check('Moondive cede 4 plazas a Mangamar', r.estado, 200);
check('el reparto cambia pero el total no', salidasEscritas(), [{ centro: 'MD', plazas: 6 }, { centro: 'M', plazas: 12 }]);

prepara([{ id: 's1', centerCode: 'MD', plazas: 10, pax: 10 }, { id: 's2', centerCode: 'M', plazas: 8, pax: 8 }]);
r = await llama({ op: 'spotTransfer', dateStr: '2026-07-14', fromCenter: 'M', toCenter: 'MD', spots: 8 });
check('nadie puede ceder EN NOMBRE de otra escuela', r.estado, 403);
ok('que es como robarle las plazas', /tu propio centro/i.test(r.cuerpo.error));
check('nada escrito', commitsHechos.length, 0);

prepara([{ id: 's1', centerCode: 'MD', plazas: 3, pax: 3 }]);
r = await llama({ op: 'spotTransfer', dateStr: '2026-07-14', toCenter: 'M', spots: 9 });
check('no se cede lo que no se tiene', r.estado, 409);

prepara([{ id: 's1', centerCode: 'MD', plazas: 10, pax: 10 }]);
r = await llama({ op: 'spotTransfer', dateStr: '2026-07-14', toCenter: 'MD', spots: 4 });
check('ni se cede uno a sí mismo', r.estado, 400);

prepara([{ id: 's1', centerCode: 'MD', plazas: 10, pax: 10 }]);
r = await llama({ op: 'spotTransfer', dateStr: '2026-07-14', toCenter: 'ZZ', spots: 4 });
check('ni a un centro que no existe', r.estado, 400);

// -------------------------------------------------------------------------
section('Proponer: siempre en nombre propio');

prepara([]);
r = await llama({ op: 'createRequest', request: {
    type: 'request', initiatorCenter: 'M', targetCenter: 'MD', date: '2026-07-14', requestedPax: 5
} });
check('no se puede proponer haciéndose pasar por otro', r.estado, 403);
check('y no queda registrada', commitsHechos.length, 0);

prepara([]);
r = await llama({ op: 'createRequest', request: {
    type: 'request', initiatorCenter: 'MD', targetCenter: 'M', date: '2026-07-14', requestedPax: 5
} });
check('en nombre propio sí', r.estado, 200);
const propuesta = commitsHechos[0].find(w => w.update.name.includes('bdf_requests'));
check('nace pendiente', propuesta.update.fields.status.stringValue, 'pending');
check('con el iniciador correcto', propuesta.update.fields.initiatorCenter.stringValue, 'MD');

prepara([]);
r = await llama({ op: 'createRequest', request: {
    type: 'request', initiatorCenter: 'MD', targetCenter: 'MD', date: '2026-07-14', requestedPax: 5
} });
check('no se negocia con uno mismo', r.estado, 400);

prepara([]);
r = await llama({ op: 'createRequest', request: {
    type: 'swap', initiatorCenter: 'MD', targetCenter: 'M',
    dateA: '2026-07-14', dateB: 'mañana', centerA: 'MD', centerB: 'M',
    paxA: 5, retainedPaxA: 0, paxB: 5, retainedPaxB: 0
} });
check('una fecha inventada tumba la propuesta', r.estado, 400);

// -------------------------------------------------------------------------
section('Aceptar: sólo el destinatario, y sin inventar plazas');

// Quien propuso no puede aceptar su propia propuesta.
prepara([{ id: 's1', centerCode: 'M', plazas: 10, pax: 10 }, { id: 's2', centerCode: 'MD', plazas: 5, pax: 5 }]);
ponSolicitud('r1', { type: 'request', initiatorCenter: 'MD', targetCenter: 'M', date: '2026-07-14', requestedPax: 4, targetSalidaId: 's1' });
r = await llama({ op: 'acceptRequest', requestId: 'r1' });
check('quien pide no puede aceptarse a sí mismo las plazas', r.estado, 403);
check('ni escribir nada', commitsHechos.length, 0);

prepara([{ id: 's1', centerCode: 'M', plazas: 10, pax: 10 }, { id: 's2', centerCode: 'MD', plazas: 5, pax: 5 }], 'mangamar@visor.local');
ponSolicitud('r1', { type: 'request', initiatorCenter: 'MD', targetCenter: 'M', date: '2026-07-14', requestedPax: 4, targetSalidaId: 's1' });
r = await llama({ op: 'acceptRequest', requestId: 'r1' });
check('Mangamar, que es quien cede, sí puede aceptar', r.estado, 200);
check('cede 4 de sus 10', salidasDe('2026-07-14'), [{ centro: 'M', plazas: 6 }, { centro: 'MD', plazas: 9 }]);
ok('y la solicitud se borra en la misma operación', solicitudBorrada('r1'));

prepara([{ id: 's1', centerCode: 'M', plazas: 10, pax: 10 }], 'divers@visor.local');
ponSolicitud('r1', { type: 'request', initiatorCenter: 'MD', targetCenter: 'M', date: '2026-07-14', requestedPax: 4, targetSalidaId: 's1' });
r = await llama({ op: 'acceptRequest', requestId: 'r1' });
check('una escuela ajena no puede aceptar por otra', r.estado, 403);

prepara([{ id: 's1', centerCode: 'M', plazas: 10, pax: 10 }], 'mangamar@visor.local');
ponSolicitud('r1', { type: 'request', initiatorCenter: 'MD', targetCenter: 'M', date: '2026-07-14', requestedPax: 4, status: 'accepted' });
r = await llama({ op: 'acceptRequest', requestId: 'r1' });
check('una solicitud ya resuelta no se acepta dos veces', r.estado, 409);

// Intercambio entre dos días: el total de los dos días no puede cambiar.
prepara([], 'mangamar@visor.local');
pon('2026-07-14', [{ id: 'a', centerCode: 'MD', plazas: 12, pax: 12 }, { id: 'x', centerCode: 'D', plazas: 10, pax: 10 }]);
pon('2026-07-15', [{ id: 'b', centerCode: 'M', plazas: 8, pax: 8 }, { id: 'y', centerCode: 'P', plazas: 5, pax: 5 }]);
ponSolicitud('r2', {
    type: 'swap', initiatorCenter: 'MD', targetCenter: 'M',
    dateA: '2026-07-14', dateB: '2026-07-15', centerA: 'MD', centerB: 'M',
    salidaIdA: 'a', salidaIdB: 'b',
    paxA: 8, retainedPaxA: 4, paxB: 8, retainedPaxB: 0
});
r = await llama({ op: 'acceptRequest', requestId: 'r2' });
check('el intercambio se aplica', r.estado, 200);
const diaA = salidasDe('2026-07-14');
const diaB = salidasDe('2026-07-15');
check('día A: Moondive retiene 4 y llega Mangamar con 8', diaA, [{ centro: 'MD', plazas: 4 }, { centro: 'D', plazas: 10 }, { centro: 'M', plazas: 8 }]);
check('día B: Mangamar se va del todo y llega Moondive con 8', diaB, [{ centro: 'P', plazas: 5 }, { centro: 'MD', plazas: 8 }]);
const totalAntes = 12 + 10 + 8 + 5;
const totalDespues = diaA.reduce((t, x) => t + x.plazas, 0) + diaB.reduce((t, x) => t + x.plazas, 0);
check('no se ha inventado ni perdido una sola plaza', totalDespues, totalAntes);
ok('y la propuesta desaparece', solicitudBorrada('r2'));

// -------------------------------------------------------------------------
section('Retirar y rechazar');

prepara([], 'moondive@visor.local');
ponSolicitud('r3', { type: 'request', initiatorCenter: 'MD', targetCenter: 'M', date: '2026-07-14', requestedPax: 4 });
r = await llama({ op: 'cancelRequest', requestId: 'r3' });
check('quien propone puede retirar', r.estado, 200);
ok('y se borra', solicitudBorrada('r3'));

prepara([], 'mangamar@visor.local');
ponSolicitud('r3', { type: 'request', initiatorCenter: 'MD', targetCenter: 'M', date: '2026-07-14', requestedPax: 4 });
r = await llama({ op: 'cancelRequest', requestId: 'r3' });
check('el destinatario NO puede retirarla por él', r.estado, 403);

prepara([], 'mangamar@visor.local');
ponSolicitud('r3', { type: 'request', initiatorCenter: 'MD', targetCenter: 'M', date: '2026-07-14', requestedPax: 4 });
r = await llama({ op: 'rejectRequest', requestId: 'r3' });
check('pero sí rechazarla', r.estado, 200);

prepara([], 'divers@visor.local');
ponSolicitud('r3', { type: 'request', initiatorCenter: 'MD', targetCenter: 'M', date: '2026-07-14', requestedPax: 4 });
r = await llama({ op: 'rejectRequest', requestId: 'r3' });
check('una tercera escuela no pinta nada', r.estado, 403);


// -------------------------------------------------------------------------
section('Editar las plazas propias (regresión del 20/09/2026)');

// La pantalla de edición mandaba el centro del propio registro. El servidor lo
// tomaba por un intento de cambiar la salida de centro y rechazaba la edición:
// un centro no podía corregir sus propias plazas.
prepara([{ id: 's1', centerCode: 'MD', plazas: 10, pax: 10 }]);
r = await llama({ op: 'editSalida', dateStr: '2026-07-14', salidaId: 's1', pax: 6, newCenterCode: 'MD' });
check('mandar tu propio centro no es "cambiar de centro"', r.estado, 200);
check('y las plazas quedan corregidas', salidasEscritas(), [{ centro: 'MD', plazas: 6 }]);

prepara([{ id: 's1', centerCode: 'MD', plazas: 10, pax: 10 }]);
r = await llama({ op: 'editSalida', dateStr: '2026-07-14', salidaId: 's1', pax: 6 });
check('sin mandar centro, igual', r.estado, 200);

prepara([{ id: 's1', centerCode: 'MD', plazas: 10, pax: 10 }]);
r = await llama({ op: 'editSalida', dateStr: '2026-07-14', salidaId: 's1', pax: 6, newCenterCode: 'M' });
check('pero pasársela a otro centro sigue siendo cosa del admin', r.estado, 403);
check('y no se escribe', commitsHechos.length, 0);

prepara([{ id: 's1', centerCode: 'MD', plazas: 10, pax: 10 }], 'admin@visor.local');
r = await llama({ op: 'editSalida', dateStr: '2026-07-14', salidaId: 's1', pax: 6, newCenterCode: 'M' });
check('que sí puede', r.estado, 200);
check('y queda a nombre del otro', salidasEscritas(), [{ centro: 'M', plazas: 6 }]);


process.exit(report('ESCRITURAS EN EL SERVIDOR'));

})();
