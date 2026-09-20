/**
 * Tests de la copia de seguridad y la restauración.
 *
 * Lo que de verdad importa aquí es el VIAJE DE IDA Y VUELTA: lo que sale de
 * Firestore tiene que volver a entrar exactamente igual. Un 10 que vuelve como
 * "10" (texto) o como 10.0 (decimal) rompe las reglas de seguridad y las sumas
 * de plazas, y no se notaría hasta el día que hiciera falta restaurar.
 */
const fs = require('fs');
const path = require('path');
const { section, check, ok, report } = require('./assert');
const {
    decodeValue, decodeFields, encodeValue, encodeFields,
    docIdFromName, readFirebaseConfig, stableStringify, sortKeysDeep
} = require('../scripts/firestore-rest');
const { parseArgs, fieldPath, isConfirmed, summarizeSalidas, describeDiff } = require('../scripts/restore');
const { defaultBackupPath, assertWritable } = require('../scripts/backup');

// -------------------------------------------------------------------------
section('Traducción de tipos de Firestore');

check('entero', decodeValue({ integerValue: '10' }), 10);
check('entero negativo', decodeValue({ integerValue: '-3' }), -3);
check('decimal', decodeValue({ doubleValue: 1.5 }), 1.5);
check('texto', decodeValue({ stringValue: 'Moon Dive' }), 'Moon Dive');
check('texto con acentos', decodeValue({ stringValue: 'cesión de plazas' }), 'cesión de plazas');
check('booleano', decodeValue({ booleanValue: true }), true);
check('nulo', decodeValue({ nullValue: null }), null);
check('fecha', decodeValue({ timestampValue: '2026-09-20T13:47:50.488Z' }), { __timestamp: '2026-09-20T13:47:50.488Z' });
check('lista vacía', decodeValue({ arrayValue: {} }), []);
check('lista', decodeValue({ arrayValue: { values: [{ integerValue: '1' }, { integerValue: '2' }] } }), [1, 2]);
check('mapa', decodeValue({ mapValue: { fields: { plazas: { integerValue: '8' } } } }), { plazas: 8 });

check('vuelta: entero sigue siendo entero', encodeValue(10), { integerValue: '10' });
check('vuelta: cero es entero', encodeValue(0), { integerValue: '0' });
check('vuelta: decimal sigue siendo decimal', encodeValue(1.5), { doubleValue: 1.5 });
check('vuelta: fecha', encodeValue({ __timestamp: '2026-09-20T13:47:50.488Z' }), { timestampValue: '2026-09-20T13:47:50.488Z' });
check('vuelta: nulo', encodeValue(null), { nullValue: null });

// -------------------------------------------------------------------------
section('Viaje de ida y vuelta de un día real de Bajo de Fuera');

const diaFirestore = {
    date: { stringValue: '2026-07-14' },
    totalQuota: { integerValue: '30' },
    updatedAt: { timestampValue: '2026-07-01T09:00:00.000Z' },
    allocations: { mapValue: { fields: { M: { mapValue: { fields: { slots: { integerValue: '10' }, note: { stringValue: '' }, initialSlots: { integerValue: '10' } } } } } } },
    salidas: {
        arrayValue: {
            values: [
                { mapValue: { fields: { id: { stringValue: 'plazas_2026-07-14_M' }, centerCode: { stringValue: 'M' }, plazas: { integerValue: '10' }, pax: { integerValue: '10' }, note: { stringValue: 'nitrox' } } } },
                { mapValue: { fields: { id: { stringValue: 'plazas_2026-07-14_MD' }, centerCode: { stringValue: 'MD' }, plazas: { integerValue: '8' }, pax: { integerValue: '8' }, note: { stringValue: '' } } } }
            ]
        }
    }
};

const plano = decodeFields(diaFirestore);
check('plazas leídas como número', plano.salidas[0].plazas, 10);
check('dos salidas', plano.salidas.length, 2);
check('suma de plazas', plano.salidas.reduce((t, s) => t + s.plazas, 0), 18);
check('ida y vuelta idéntica', encodeFields(plano), diaFirestore);

const dobleVuelta = decodeFields(encodeFields(plano));
check('dos viajes seguidos no degradan nada', stableStringify(dobleVuelta), stableStringify(plano));

// -------------------------------------------------------------------------
section('Comparación estable (evita restauraciones innecesarias)');

check('mismo contenido, distinto orden de claves', stableStringify({ a: 1, b: 2 }), stableStringify({ b: 2, a: 1 }));
ok('contenido distinto se distingue', stableStringify({ a: 1 }) !== stableStringify({ a: 2 }));
check('el orden de las salidas SÍ importa', stableStringify([1, 2]) === stableStringify([2, 1]), false);
check('ordenar claves no altera los valores', sortKeysDeep({ b: [3, 1], a: { d: 1, c: 2 } }), { a: { c: 2, d: 1 }, b: [3, 1] });

