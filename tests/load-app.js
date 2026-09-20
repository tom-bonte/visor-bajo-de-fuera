/**
 * Carga los ficheros reales de la app en un contexto aislado de Node, con lo
 * mínimo del navegador simulado. Así los tests ejercitan EL MISMO código que se
 * despliega, no una copia.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

function noop() {}
/**
 * Objeto que acepta cualquier llamada y devuelve otro igual, para imitar las
 * cadenas de Firestore: db.collection(x).where(y).where(z).onSnapshot(...).
 * Antes devolvía un objeto pelado a la primera llamada y la segunda reventaba,
 * lo que impedía cargar app.js en los tests.
 */
function chainable() {
    const target = function () { return proxy; };
    const proxy = new Proxy(target, {
        get: () => (() => proxy),
        apply: () => proxy
    });
    return proxy;
}

function loadApp() {
    const firestoreFn = () => ({
        collection: () => chainable(),
        doc: () => chainable(),
        batch: () => chainable(),
        runTransaction: async () => {},
        enablePersistence: () => Promise.resolve(),
        settings: () => {}
    });
    firestoreFn.FieldPath = { documentId: noop };
    firestoreFn.FieldValue = { serverTimestamp: () => '__TS__', delete: noop };

    const sandbox = {
        console,
        setTimeout, clearTimeout, setInterval, clearInterval,
        navigator: { onLine: true },
        window: {},
        // Pantalla de mentira: los tests registran sólo los campos que necesitan
        // con setElement('edit-salida-pax', { value: '4' }). Lo no registrado
        // devuelve null, igual que un id que no existe en la página real.
        __elements: {},
        document: {
            getElementById: (id) => sandbox.__elements[id] || null,
            querySelector: () => null,
            querySelectorAll: () => [],
            addEventListener: noop,
            body: { classList: { add: noop, remove: noop } },
            createElement: () => ({ classList: { add: noop, remove: noop }, setAttribute: noop, style: {} })
        },
        firebase: {
            initializeApp: noop,
            auth: () => ({ onAuthStateChanged: noop, currentUser: null }),
            firestore: firestoreFn
        },
        // Funciones de UI que la capa de datos invoca; irrelevantes para la lógica
        renderAll: noop, updateNotificationsUI: noop, showNotification: noop,
        showToast: noop, closeNotificationsModal: noop, renderNotificationsList: noop,
        renderHistoryView: noop, renderHeader: noop
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);

    for (const file of ['config.js', 'utils.js', 'bdf-logic.js', 'state.js', 'firebase-service.js', 'ui.js', 'export.js', 'app.js']) {
        const code = fs.readFileSync(path.join(ROOT, file), 'utf8');
        vm.runInContext(code, sandbox, { filename: file });
    }

    // Las declaraciones `const`/`let` de nivel superior NO quedan como propiedades
    // del objeto global del contexto (sólo las `function` y `var`), así que para
    // leerlas desde los tests hace falta evaluar dentro del propio contexto.
    sandbox.evaluate = (expression) => vm.runInContext(expression, sandbox);

    /** Añade un campo a la pantalla de mentira. */
    sandbox.setElement = (id, props = {}) => {
        sandbox.__elements[id] = {
            value: '', textContent: '', innerHTML: '', disabled: false,
            classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
            setAttribute: noop, querySelector: () => null, isConnected: true,
            style: {}, focus: noop, dataset: {}, appendChild: noop,
            ...props
        };
        return sandbox.__elements[id];
    };

    return sandbox;
}

module.exports = { loadApp };
