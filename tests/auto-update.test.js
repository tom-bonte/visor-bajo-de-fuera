/**
 * Tests de la actualización automática (auto-update.js).
 *
 * Lo que hay que demostrar no es que recargue, sino que NO recargue en mal
 * momento: con un diálogo abierto, mientras alguien escribe plazas, con una
 * escritura a medio guardar, o con la pestaña en segundo plano. Una recarga a
 * destiempo delante de una escuela es peor que quedarse en la versión vieja.
 *
 * Y que no se meta en un bucle de recargas si una caché intermedia sigue
 * sirviendo la versión vieja: eso dejaría la app inservible.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { section, check, ok, report } = require('./assert.js');

const ROOT = path.join(__dirname, '..');

/** Navegador de juguete con lo justo que usa auto-update.js. */
function cargar({ miVersion = '7.9', servidor = '7.9', visible = true, fallaFetch = false } = {}) {
    const oyentes = {};
    const estado = { recargas: 0, sesion: {}, modales: [], activo: null, consultas: [] };

    const sandbox = {
        console: { log: () => {} },
        Date, JSON, Math, String, RegExp, Promise, decodeURIComponent,
        setInterval: () => 0,
        location: { reload: () => { estado.recargas++; } },
        sessionStorage: {
            getItem: k => (k in estado.sesion ? estado.sesion[k] : null),
            setItem: (k, v) => { estado.sesion[k] = String(v); }
        },
        fetch: (url) => {
            estado.consultas.push(url);
            if (fallaFetch) return Promise.reject(new Error('sin red'));
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ version: servidor }) });
        },
        document: {
            currentScript: { src: `https://ejemplo.app/auto-update.js?v=${miVersion}` },
            get visibilityState() { return visible ? 'visible' : 'hidden'; },
            get activeElement() { return estado.activo; },
            querySelectorAll: () => estado.modales,
            addEventListener: (ev, fn) => { oyentes[ev] = fn; }
        }
    };
    sandbox.window = sandbox;
    sandbox.window.addEventListener = (ev, fn) => { oyentes[ev] = fn; };

    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'auto-update.js'), 'utf8'), sandbox, { filename: 'auto-update.js' });

    return { api: sandbox.window.autoUpdate, estado, oyentes, sandbox };
}

const modalAbierto = { classList: { contains: () => false } };
const modalCerrado = { classList: { contains: c => c === 'hidden' } };

