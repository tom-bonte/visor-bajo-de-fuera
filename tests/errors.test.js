/**
 * Tests de la alarma de fallos (error-reporter.js).
 *
 * Se carga el fichero REAL en un navegador simulado, porque lo que importa aquí
 * no es la lógica sino el comportamiento en la página: que escuche desde el
 * principio, que no cargue nada de fuera si no hay DSN, que no mande nada desde
 * local, y que un fallo de la alarma nunca rompa la app de una escuela.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { section, check, ok, report } = require('./assert');

const ROOT = path.join(__dirname, '..');

/** El cargador que da Sentry al crear el proyecto (clave pública). */
const LOADER = 'https://js-de.sentry-cdn.com/clavedeprueba.min.js';

/** Navegador de juguete: sólo lo que el fichero usa de verdad. */
function loadReporter({ hostname = 'visor.netlify.app', protocol = 'https:' } = {}) {
    const listeners = {};
    const added = [];
    const logs = [];

    const sandbox = {
        console: {
            error: (...a) => logs.push(['error', a.join(' ')]),
            warn: (...a) => logs.push(['warn', a.join(' ')]),
            log: (...a) => logs.push(['log', a.join(' ')])
        },
        location: { hostname, protocol, href: `${protocol}//${hostname}/index.html?sesion=secreta` },
        document: {
            createElement: () => ({ set onload(f) { this._onload = f; }, get onload() { return this._onload; } }),
            head: { appendChild: el => added.push(el) }
        },
        Date, JSON, Error, String, Object, RegExp
    };
    sandbox.window = sandbox;
    sandbox.window.addEventListener = (evento, fn) => { listeners[evento] = fn; };

    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'error-reporter.js'), 'utf8'), sandbox);

    return { sandbox, listeners, added, logs, api: sandbox.window.errorReporter };
}

// -------------------------------------------------------------------------
section('Escucha desde el primer instante');

const inicial = loadReporter();
ok('se engancha a los errores sueltos', typeof inicial.listeners['error'] === 'function');
ok('y a las promesas rechazadas', typeof inicial.listeners['unhandledrejection'] === 'function');
check('no ha cargado nada de fuera todavía', inicial.added.length, 0);

inicial.listeners['error']({ error: new Error('fallo al pintar el calendario'), message: 'x' });
inicial.listeners['unhandledrejection']({ reason: new Error('Firestore no responde') });
check('los dos fallos quedan guardados', inicial.api._buffer().length, 2);
check('se apunta de qué tipo es cada uno', inicial.api._buffer().map(e => e.kind), ['error', 'promesa']);
ok('y el mensaje original', inicial.api._buffer()[0].message.includes('calendario'));
ok('también se ven en la consola', inicial.logs.some(l => l[0] === 'error' && l[1].includes('calendario')));

// -------------------------------------------------------------------------
section('Sin configurar no se carga nada de fuera');

const sinDsn = loadReporter();
sinDsn.api.start('', { centro: 'moondive' });
check('ningún script añadido a la página', sinDsn.added.length, 0);
ok('lo dice claramente en la consola', sinDsn.logs.some(l => l[1].includes('Sin SENTRY_LOADER_URL')));

// -------------------------------------------------------------------------
section('En local no se avisa a nadie');

const local = loadReporter({ hostname: 'localhost', protocol: 'http:' });
ok('reconoce el entorno local', local.api.isLocal());
local.api.start(LOADER, { centro: 'admin' });
check('no se carga Sentry probando en el portátil', local.added.length, 0);
ok('lo avisa', local.logs.some(l => l[1].includes('Entorno local')));

const produccion = loadReporter();
check('en el sitio real no es local', produccion.api.isLocal(), false);
produccion.api.start(LOADER, { centro: 'hormigas' });
check('ahí sí se carga Sentry', produccion.added.length, 1);
ok('desde el CDN oficial de Sentry', /^https:\/\/[\w-]+\.sentry-cdn\.com\//.test(String(produccion.added[0].src)));

// -------------------------------------------------------------------------
section('Arrancar dos veces no duplica nada');

produccion.api.start(LOADER, { centro: 'hormigas' });
check('sigue habiendo un solo script', produccion.added.length, 1);

// -------------------------------------------------------------------------
section('No se envía nada que no haga falta');

const limpiador = loadReporter().api;
const limpio = limpiador.scrub({
    request: { url: 'https://visor.netlify.app/index.html?token=abc123' },
    user: { email: 'mangamar@visor.local' },
    message: 'ha fallado algo con mangamar@visor.local'
});
ok('la URL pierde lo que va tras la interrogación', limpio.request.url === 'https://visor.netlify.app/index.html');
ok('el usuario no viaja', limpio.user === undefined);
ok('los correos se tapan', !JSON.stringify(limpio).includes('mangamar@visor.local'));
check('si el saneado falla, no se envía nada', limpiador.scrub(null), null);

// -------------------------------------------------------------------------
section('La alarma nunca rompe la app');

const roto = loadReporter();
let revento = false;
try {
    roto.listeners['error']({ error: null, message: null });
    roto.listeners['unhandledrejection']({ reason: 'un texto suelto, no un Error' });
    roto.api.report(undefined, 'sitio desconocido');
} catch (e) { revento = true; }
check('fallos raros no tiran la app', revento, false);
check('y aun así quedan registrados', roto.api._buffer().length, 3);

const tope = loadReporter();
for (let i = 0; i < 50; i++) tope.listeners['error']({ error: new Error('bucle ' + i), message: '' });
check('una avería en bucle no llena la memoria', tope.api._buffer().length, 20);

// -------------------------------------------------------------------------
section('La app está conectada a la alarma');

const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const serviceJs = fs.readFileSync(path.join(ROOT, 'firebase-service.js'), 'utf8');
const swJs = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');

ok('error-reporter.js se carga antes que cualquier otro script',
    indexHtml.indexOf('error-reporter.js') < indexHtml.indexOf('cdn.tailwindcss.com'));
ok('la app le dice qué centro es', /errorReporter\.start\(/.test(appJs));

const configJs = fs.readFileSync(path.join(ROOT, 'config.js'), 'utf8');
ok('config.js define el cargador de Sentry', /SENTRY_LOADER_URL\s*=/.test(configJs));
ok('y app.js usa esa misma constante', appJs.includes('SENTRY_LOADER_URL'));
ok('es un cargador de Sentry, no otra cosa', /SENTRY_LOADER_URL\s*=\s*"(|https:\/\/[\w-]+\.sentry-cdn\.com\/[\w]+\.min\.js)"/.test(configJs));
ok('los fallos que antes morían en la consola ahora se avisan', /reportFailure\(/.test(serviceJs));
check('ya no quedan console.error sueltos en firebase-service.js',
    (serviceJs.match(/console\.error/g) || []).length, 1); // el único que queda está DENTRO de reportFailure
ok('el modo sin conexión también guarda el fichero', swJs.includes('error-reporter.js'));

process.exit(report('ALARMA DE FALLOS'));
