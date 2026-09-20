#!/usr/bin/env node
/**
 * @file scripts/restore.js
 * @description Devuelve a Firestore los datos de un fichero de copia creado por
 * scripts/backup.js. Una copia que nunca se ha probado a restaurar no es una
 * copia de seguridad, es un fichero.
 *
 * Por defecto NO escribe nada: enseña lo que cambiaría (simulacro). Para
 * escribir de verdad hay que añadir --apply, y entonces pide confirmación.
 *
 * Uso:
 *   node scripts/restore.js copia.json --only=2026-12-31
 *   node scripts/restore.js copia.json --only=2026-12-31 --apply
 *   node scripts/restore.js copia.json --all --apply        (restauración completa)
 *
 * Credenciales: variables de entorno BDF_EMAIL y BDF_PASSWORD, o se preguntan.
 * Restaurar 'bdf_days' requiere cualquier centro; 'bdf_history_logs' requiere
 * la cuenta de administrador (las reglas hacen el historial inmutable).
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { encodeFields, decodeFields, readFirebaseConfig, stableStringify } = require('./firestore-rest');

const ROOT = path.join(__dirname, '..');
const FIELD_OK = /^[A-Za-z_][A-Za-z0-9_]*$/;

function parseArgs(argv) {
    const args = { file: null, only: null, collection: null, all: false, apply: false };
    argv.forEach(a => {
        if (a === '--all') args.all = true;
        else if (a === '--apply') args.apply = true;
        else if (a.startsWith('--only=')) args.only = a.slice(7);
        else if (a.startsWith('--collection=')) args.collection = a.slice(13);
        else if (!a.startsWith('--') && !args.file) args.file = a;
    });
    return args;
}

function fieldPath(name) {
    return FIELD_OK.test(name) ? name : '`' + name.replace(/`/g, '\\`') + '`';
}

/**
 * La confirmación existe para que nadie restaure sin querer, no para examinar
 * de mecanografía: vale en minúsculas, con espacios o con acento.
 */
function isConfirmed(answer) {
    return String(answer || '').trim().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '') === 'RESTAURAR';
}

/** 'P 6, X 7 — 13 plazas' */
function summarizeSalidas(list) {
    if (!Array.isArray(list) || list.length === 0) return 'sin salidas';
    const total = list.reduce((t, s) => t + (Number(s && s.plazas) || 0), 0);
    return `${list.map(s => `${s.centerCode} ${s.plazas}`).join(', ')} — ${total} plazas`;
}

/**
 * Qué cambia, campo por campo. Antes se imprimía el documento entero cortado a
 * 220 caracteres, justo donde empiezan las salidas: decía "es diferente" sin
 * enseñar lo único que importa.
 */
function describeDiff(live, wanted) {
    const campos = [...new Set([...Object.keys(live || {}), ...Object.keys(wanted || {})])].sort();
    const lines = [];

    campos.forEach(campo => {
        const hoy = live ? live[campo] : undefined;
        const copia = wanted ? wanted[campo] : undefined;
        if (stableStringify(hoy) === stableStringify(copia)) return;

        if (campo === 'salidas') {
            lines.push(`plazas hoy:   ${summarizeSalidas(hoy)}`);
            lines.push(`plazas copia: ${summarizeSalidas(copia)}`);
        } else {
            const corta = v => (v === undefined ? '(no existe)' : stableStringify(v).slice(0, 160));
            lines.push(`${campo}: ${corta(hoy)}  ->  ${corta(copia)}`);
        }
    });

    return lines.length ? lines : ['(sin diferencias visibles)'];
}

function ask(question) {
    return new Promise(resolve => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question(question, answer => { rl.close(); resolve(answer); });
    });
}

async function signIn(apiKey, email, password) {
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: true })
    });
    const body = await res.json();
    if (!res.ok) throw new Error(`No se ha podido iniciar sesión: ${(body.error && body.error.message) || res.status}`);
    return body.idToken;
}

