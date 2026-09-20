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

admin.readDoc = async (coleccion, docId) => {
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
    commitsHechos = [];
    commitDevuelve = { ok: true };
    sesion = quien;
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

process.exit(report('ESCRITURAS EN EL SERVIDOR'));

})();
