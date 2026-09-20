/**
 * Tests de la lógica de negocio, ejecutados sobre los ficheros REALES de la app.
 * No tocan Firestore ni el navegador. `npm run test:logic`
 */
const { loadApp } = require('./load-app.js');
const { section, check, ok, report } = require('./assert.js');

const app = loadApp();
const { getDayQuota, getDaySalidas, getDaySummary, applySwapToSalidas,
        applyTransferToSalidas, sumSalidasPlazas, removeSalidaFromList,
        describeFirestoreError } = app;

const S = (c, p, extra = {}) => ({ id: `plazas_2026-07-01_${c}`, date: '2026-07-01', centerCode: c, plazas: p, pax: p, note: '', ...extra });
const isWeekend = (iso) => { const d = new Date(iso + 'T00:00:00'); return d.getDay() === 0 || d.getDay() === 6; };

/* ------------------------------------------------------------------ CUPOS */
section('Cupo diario (INTERACTION_LOGIC.md §0.1)');

check('1 jun = 30',                 getDayQuota('2026-06-01'), 30);
check('15 jul = 30',                getDayQuota('2026-07-15'), 30);
check('30 sep = 30',                getDayQuota('2026-09-30'), 30);
check('31 may = 13 (antes de jun)', getDayQuota('2026-05-31'), 13);
check('15 ene = 13',                getDayQuota('2026-01-15'), 13);
check('25 dic = 13 (festivo NO cambia el cupo)', getDayQuota('2026-12-25'), 13);

let octOk = true;
for (let d = 1; d <= 15; d++) {
    const iso = `2026-10-${String(d).padStart(2, '0')}`;
    const expected = isWeekend(iso) ? 30 : 13;
    if (getDayQuota(iso) !== expected) octOk = false;
}
ok('1–15 oct: 30 los fines de semana, 13 el resto', octOk);

let cutoffOk = true;
for (let d = 16; d <= 31; d++) {
    const iso = `2026-10-${String(d).padStart(2, '0')}`;
    if (getDayQuota(iso) !== 13) cutoffOk = false;
}
ok('el 15 de octubre es corte estricto: del 16 en adelante siempre 13', cutoffOk);

check('override del admin (cierre = 0)', getDayQuota('2026-07-15', { totalQuotaOverride: 0 }), 0);
check('override del admin (cupo reducido)', getDayQuota('2026-07-15', { totalQuotaOverride: 8 }), 8);

/* ---------------------------------------------------------------- SALIDAS */
section('Registros por día (§0: uno por escuela y día)');

check('consolida registros duplicados heredados de la misma escuela',
    getDaySalidas({ salidas: [S('M', 6), S('M', 4)] }, '2026-07-01').map(s => [s.centerCode, s.plazas]),
    [['M', 10]]);
check('descarta registros a 0', getDaySalidas({ salidas: [S('M', 5), S('D', 0)] }, '2026-07-01').length, 1);
check('resumen del día', (() => { const s = getDaySummary({ salidas: [S('M', 10), S('D', 8)] }, '2026-07-01'); return [s.totalOccupied, s.totalQuota, s.poolAvailable]; })(), [18, 30, 12]);

/* ------------------------------------------------------------ INTERCAMBIO */
section('Intercambio con split (§5 Caso 2, ejemplo literal del spec)');

let dA = [S('A', 12), S('OTROS', 10)];
let dB = [S('B', 4), S('OTROS2', 5)];
const totalAntes = sumSalidasPlazas(dA) + sumSalidasPlazas(dB);
const spaceA = 30 - (sumSalidasPlazas(dA) - 12);
const spaceB = 13 - (sumSalidasPlazas(dB) - 4);
check('space_A = 20', spaceA, 20);
check('space_B = 8', spaceB, 8);
const safeA = Math.min(12, spaceB), safeB = Math.min(4, spaceA);
check('safe_A = 8, retiene 4', [safeA, 12 - safeA], [8, 4]);
check('safe_B = 4, retiene 0', [safeB, 4 - safeB], [4, 0]);

applySwapToSalidas(dA, dB, { normA: 'A', normB: 'B', salidaIdA: 'plazas_2026-07-01_A', salidaIdB: 'plazas_2026-07-01_B',
    dateA: '2026-07-01', dateB: '2026-07-02', safePaxA: safeA, retainedPaxA: 12 - safeA, safePaxB: safeB, retainedPaxB: 4 - safeB });

check('Día A queda 18/30', sumSalidasPlazas(dA), 18);
check('Día B queda 13/13', sumSalidasPlazas(dB), 13);
check('Día A = otros 10 + B 4 + A 4', dA.map(s => [s.centerCode, s.plazas]).sort(), [['A', 4], ['B', 4], ['OTROS', 10]].sort());
check('Día B = otros 5 + A 8', dB.map(s => [s.centerCode, s.plazas]).sort(), [['A', 8], ['OTROS2', 5]].sort());
check('NO se crean ni se pierden plazas', sumSalidasPlazas(dA) + sumSalidasPlazas(dB), totalAntes);

