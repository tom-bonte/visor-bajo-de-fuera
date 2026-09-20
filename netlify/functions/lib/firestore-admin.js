/**
 * @file netlify/functions/lib/firestore-admin.js
 * @description Acceso a Firestore con la identidad del servidor (cuenta de
 * servicio), sin librerías externas.
 *
 * Por qué a mano y no con firebase-admin: esta app no tiene compilación ni
 * dependencias, y así sigue. Todo lo que hace falta —firmar un JWT y hablar con
 * la API REST— está en el Node que trae Netlify.
 *
 * La cuenta de servicio SALTA las reglas de seguridad de Firestore. Ese es el
 * objetivo: las reglas pasarán a prohibir toda escritura desde navegadores, y
 * este será el único camino. Por eso cada operación tiene que comprobar por sí
 * misma quién pide qué: aquí abajo ya no hay red de seguridad.
 *
 * Variable de entorno necesaria:
 *   FIREBASE_SERVICE_ACCOUNT   JSON completo de la clave privada.
 */
const crypto = require('crypto');
const { encodeFields, decodeFields } = require('../../../scripts/firestore-rest');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/datastore';

let cachedToken = null;   // { token, expiresAt }

function serviceAccount() {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error('Falta la variable de entorno FIREBASE_SERVICE_ACCOUNT.');
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        throw new Error('FIREBASE_SERVICE_ACCOUNT no es un JSON válido.');
    }
    if (!parsed.client_email || !parsed.private_key || !parsed.project_id) {
        throw new Error('FIREBASE_SERVICE_ACCOUNT no tiene client_email / private_key / project_id.');
    }
    // Netlify guarda los saltos de línea escapados; la clave PEM los necesita reales.
    parsed.private_key = String(parsed.private_key).replace(/\\n/g, '\n');
    return parsed;
}

function base64url(input) {
    return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/** Firma el JWT con el que Google nos devuelve un token de acceso. */
function signedJwt(account, now) {
    const header = { alg: 'RS256', typ: 'JWT' };
    const claims = {
        iss: account.client_email,
        scope: SCOPE,
        aud: TOKEN_URL,
        iat: now,
        exp: now + 3600
    };
    const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
    const signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(account.private_key);
    return `${unsigned}.${base64url(signature)}`;
}

/**
 * Token de acceso del servidor. Se reutiliza mientras dure: cada invocación en
 * frío costaría si no una llamada extra a Google.
 */
async function accessToken() {
    const now = Math.floor(Date.now() / 1000);
    if (cachedToken && cachedToken.expiresAt > now + 60) return cachedToken.token;

    const account = serviceAccount();
    const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: signedJwt(account, now)
        }).toString()
    });
    const body = await res.json();
    if (!res.ok || !body.access_token) {
        throw new Error(`Google no ha dado token de servidor: ${body.error_description || body.error || res.status}`);
    }
    cachedToken = { token: body.access_token, expiresAt: now + (body.expires_in || 3600) };
    return cachedToken.token;
}

function projectId() {
    return serviceAccount().project_id;
}

function docPath(collection, docId) {
    return `projects/${projectId()}/databases/(default)/documents/${collection}/${docId}`;
}

function baseUrl() {
    return `https://firestore.googleapis.com/v1/projects/${projectId()}/databases/(default)/documents`;
}

/**
 * Lee un documento. Devuelve también su updateTime, que es la pieza con la que
 * después se escribe sin pisar a nadie: si otro centro ha tocado el día entre
 * la lectura y la escritura, el updateTime ya no coincide y Firestore rechaza
 * la operación entera.
 */
async function readDoc(collection, docId) {
    const token = await accessToken();
    const res = await fetch(`${baseUrl()}/${collection}/${encodeURIComponent(docId)}`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    if (res.status === 404) return { exists: false, data: {}, updateTime: null };
    if (!res.ok) throw new Error(`Firestore ${res.status} leyendo ${collection}/${docId}`);
    const body = await res.json();
    return { exists: true, data: decodeFields(body.fields || {}), updateTime: body.updateTime };
}

/** Escritura de un documento dentro de un commit, con su condición previa. */
function writeOp(collection, docId, data, updateTime) {
    const op = {
        update: { name: docPath(collection, docId), fields: encodeFields(data) },
        updateMask: { fieldPaths: Object.keys(data) }
    };
    op.currentDocument = updateTime ? { updateTime } : { exists: false };
    return op;
}

/** Alta de un documento nuevo con id generado (historial). */
function createOp(collection, docId, data) {
    return {
        update: { name: docPath(collection, docId), fields: encodeFields(data) },
        currentDocument: { exists: false }
    };
}

function deleteOp(collection, docId, updateTime) {
    const op = { delete: docPath(collection, docId) };
    if (updateTime) op.currentDocument = { updateTime };
    return op;
}

/**
 * Aplica todas las escrituras o ninguna. Si alguna condición previa ha dejado
 * de cumplirse, Firestore devuelve FAILED_PRECONDITION y no escribe nada.
 */
async function commit(writes) {
    const token = await accessToken();
    const res = await fetch(`${baseUrl()}:commit`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ writes })
    });
    if (res.ok) return { ok: true };

    const text = await res.text();
    const conflict = /FAILED_PRECONDITION|ALREADY_EXISTS|ABORTED/i.test(text);
    return { ok: false, conflict, status: res.status, detail: text.slice(0, 300) };
}

/**
 * Lee, calcula y escribe, reintentando si alguien se ha adelantado. Es el
 * equivalente de una transacción: `apply` recibe lo leído y devuelve las
 * escrituras; si el día cambió por debajo, se vuelve a leer y se recalcula
 * sobre lo nuevo, nunca sobre lo que teníamos en la mano.
 */
async function runTransaction(apply, intentos = 4) {
    let ultimo = null;
    for (let i = 0; i < intentos; i++) {
        const writes = await apply();
        if (!writes || writes.length === 0) return { ok: true, sinCambios: true };
        // A través de exports para que los tests puedan sustituirlo.
        const resultado = await module.exports.commit(writes);
        if (resultado.ok) return resultado;
        ultimo = resultado;
        if (!resultado.conflict) break;
        await new Promise(r => setTimeout(r, 60 * (i + 1)));
    }
    return ultimo || { ok: false, detail: 'sin resultado' };
}

/** Id aleatorio con el mismo aspecto que los que genera Firestore. */
function newDocId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let out = '';
    const bytes = crypto.randomBytes(20);
    for (let i = 0; i < 20; i++) out += chars[bytes[i] % chars.length];
    return out;
}

module.exports = {
    accessToken, projectId, readDoc, writeOp, createOp, deleteOp,
    commit, runTransaction, newDocId, serviceAccount
};
