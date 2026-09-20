/**
 * @file netlify/functions/notify.js
 * @description Proxy autenticado hacia el webhook de Make.com (grupo de WhatsApp).
 *
 * Antes, la URL del webhook vivía en config.js, que es público: cualquiera que
 * mirase el código fuente del sitio podía publicar mensajes arbitrarios en el
 * grupo de la asociación, sin cuenta y sin límite. Esa URL queda ahora sólo en
 * una variable de entorno de Netlify, y para llegar a ella hay que presentar un
 * token de sesión válido de un centro.
 *
 * Variable de entorno necesaria (Netlify → Site settings → Environment variables):
 *   MAKE_WEBHOOK_URL   URL del webhook NUEVO de Make.com. Marcar como secreta.
 *
 * La apiKey de Firebase va aquí escrita directamente y NO como variable de entorno,
 * a propósito: no es un secreto (es un identificador público, ya visible en
 * config.js y en cualquier app web de Firebase), y si se registrase como variable
 * de entorno el escáner de secretos de Netlify encontraría ese mismo valor dentro
 * de config.js al desplegar y haría fallar la compilación.
 */

// Identificador público del proyecto Firebase; sólo sirve para pedirle a Google
// que valide un token. No concede ningún acceso por sí mismo.
const FIREBASE_API_KEY = 'AIzaSyBe7X5AUC-PpcJSCYgMzyyUMJMPqxtTdiw';

const ALLOWED_EMAIL_DOMAIN = '@visor.local';
const MAX_MESSAGE_LENGTH = 2000;
const VERIFY_URL = 'https://identitytoolkit.googleapis.com/v1/accounts:lookup';

function respond(statusCode, payload) {
    return {
        statusCode,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    };
}

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return respond(405, { error: 'Método no permitido.' });
    }

    const webhookUrl = process.env.MAKE_WEBHOOK_URL;
    if (!webhookUrl) {
        console.error('[notify] Falta la variable de entorno MAKE_WEBHOOK_URL.');
        return respond(500, { error: 'El servicio de avisos no está configurado.' });
    }

    const headers = event.headers || {};
    const rawAuth = headers.authorization || headers.Authorization || '';
    const idToken = rawAuth.startsWith('Bearer ') ? rawAuth.slice(7).trim() : '';
    if (!idToken) {
        return respond(401, { error: 'Falta el token de sesión.' });
    }

    let body;
    try {
        body = JSON.parse(event.body || '{}');
    } catch (e) {
        return respond(400, { error: 'Cuerpo de la petición no válido.' });
    }

    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message) {
        return respond(400, { error: 'Mensaje vacío.' });
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
        return respond(413, { error: `Mensaje demasiado largo (máximo ${MAX_MESSAGE_LENGTH} caracteres).` });
    }

    // Validar el token contra Google. No hace falta cuenta de servicio ni
    // dependencias: basta con la apiKey pública del proyecto.
    let email = '';
    try {
        const verification = await fetch(`${VERIFY_URL}?key=${encodeURIComponent(FIREBASE_API_KEY)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idToken })
        });
        if (!verification.ok) {
            return respond(401, { error: 'Sesión no válida o caducada.' });
        }
        const data = await verification.json();
        email = (data && data.users && data.users[0] && data.users[0].email) || '';
    } catch (e) {
        console.error('[notify] Error verificando el token:', e);
        return respond(502, { error: 'No se pudo verificar la sesión.' });
    }

    if (!email.toLowerCase().endsWith(ALLOWED_EMAIL_DOMAIN)) {
        return respond(403, { error: 'Esta cuenta no puede enviar avisos.' });
    }

    // Se reenvía con el MISMO formato que usaba el cliente, para que el escenario
    // de Make.com siga interpretándolo igual.
    try {
        const forwarded = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({ message })
        });
        if (!forwarded.ok) {
            console.error('[notify] Make.com respondió', forwarded.status);
            return respond(502, { error: 'El servicio de avisos rechazó el mensaje.' });
        }
    } catch (e) {
        console.error('[notify] Error contactando con Make.com:', e);
        return respond(502, { error: 'No se pudo contactar con el servicio de avisos.' });
    }

    return respond(200, { ok: true });
};
