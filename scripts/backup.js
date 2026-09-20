#!/usr/bin/env node
/**
 * @file scripts/backup.js
 * @description Copia de seguridad completa de Bajo de Fuera a un fichero JSON.
 *
 * No necesita contraseñas: 'bdf_days' y 'bdf_history_logs' son de lectura
 * pública (así funciona el modo consulta del visor), de modo que la copia se
 * puede hacer con la misma clave pública que ya viaja en config.js.
 *
 * Uso:
 *   node scripts/backup.js                    -> backups/bdf-backup-AAAA-MM-DDTHHMMZ.json
 *   node scripts/backup.js ruta/fichero.json  -> ruta indicada
 *
 * Nunca sobrescribe una copia existente.
 */
const fs = require('fs');
const path = require('path');
const { decodeFields, docIdFromName, readFirebaseConfig, sortKeysDeep } = require('./firestore-rest');

const ROOT = path.join(__dirname, '..');
const COLLECTIONS = ['bdf_days', 'bdf_history_logs'];
const PAGE_SIZE = 300;

async function fetchCollection(projectId, apiKey, collection) {
    const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collection}`;
    const docs = {};
    let pageToken = '';
    let pages = 0;

    do {
        const url = `${base}?key=${apiKey}&pageSize=${PAGE_SIZE}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
        const res = await fetch(url);
        if (!res.ok) {
            throw new Error(`Firestore respondió ${res.status} al leer ${collection}: ${await res.text()}`);
        }
        const body = await res.json();
        (body.documents || []).forEach(doc => {
            docs[docIdFromName(doc.name)] = decodeFields(doc.fields || {});
        });
        pageToken = body.nextPageToken || '';
        pages++;
        if (pages > 500) throw new Error(`Paginación descontrolada en ${collection}`);
    } while (pageToken);

    return docs;
}

/**
 * Nombre por fecha Y HORA. Con sólo la fecha, la segunda copia del día pisaba a
 * la primera: si alguien borra algo y luego hace una copia "por si acaso",
 * destruye justo la copia buena que tenía de esa mañana. Pasó en la primera
 * prueba de restauración real.
 */
function defaultBackupPath(now = new Date(), root = ROOT) {
    const stamp = now.toISOString().slice(0, 16).replace(/:/g, '') + 'Z';
    return path.join(root, 'backups', `bdf-backup-${stamp}.json`);
}

/** Nunca se pisa un fichero existente sin decirlo. */
function assertWritable(outPath, exists = fs.existsSync) {
    if (exists(outPath)) {
        throw new Error(`Ya existe ${outPath}. Una copia no debe pisar a otra: usa otro nombre o borra esa a mano.`);
    }
    return outPath;
}

async function main() {
    const config = readFirebaseConfig(fs.readFileSync(path.join(ROOT, 'config.js'), 'utf8'));
    const outPath = assertWritable(process.argv[2] || defaultBackupPath());

    const backup = {
        project: config.projectId,
        exportedAt: new Date().toISOString(),
        collections: {}
    };

    for (const collection of COLLECTIONS) {
        process.stdout.write(`Leyendo ${collection}… `);
        backup.collections[collection] = await fetchCollection(config.projectId, config.apiKey, collection);
        console.log(`${Object.keys(backup.collections[collection]).length} documentos`);
    }

    // Una copia vacía casi siempre significa "ha fallado la lectura", no "no hay
    // datos". Mejor que el proceso falle a ruidosamente que guardar un fichero
    // inútil y creer que hay copia de seguridad.
    const days = Object.keys(backup.collections['bdf_days']).length;
    if (days === 0) {
        throw new Error('La copia no contiene ningún día. Se aborta en lugar de guardar un fichero vacío.');
    }

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    // Claves ordenadas: así dos copias de días distintos se pueden comparar
    // con un diff normal y se ve exactamente qué cambió.
    fs.writeFileSync(outPath, JSON.stringify(sortKeysDeep(backup), null, 2));

    const kb = (fs.statSync(outPath).size / 1024).toFixed(1);
    console.log(`\n✅ Copia guardada en ${outPath} (${kb} KB)`);
    console.log(`   ${days} días y ${Object.keys(backup.collections['bdf_history_logs']).length} entradas de historial.`);
}

if (require.main === module) {
    main().catch(err => { console.error(`\n❌ ${err.message}`); process.exit(1); });
}

module.exports = { fetchCollection, COLLECTIONS, defaultBackupPath, assertWritable };
