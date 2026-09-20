/**
 * @file netlify/functions/lib/verify-token.js
 * @description Comprueba el token de sesión de un centro SIN preguntarle a
 * Google cada vez.
 *
 * Un token de sesión de Firebase viene firmado por Google. Se puede comprobar
 * la firma aquí mismo con las claves públicas de Google, que se descargan una
 * vez y valen durante horas. Antes se hacía una llamada a Google en CADA
 * escritura, y esa ida y vuelta se notaba: era la mitad de la espera que ve el
 * usuario al añadir plazas.
 *
 * Lo que se comprueba, que es exactamente lo que comprobaría Google:
 *   - la firma, con la clave pública que corresponde al 'kid' del token;
 *   - que no ha caducado y que ya es válido;
 *   - que es de ESTE proyecto (aud) y lo emitió Google para él (iss);
 *   - que identifica a alguien (sub).
 */
const crypto = require('crypto');

const CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

let cachedCerts = null;   // { certs, expiresAt }

function base64urlDecode(part) {
    return Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/** Claves públicas de Google. Se guardan hasta que caducan (suelen durar horas). */
async function googleCerts() {
    const now = Date.now();
    if (cachedCerts && cachedCerts.expiresAt > now) return cachedCerts.certs;

    const res = await fetch(CERTS_URL);
    if (!res.ok) throw new Error(`No se han podido obtener las claves de Google (${res.status})`);
    const certs = await res.json();

    // Respetar el max-age que indica Google; si no viene, una hora.
    const cacheControl = res.headers.get('cache-control') || '';
    const maxAge = /max-age=(\d+)/.exec(cacheControl);
    const segundos = maxAge ? Number(maxAge[1]) : 3600;

    cachedCerts = { certs, expiresAt: now + segundos * 1000 };
    return certs;
}

/**
 * @param {string} idToken
 * @param {string} projectId
 * @returns {Promise<{email: string, uid: string}|null>} null si el token no vale.
 */
async function verifyIdToken(idToken, projectId) {
    const partes = String(idToken || '').split('.');
    if (partes.length !== 3) return null;

    let cabecera, cuerpo;
    try {
        cabecera = JSON.parse(base64urlDecode(partes[0]).toString('utf8'));
        cuerpo = JSON.parse(base64urlDecode(partes[1]).toString('utf8'));
    } catch (e) {
        return null;
    }

    if (cabecera.alg !== 'RS256' || !cabecera.kid) return null;

    const ahora = Math.floor(Date.now() / 1000);
    const margen = 60;   // un minuto de tolerancia con relojes desajustados
    if (!cuerpo.exp || cuerpo.exp + margen < ahora) return null;
    if (cuerpo.iat && cuerpo.iat - margen > ahora) return null;
    if (cuerpo.aud !== projectId) return null;
    if (cuerpo.iss !== `https://securetoken.google.com/${projectId}`) return null;
    if (!cuerpo.sub) return null;

    const certs = await googleCerts();
    const pem = certs[cabecera.kid];
    if (!pem) return null;          // clave desconocida: token viejo o falso

    const publicKey = new crypto.X509Certificate(pem).publicKey;
    const firmaValida = crypto.createVerify('RSA-SHA256')
        .update(`${partes[0]}.${partes[1]}`)
        .verify(publicKey, base64urlDecode(partes[2]));
    if (!firmaValida) return null;

    return { email: String(cuerpo.email || '').toLowerCase(), uid: cuerpo.sub };
}

module.exports = { verifyIdToken, googleCerts };
