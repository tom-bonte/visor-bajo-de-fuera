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
function chainable() {
    const obj = {};
    const handler = { get: () => (() => obj) };
    return new Proxy(obj, handler);
}

function loadApp() {
    const firestoreFn = () => ({
        collection: () => chainable(),
        doc: () => chainable(),
        batch: () => chainable(),
        runTransaction: async () => {},
        enablePersistence: () => Promise.resolve()
    });
    firestoreFn.FieldPath = { documentId: noop };
    firestoreFn.FieldValue = { serverTimestamp: () => '__TS__', delete: noop };

    const sandbox = {
        console,
        setTimeout, clearTimeout, setInterval, clearInterval,
        navigator: { onLine: true },
        window: {},
        document: {
            getElementById: () => null,
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

    for (const file of ['config.js', 'utils.js', 'state.js', 'firebase-service.js']) {
        const code = fs.readFileSync(path.join(ROOT, file), 'utf8');
        vm.runInContext(code, sandbox, { filename: file });
    }
    return sandbox;
}

module.exports = { loadApp };
