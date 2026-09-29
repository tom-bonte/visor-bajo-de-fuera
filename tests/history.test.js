/**
 * Tests de la pantalla de Historial.
 *
 * Por qué existe: al pasar las escrituras al servidor (20/09/2026) cambiaron los
 * NOMBRES de los campos que se guardan en cada entrada del historial, y la
 * pantalla seguía leyendo los antiguos. Resultado: el 28/09/2026 el historial
 * mostraba "Centro desconocido ↔ Centro desconocido (— pl. el )" y, en las
 * aceptaciones, un genérico "Acción registrada por Mangamar". Los datos estaban
 * bien; el registro de quién hizo qué era ilegible.
 *
 * La comprobación que lo habría evitado es la última de este fichero: para CADA
 * tipo de acción que el servidor sabe escribir, la pantalla tiene que producir
 * una frase de verdad. Se lee la lista de tipos del propio código del servidor,
 * así que si mañana se añade uno y nadie toca la pantalla, este test falla.
 */
const fs = require('fs');
const path = require('path');
const { loadApp } = require('./load-app.js');
const { section, check, ok, report } = require('./assert.js');

const ROOT = path.join(__dirname, '..');

/** Pinta el historial con las entradas dadas y devuelve el HTML resultante. */
function pintar(entradas) {
    const app = loadApp();
    const contenedor = app.setElement('main-view-container');
    app.evaluate(`historyLogs = ${JSON.stringify(entradas)};`);
    app.renderHistoryView();
    return contenedor.innerHTML || '';
}

const ts = { __timestamp: '2026-09-28T11:14:00.000Z' };

// -------------------------------------------------------------------------
section('Las entradas que escribe el servidor se leen');

// Tal y como las escribe netlify/functions/bdf-write.js.
const html = pintar([
    { actionType: 'add_salida', centerKey: 'mangamar', timestamp: ts, details: { date: '2026-10-11', center: 'M', slots: 7, pax: 7 } },
    { actionType: 'edit_salida', centerKey: 'mangamar', timestamp: ts, details: { date: '2026-10-11', center: 'M', slots: 4, oldSlots: 7 } },
    { actionType: 'delete_salida', centerKey: 'hormigas', timestamp: ts, details: { date: '2026-10-12', center: 'H', slots: 6, pax: 6 } },
    { actionType: 'move_salida', centerKey: 'divers', timestamp: ts, details: { from: '2026-10-13', to: '2026-10-14', center: 'D', slots: 5, pax: 5 } },
    { actionType: 'spot_transfer', centerKey: 'mangamar', timestamp: ts, details: { date: '2026-10-15', fromCenter: 'M', toCenter: 'P', slots: 3, spots: 3 } },
    { actionType: 'swap_request', centerKey: 'hormigas', timestamp: ts, details: { centerA: 'H', centerB: 'M', dateA: '2026-10-31', dateB: '2026-10-08', paxA: 6, paxB: 6, initiatorCenter: 'H', targetCenter: 'M' } },
    { actionType: 'petition', centerKey: 'hormigas', timestamp: ts, details: { fromCenter: 'H', toCenter: 'M', date: '2026-10-11', slots: 4, isFull: false } },
    { actionType: 'accept_swap', centerKey: 'mangamar', timestamp: ts, details: { dateA: '2026-10-31', dateB: '2026-10-08', centerA: 'H', centerB: 'M', paxA: 6, paxB: 6 } },
    { actionType: 'accept_petition', centerKey: 'mangamar', timestamp: ts, details: { date: '2026-10-11', fromCenter: 'M', toCenter: 'H', slots: 4, spots: 4 } },
    { actionType: 'cancel_request', centerKey: 'mangamar', timestamp: ts, details: { fromCenter: 'M', toCenter: 'P', date: '2026-10-29', slots: 6 } },
    { actionType: 'reject_request', centerKey: 'planeta', timestamp: ts, details: { fromCenter: 'M', toCenter: 'P', date: '2026-10-20', slots: 6 } },
]);