async function readLiveDoc(projectId, apiKey, collection, docId) {
    const res = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collection}/${encodeURIComponent(docId)}?key=${apiKey}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Firestore respondió ${res.status} al leer ${collection}/${docId}`);
    const body = await res.json();
    return decodeFields(body.fields || {});
}

async function writeDoc(projectId, idToken, collection, docId, data, liveData) {
    // updateMask explícito = reemplazo exacto: se escriben los campos de la
    // copia y se borran los que hoy existen en el servidor y no están en ella.
    const names = new Set([...Object.keys(data), ...Object.keys(liveData || {})]);
    const mask = [...names].map(n => `updateMask.fieldPaths=${encodeURIComponent(fieldPath(n))}`).join('&');
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collection}/${encodeURIComponent(docId)}?${mask}`;

    const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ fields: encodeFields(data) })
    });
    if (!res.ok) throw new Error(`Firestore rechazó ${collection}/${docId}: ${res.status} ${await res.text()}`);
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (!args.file) throw new Error('Falta el fichero de copia. Uso: node scripts/restore.js copia.json --only=FECHA');
    if (!args.only && !args.all) throw new Error('Indica --only=<documento> o --all. Restaurar todo sin querer es peor que no tener copia.');

    const config = readFirebaseConfig(fs.readFileSync(path.join(ROOT, 'config.js'), 'utf8'));
    const backup = JSON.parse(fs.readFileSync(args.file, 'utf8'));
    if (backup.project && backup.project !== config.projectId) {
        throw new Error(`La copia es del proyecto ${backup.project} y config.js apunta a ${config.projectId}.`);
    }
    console.log(`Copia del ${backup.exportedAt || 'fecha desconocida'} (proyecto ${backup.project}).\n`);

    const plan = [];
    for (const collection of Object.keys(backup.collections)) {
        if (args.collection && args.collection !== collection) continue;
        for (const docId of Object.keys(backup.collections[collection])) {
            if (args.only && args.only !== docId) continue;
            const wanted = backup.collections[collection][docId];
            const live = await readLiveDoc(config.projectId, config.apiKey, collection, docId);
            const identical = live !== null && stableStringify(live) === stableStringify(wanted);
            plan.push({ collection, docId, wanted, live, identical });
        }
    }

    if (plan.length === 0) throw new Error('Ningún documento de la copia coincide con el filtro indicado.');

    plan.forEach(p => {
        const estado = p.live === null ? 'NO EXISTE hoy — se creará'
            : p.identical ? 'idéntico — sin cambios'
            : 'DIFERENTE hoy — se sobrescribirá';
        console.log(`  ${p.collection}/${p.docId}: ${estado}`);
        if (!p.identical && p.live !== null) {
            describeDiff(p.live, p.wanted).forEach(line => console.log(`      ${line}`));
        }
    });

    const cambios = plan.filter(p => !p.identical);
    console.log(`\n${plan.length} documentos revisados, ${cambios.length} cambiarían.`);

    if (!args.apply) {
        console.log('\nSimulacro: no se ha escrito nada. Añade --apply para restaurar de verdad.');
        return;
    }
    if (cambios.length === 0) {
        console.log('\nNada que restaurar.');
        return;
    }

    const confirm = await ask(`\nEscribe RESTAURAR para sobrescribir ${cambios.length} documento(s) en la base de datos REAL: `);
    if (!isConfirmed(confirm)) { console.log('Cancelado.'); return; }

    const email = process.env.BDF_EMAIL || await ask('Correo de la cuenta del visor: ');
    const password = process.env.BDF_PASSWORD || await ask('Contraseña (se verá al escribirla): ');
    const idToken = await signIn(config.apiKey, email.trim(), password);

    for (const p of cambios) {
        await writeDoc(config.projectId, idToken, p.collection, p.docId, p.wanted, p.live);
        console.log(`  ✓ restaurado ${p.collection}/${p.docId}`);
    }
    console.log(`\n✅ ${cambios.length} documento(s) restaurados.`);
}

if (require.main === module) {
    main().catch(err => { console.error(`\n❌ ${err.message}`); process.exit(1); });
}

module.exports = { parseArgs, fieldPath, isConfirmed, summarizeSalidas, describeDiff };
