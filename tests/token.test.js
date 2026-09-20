/**
 * Tests de la comprobación del token de sesión (lib/verify-token.js).
 *
 * Esta pieza sustituye a "preguntarle a Google en cada escritura", así que más
 * vale que rechace exactamente lo mismo que rechazaría Google. Si aquí colase
 * un token falso, cualquiera podría escribir en nombre de cualquier escuela.
 *
 * Las claves de prueba se generan al vuelo con openssl: NO hay ninguna clave
 * guardada en el repositorio (además de ser mala idea, el escáner de secretos
 * de Netlify tumbaría el despliegue).
 */
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { section, check, ok, report } = require('./assert');

const { verifyIdToken } = require('../netlify/functions/lib/verify-token');

const PROYECTO = 'reserva-marina-cdp';
const KID = 'clave-de-prueba';

// --- Par de claves y certificado de usar y tirar -------------------------
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdf-token-'));
const keyPath = path.join(dir, 'key.pem');
const certPath = path.join(dir, 'cert.pem');
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', keyPath, '-out', certPath, '-days', '1', '-subj', '/CN=pruebas'],
    { stdio: 'ignore' });
const clavePrivada = fs.readFileSync(keyPath, 'utf8');
const certificado = fs.readFileSync(certPath, 'utf8');

// Otro par distinto, para firmar tokens que NO deberían valer.
const keyPath2 = path.join(dir, 'key2.pem');
const certPath2 = path.join(dir, 'cert2.pem');
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', keyPath2, '-out', certPath2, '-days', '1', '-subj', '/CN=intruso'],
    { stdio: 'ignore' });
const claveIntruso = fs.readFileSync(keyPath2, 'utf8');

// Google, de mentira: devuelve nuestro certificado de pruebas.
global.fetch = async () => ({
    ok: true,
    headers: { get: () => 'public, max-age=3600' },
    json: async () => ({ [KID]: certificado })
});

const b64 = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');

function token(payload = {}, opciones = {}) {
    const ahora = Math.floor(Date.now() / 1000);
    const cabecera = { alg: 'RS256', typ: 'JWT', kid: KID, ...(opciones.cabecera || {}) };
    const cuerpo = {
        iss: `https://securetoken.google.com/${PROYECTO}`,
        aud: PROYECTO,
        sub: 'uid-mangamar',
        email: 'mangamar@visor.local',
        iat: ahora - 60,
        exp: ahora + 3600,
        ...payload
    };
    const sinFirmar = `${b64(cabecera)}.${b64(cuerpo)}`;
    const firma = crypto.createSign('RSA-SHA256').update(sinFirmar)
        .sign(opciones.clave || clavePrivada).toString('base64url');
    return `${sinFirmar}.${opciones.firma !== undefined ? opciones.firma : firma}`;
}

(async () => {

// -------------------------------------------------------------------------
section('Un token bueno se acepta');

const bueno = await verifyIdToken(token(), PROYECTO);
ok('se acepta', !!bueno);
check('y dice de quién es', bueno && bueno.email, 'mangamar@visor.local');
check('con su identificador', bueno && bueno.uid, 'uid-mangamar');

// -------------------------------------------------------------------------
section('Tokens que hay que rechazar');

check('firmado por otro (falsificado)',
    await verifyIdToken(token({}, { clave: claveIntruso }), PROYECTO), null);
check('con la firma manipulada',
    await verifyIdToken(token({}, { firma: 'ZmlybWEtaW52ZW50YWRh' }), PROYECTO), null);
check('caducado hace una hora',
    await verifyIdToken(token({ exp: Math.floor(Date.now() / 1000) - 3600 }), PROYECTO), null);
check('emitido para otro proyecto',
    await verifyIdToken(token({ aud: 'otro-proyecto' }), PROYECTO), null);
check('emitido por otro (iss falso)',
    await verifyIdToken(token({ iss: 'https://securetoken.google.com/otro' }), PROYECTO), null);
check('sin sujeto',
    await verifyIdToken(token({ sub: '' }), PROYECTO), null);
check('con una clave que no conocemos',
    await verifyIdToken(token({}, { cabecera: { kid: 'otra-clave' } }), PROYECTO), null);
check('sin firma en absoluto (alg: none)',
    await verifyIdToken(token({}, { cabecera: { alg: 'none' } }), PROYECTO), null);
check('con algoritmo simétrico (el truco clásico)',
    await verifyIdToken(token({}, { cabecera: { alg: 'HS256' } }), PROYECTO), null);
check('texto cualquiera', await verifyIdToken('esto-no-es-un-token', PROYECTO), null);
check('vacío', await verifyIdToken('', PROYECTO), null);
check('nulo', await verifyIdToken(null, PROYECTO), null);
check('tres trozos de basura', await verifyIdToken('a.b.c', PROYECTO), null);

// -------------------------------------------------------------------------
section('El token del futuro (relojes desajustados)');

const ahora = Math.floor(Date.now() / 1000);
ok('un token emitido hace 30 segundos vale',
    !!(await verifyIdToken(token({ iat: ahora - 30 }), PROYECTO)));
ok('y uno con 30 segundos de adelanto también (tolerancia de reloj)',
    !!(await verifyIdToken(token({ iat: ahora + 30 }), PROYECTO)));
check('pero uno emitido dentro de una hora no',
    await verifyIdToken(token({ iat: ahora + 3600, exp: ahora + 7200 }), PROYECTO), null);

// -------------------------------------------------------------------------
section('La función usa la comprobación local');

const fuente = fs.readFileSync(path.join(__dirname, '..', 'netlify', 'functions', 'bdf-write.js'), 'utf8');
ok('se comprueba la firma aquí', /verifyIdToken\(idToken, firebaseConfig\.projectId\)/.test(fuente));
ok('un token inválido se rechaza sin más', /if \(!verificado\) return null;/.test(fuente));
ok('sólo se pregunta a Google si fallan las claves', /catch[\s\S]{0,200}identifyViaGoogle/.test(fuente));
ok('el token del servidor se pide en paralelo', /const tokenServidor = admin\.accessToken\(\)/.test(fuente));

fs.rmSync(dir, { recursive: true, force: true });
process.exit(report('TOKEN DE SESIÓN'));

})();