section('Regresión: el doble toque inflaba las plazas');
applySwapToSalidas(dA, dB, { normA: 'A', normB: 'B', salidaIdA: 'plazas_2026-07-01_A', salidaIdB: 'plazas_2026-07-01_B',
    dateA: '2026-07-01', dateB: '2026-07-02', safePaxA: safeA, retainedPaxA: 12 - safeA, safePaxB: safeB, retainedPaxB: 4 - safeB });
const duplicado = sumSalidasPlazas(dA) + sumSalidasPlazas(dB);
ok(`aplicar dos veces sí inventaría plazas (${totalAntes} → ${duplicado}), por eso la aceptación es atómica`, duplicado !== totalAntes);

/* ---------------------------------------------------------------- CESIÓN */
section('Cesión de plazas el mismo día (§3 / §3.1)');

let dia = [S('M', 10), S('D', 6)];
const antes = sumSalidasPlazas(dia);
check('cede 4 de M a D', applyTransferToSalidas(dia, { dateStr: '2026-07-01', normFrom: 'M', normTo: 'D', givingSalidaId: null, spots: 4, note: '' }), true);
check('M baja a 6 y D sube a 10', dia.map(s => [s.centerCode, s.plazas]).sort(), [['D', 10], ['M', 6]].sort());
check('el total del día no cambia', sumSalidasPlazas(dia), antes);
check('sigue habiendo un solo registro por escuela', dia.length, 2);
check('ceder más de lo que se tiene se rechaza', applyTransferToSalidas(dia, { dateStr: '2026-07-01', normFrom: 'M', normTo: 'D', givingSalidaId: null, spots: 99, note: '' }), false);
check('tras el rechazo no ha cambiado nada', sumSalidasPlazas(dia), antes);
applyTransferToSalidas(dia, { dateStr: '2026-07-01', normFrom: 'M', normTo: 'D', givingSalidaId: null, spots: 6, note: '' });
check('ceder TODO elimina a la escuela cedente', dia.map(s => s.centerCode), ['D']);
check('y el total sigue intacto', sumSalidasPlazas(dia), antes);

/* -------------------------------------------------------------- BORRADO */
section('Borrado de plazas');

check('borra por id', removeSalidaFromList([S('M', 5), S('D', 3)], 'plazas_2026-07-01_M', null).salidas.map(s => s.centerCode), ['D']);
check('si el id no existe, busca por centro', removeSalidaFromList([S('M', 5)], 'id-viejo-aleatorio', 'M').salidas.length, 0);
check('no borra nada ajeno', removeSalidaFromList([S('M', 5), S('D', 3)], null, 'M').salidas.map(s => s.centerCode), ['D']);
check('avisa cuando no había nada que borrar', removeSalidaFromList([S('D', 3)], 'plazas_2026-07-01_M', 'M').removed, false);

/* --------------------------------------------------------------- ERRORES */
section('Mensajes de error para el usuario');

ok('sin conexión → explica que no se ha cambiado nada', describeFirestoreError({ code: 'unavailable' }, 'eliminar las plazas').includes('No se ha cambiado nada'));
ok('choque entre escuelas → pide reintentar', describeFirestoreError({ code: 'aborted' }, 'guardar').includes('al mismo tiempo'));
ok('sesión caducada → pide volver a entrar', describeFirestoreError({ code: 'permission-denied' }, 'guardar').includes('Cierra sesión'));

/* ------------------------------------------------------------- SEGURIDAD */
section('Nombres de centro venidos de Firestore (anti-XSS)');

const { safeCenter, escapeHtml } = app;
const UNKNOWN_CENTER = app.evaluate('UNKNOWN_CENTER');
const PAYLOAD = '<img src=x onerror="alert(1)">';

check('código conocido', safeCenter('M').name, 'Mangamar');
check('clave de usuario también vale', safeCenter('mangamar').name, 'Mangamar');
check('no distingue mayúsculas', safeCenter('md').name, 'Moondive');
check('código desconocido → marcador fijo', safeCenter('ZZZ').name, UNKNOWN_CENTER.name);
check('vacío / nulo → marcador fijo', [safeCenter('').name, safeCenter(null).name, safeCenter(undefined).name],
    [UNKNOWN_CENTER.name, UNKNOWN_CENTER.name, UNKNOWN_CENTER.name]);

// Lo esencial: NUNCA devolver al HTML lo que venía de la base de datos.
ok('un payload malicioso nunca se devuelve como nombre', !safeCenter(PAYLOAD).name.includes('<'));
check('un payload malicioso se pinta como marcador', safeCenter(PAYLOAD).name, UNKNOWN_CENTER.name);
ok('tampoco se cuela por el color ni por el hex',
    !JSON.stringify(safeCenter(PAYLOAD)).includes('onerror'));

const nastyInputs = [PAYLOAD, '"><script>x</script>', "' onmouseover='x", '</b><svg onload=x>', 'M<script>', {}, [], 0, true];
ok('ninguna entrada rara produce un nombre con HTML',
    nastyInputs.every(v => !String(safeCenter(v).name).match(/[<>"']/)));

ok('escapeHtml neutraliza el payload', escapeHtml(PAYLOAD) === '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
ok('escapeHtml también las comillas simples', escapeHtml("' onmouseover='x").includes('&#039;'));

process.exit(report('LÓGICA DE NEGOCIO — Visor Bajo de Fuera'));