// -------------------------------------------------------------------------
section('Identificadores y configuración');

check('id de un día', docIdFromName('projects/p/databases/(default)/documents/bdf_days/2026-07-14'), '2026-07-14');
check('id de un historial', docIdFromName('projects/p/databases/(default)/documents/bdf_history_logs/1p466OjaHXGBuXTcjKKn'), '1p466OjaHXGBuXTcjKKn');

const config = readFirebaseConfig(fs.readFileSync(path.join(__dirname, '..', 'config.js'), 'utf8'));
check('proyecto leído del config.js de la app', config.projectId, 'reserva-marina-cdp');
ok('clave pública leída del config.js de la app', config.apiKey.startsWith('AIza'));

// -------------------------------------------------------------------------
section('Barandillas de la restauración');

check('simulacro por defecto', parseArgs(['copia.json', '--only=2026-12-31']).apply, false);
check('--apply se reconoce', parseArgs(['copia.json', '--only=2026-12-31', '--apply']).apply, true);
check('--only se reconoce', parseArgs(['copia.json', '--only=2026-12-31']).only, '2026-12-31');
check('--collection se reconoce', parseArgs(['copia.json', '--collection=bdf_days', '--all']).collection, 'bdf_days');
check('sin filtro no hay ni --only ni --all', parseArgs(['copia.json']), { file: 'copia.json', only: null, collection: null, all: false, apply: false });
check('nombre de campo normal', fieldPath('salidas'), 'salidas');
check('nombre de campo raro va entre comillas', fieldPath('mi campo'), '`mi campo`');

// -------------------------------------------------------------------------
section('Confirmación para escribir de verdad');

ok('RESTAURAR', isConfirmed('RESTAURAR'));
ok('en minúsculas también vale', isConfirmed('restaurar'));
ok('con espacios de más también', isConfirmed('  Restaurar  '));
ok('con acento mal puesto también', isConfirmed('restáurar'));
check('otra palabra no vale', isConfirmed('sí'), false);
check('vacío no vale', isConfirmed(''), false);
check('intro a secas no vale', isConfirmed('\n'), false);

// -------------------------------------------------------------------------
section('El simulacro enseña las plazas, no un recorte');

const hoy = { date: '2026-12-31', totalQuota: 13, salidas: [{ centerCode: 'X', plazas: 7 }] };
const copia = { date: '2026-12-31', totalQuota: 13, salidas: [{ centerCode: 'P', plazas: 6 }, { centerCode: 'X', plazas: 7 }] };
const diff = describeDiff(hoy, copia);

check('resumen de plazas', summarizeSalidas(copia.salidas), 'P 6, X 7 — 13 plazas');
check('día vacío', summarizeSalidas([]), 'sin salidas');
ok('dice lo que hay hoy', diff.some(l => l.includes('plazas hoy:   X 7 — 7 plazas')));
ok('dice lo que devolvería la copia', diff.some(l => l.includes('plazas copia: P 6, X 7 — 13 plazas')));
check('no menciona campos que no cambian', diff.some(l => l.startsWith('date:')), false);
check('un documento idéntico no genera diferencias', describeDiff(copia, copia), ['(sin diferencias visibles)']);
ok('un campo nuevo se marca como inexistente', describeDiff({}, { totalQuota: 13 }).some(l => l.includes('(no existe)')));

// -------------------------------------------------------------------------
section('Una copia no puede pisar a otra');

check('el nombre lleva fecha y hora',
    defaultBackupPath(new Date('2026-09-20T16:01:41.641Z'), '/r').split('/').pop(),
    'bdf-backup-2026-09-20T1601Z.json');
ok('dos copias del mismo día no comparten nombre',
    defaultBackupPath(new Date('2026-09-20T09:00:00Z'), '/r') !== defaultBackupPath(new Date('2026-09-20T18:01:00Z'), '/r'));
check('si el fichero no existe, adelante', assertWritable('/r/nueva.json', () => false), '/r/nueva.json');
let pisada = null;
try { assertWritable('/r/ya-esta.json', () => true); } catch (e) { pisada = e.message; }
ok('si ya existe, se niega', pisada && pisada.includes('Ya existe'));

// -------------------------------------------------------------------------
section('El backup se niega a guardar basura');

const backupSrc = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'backup.js'), 'utf8');
ok('aborta si no ha leído ningún día', /no contiene ningún día/.test(backupSrc));
ok('pagina hasta el final', /nextPageToken/.test(backupSrc));
ok('copia el calendario y el historial', /bdf_days'?,\s*'bdf_history_logs/.test(backupSrc));

process.exit(report('COPIA DE SEGURIDAD Y RESTAURACIÓN'));