check('ninguna entrada sale como "Centro desconocido"', /Centro desconocido/.test(html), false);
check('ni con plazas en blanco ("— pl.")', /— pl\./.test(html), false);
check('ni como "Acción registrada por"', /Acción registrada por/.test(html), false);

ok('el alta nombra a la escuela y sus plazas', /Mangamar<\/b> añadió una salida[\s\S]{0,120}7 plazas/.test(html));
ok('la modificación dice a cuántas plazas queda', /modificó su salida[\s\S]{0,120}4 plazas/.test(html));
ok('el borrado nombra el día', /eliminó su salida[\s\S]{0,80}2026-10-12/.test(html));
ok('el movimiento dice de qué día a qué día', /del día <b>2026-10-13<\/b> al <b>2026-10-14<\/b>/.test(html));
ok('la cesión dice quién cede y a quién', /Mangamar<\/b> transfirió <b>3 plazas<\/b> a <b>Planeta Azul/.test(html));
ok('la propuesta de intercambio nombra a las dos escuelas', /Islas Hormigas<\/b> \(6 pl\. el 2026-10-31\) propuso permuta[\s\S]{0,80}Mangamar/.test(html));
ok('la petición dice cuántas plazas se piden', /Islas Hormigas<\/b> solicitó <b>4 plazas<\/b> a <b>Mangamar/.test(html));
ok('el intercambio aceptado se distingue de la propuesta', /Intercambio Aceptado/.test(html));
ok('la petición aceptada también', /Petición Aceptada/.test(html));
ok('la propuesta retirada dice quién la retiró', /Mangamar<\/b> retiró su propuesta a <b>Planeta Azul/.test(html));
ok('la rechazada dice quién la rechazó', /Planeta Azul<\/b> rechazó la propuesta de <b>Mangamar/.test(html));

// -------------------------------------------------------------------------
section('Un barco completo y el filtro de administrador');

const htmlLleno = pintar([
    { actionType: 'petition', centerKey: 'divers', timestamp: ts, details: { fromCenter: 'D', toCenter: 'X', date: '2026-11-02', isFull: true } },
    { actionType: 'import_csv', centerKey: 'admin', timestamp: ts, details: { totalEntries: 200, daysCount: 92 } },
    { actionType: 'admin_quota', centerKey: 'admin', timestamp: ts, details: { date: '2026-11-03', newQuota: 0 } },
]);
ok('"el barco completo" se dice con palabras', /el barco completo/.test(htmlLleno));
check('las acciones del administrador no ensucian el historial de las escuelas',
    /Importación CSV|Ajuste de Cupo/.test(htmlLleno), false);

// -------------------------------------------------------------------------
section('Todo lo que el servidor sabe escribir, la pantalla sabe contarlo');

const servidorSrc = fs.readFileSync(path.join(ROOT, 'netlify', 'functions', 'bdf-write.js'), 'utf8');
const tipos = [...new Set([
    ...[...servidorSrc.matchAll(/historyOp\('([a-z_]+)'/g)].map(m => m[1]),
    ...[...servidorSrc.matchAll(/actionType: '([a-z_]+)'/g)].map(m => m[1]),
    ...[...servidorSrc.matchAll(/'(accept_petition|spot_transfer|cancel_request|reject_request|swap_request|petition)'/g)].map(m => m[1]),
])].sort();

ok('se han encontrado los tipos en el código del servidor', tipos.length >= 10);

const sinContar = tipos.filter(tipo => {
    const uno = pintar([{ actionType: tipo, centerKey: 'mangamar', timestamp: ts, details: { date: '2026-10-11', center: 'M', slots: 5, fromCenter: 'M', toCenter: 'H', centerA: 'M', centerB: 'H', dateA: '2026-10-11', dateB: '2026-10-12', paxA: 5, paxB: 5 } }]);
    return /Acción registrada por/.test(uno);
});
check(`ningún tipo cae en el mensaje genérico (${tipos.join(', ')})`, sinContar, []);

process.exit(report('HISTORIAL DE OPERACIONES'));