(async () => {

// -------------------------------------------------------------------------
section('Sabe en qué versión está y cuál hay publicada');

const igual = cargar({ miVersion: '7.9', servidor: '7.9' });
check('lee su versión del ?v= con el que se cargó', igual.api.version(), '7.9');
check('misma versión: no hay novedad', await igual.api.comprobar(true), false);
check('y no recarga', igual.estado.recargas, 0);

const nueva = cargar({ miVersion: '7.8', servidor: '7.9' });
check('versión distinta: hay novedad', await nueva.api.comprobar(true), true);
check('y recarga', nueva.estado.recargas, 1);
check('apunta hacia qué versión iba', nueva.estado.sesion['bdf-recarga-hacia'], '7.9');

// -------------------------------------------------------------------------
section('No recarga en mal momento');

const conModal = cargar({ miVersion: '7.8', servidor: '7.9' });
conModal.estado.modales = [modalAbierto];
await conModal.api.comprobar(true);
check('con un cuadro de diálogo abierto, espera', conModal.estado.recargas, 0);
conModal.estado.modales = [modalCerrado];
check('al cerrarlo, ya sí', conModal.api.intentarRecargar(), true);
check('y recarga una sola vez', conModal.estado.recargas, 1);

for (const etiqueta of ['INPUT', 'TEXTAREA', 'SELECT']) {
    const escribiendo = cargar({ miVersion: '7.8', servidor: '7.9' });
    escribiendo.estado.activo = { tagName: etiqueta };
    await escribiendo.api.comprobar(true);
    check(`mientras se usa un ${etiqueta.toLowerCase()}, espera`, escribiendo.estado.recargas, 0);
}

const notaLarga = cargar({ miVersion: '7.8', servidor: '7.9' });
notaLarga.estado.activo = { tagName: 'DIV', isContentEditable: true };
await notaLarga.api.comprobar(true);
check('y mientras se edita texto, también', notaLarga.estado.recargas, 0);

const guardando = cargar({ miVersion: '7.8', servidor: '7.9' });
guardando.sandbox.bdfEscriturasEnVuelo = 1;
await guardando.api.comprobar(true);
check('con unas plazas a medio guardar, espera', guardando.estado.recargas, 0);
guardando.sandbox.bdfEscriturasEnVuelo = 0;
check('cuando termina de guardar, recarga', guardando.api.intentarRecargar(), true);

const aceptando = cargar({ miVersion: '7.8', servidor: '7.9' });
aceptando.sandbox.inFlightRequestIds = new Set(['req-1']);
await aceptando.api.comprobar(true);
check('aceptando una solicitud, espera', aceptando.estado.recargas, 0);

const enSegundoPlano = cargar({ miVersion: '7.8', servidor: '7.9', visible: false });
await enSegundoPlano.api.comprobar(true);
check('con la pestaña de fondo, no recarga', enSegundoPlano.estado.recargas, 0);
ok('pero se queda apuntado para luego', enSegundoPlano.api._estado().versionNueva === '7.9');

// -------------------------------------------------------------------------
section('Nada de bucles de recarga');

const bucle = cargar({ miVersion: '7.8', servidor: '7.9' });
bucle.estado.sesion['bdf-recarga-hacia'] = '7.9';   // ya lo intentamos antes
await bucle.api.comprobar(true);
check('si ya se intentó llegar a esa versión, no se repite', bucle.estado.recargas, 0);

const dosVeces = cargar({ miVersion: '7.8', servidor: '7.9' });
await dosVeces.api.comprobar(true);
dosVeces.api.intentarRecargar();
dosVeces.api.intentarRecargar();
check('una novedad sólo provoca UNA recarga', dosVeces.estado.recargas, 1);

// -------------------------------------------------------------------------
section('Cuando algo va mal, no molesta');

const sinRed = cargar({ miVersion: '7.8', servidor: '7.9', fallaFetch: true });
check('sin conexión, ni error ni recarga', await sinRed.api.comprobar(true), false);
check('', sinRed.estado.recargas, 0);

const sinVersionPropia = cargar({ miVersion: '', servidor: '7.9' });
check('si no sabe en qué versión está, no hace nada', await sinVersionPropia.api.comprobar(true), false);

const consultas = cargar({ miVersion: '7.9', servidor: '7.9' });
await consultas.api.comprobar(true);
await consultas.api.comprobar(false);
await consultas.api.comprobar(false);
check('no consulta al servidor a cada momento', consultas.estado.consultas.length, 1);
ok('y pide el fichero sin caché', /version\.json\?t=\d+/.test(consultas.estado.consultas[0]));

// -------------------------------------------------------------------------
section('Está conectado en la app y las versiones cuadran');

const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const swJs = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const versionJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8'));

ok('la app carga auto-update.js', /<script src="auto-update\.js\?v=/.test(indexHtml));
ok('el modo sin conexión lo guarda', swJs.includes('auto-update.js'));
ok('version.json NUNCA se sirve de la caché', /version\.json[\s\S]{0,200}fetch\(request\)/.test(swJs));

const versionesScripts = [...new Set([...indexHtml.matchAll(/src="[^"]+\.js\?v=([\d.]+)"/g)].map(m => m[1]))];
check('todos los scripts llevan la misma versión', versionesScripts.length, 1);
check('version.json dice exactamente esa versión', versionJson.version, versionesScripts[0]);
ok('y la caché del modo sin conexión también', swJs.includes(`bdf-cache-v${versionesScripts[0]}`));

const servicioSrc = fs.readFileSync(path.join(ROOT, 'firebase-service.js'), 'utf8');
ok('la app avisa cuando está guardando', /bdfEscriturasEnVuelo/.test(servicioSrc));
ok('y lo descuenta pase lo que pase (finally)', /finally \{[\s\S]{0,160}bdfEscriturasEnVuelo/.test(servicioSrc));

process.exit(report('ACTUALIZACIÓN AUTOMÁTICA'));

})();
