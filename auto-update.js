/**
 * @file auto-update.js
 * @description Mantiene a las ocho escuelas en la misma versión de la app.
 *
 * El problema: una pestaña abierta desde ayer sigue ejecutando el código de
 * ayer. Los arreglos de hoy no le llegan hasta que alguien recarga, y nadie
 * recarga. Así acaban ocho centros usando cinco versiones distintas, que es lo
 * que hizo tan confuso el fallo del 28/09/2026.
 *
 * Cómo funciona: el sitio publica su versión en version.json. Cada app compara
 * esa versión con la suya —que lee del propio ?v= con el que se cargó este
 * fichero— cuando alguien vuelve a la pestaña, y de vez en cuando mientras está
 * abierta. Si hay una versión nueva, se recarga sola.
 *
 * Pero NUNCA a destiempo: no se recarga con un cuadro de diálogo abierto, ni
 * mientras se escribe en un campo, ni con una escritura a medio guardar, ni con
 * la pestaña en segundo plano. Si no es buen momento, espera al siguiente.
 * Nada de avisos ni botones: la escuela vuelve de comer y está al día.
 */
(function () {
    'use strict';

    var VERSION_URL = 'version.json';
    var CADA = 30 * 60 * 1000;      // repaso periódico con la pestaña abierta
    var MINIMO_ENTRE_CONSULTAS = 60 * 1000;
    var CLAVE_INTENTO = 'bdf-recarga-hacia';

    // La versión de ESTA página: el ?v= con el que se pidió este mismo fichero.
    var miVersion = (function () {
        try {
            var src = (document.currentScript && document.currentScript.src) || '';
            var m = /[?&]v=([^&]+)/.exec(src);
            return m ? decodeURIComponent(m[1]) : null;
        } catch (e) { return null; }
    })();

    var versionNueva = null;    // la del servidor, cuando ya no coincide
    var ultimaConsulta = 0;

    function log(msg) {
        try { console.log('[BDF/versión] ' + msg); } catch (e) { /* da igual */ }
    }

    /**
     * ¿Se puede recargar ahora mismo sin molestar a nadie?
     * Recargar mientras alguien teclea plazas o confirma una cesión sería
     * bastante peor que quedarse en la versión vieja un rato más.
     */
    function esBuenMomento() {
        if (document.visibilityState !== 'visible') return false;

        // Algún cuadro de diálogo abierto (los modales se ocultan con .hidden)
        try {
            var modales = document.querySelectorAll('[id$="-modal"], .modal');
            for (var i = 0; i < modales.length; i++) {
                var m = modales[i];
                if (m.classList && !m.classList.contains('hidden')) return false;
            }
        } catch (e) { /* si no se puede mirar, se supone que sí */ }

        // Alguien escribiendo
        try {
            var a = document.activeElement;
            if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' ||
                      a.tagName === 'SELECT' || a.isContentEditable)) return false;
        } catch (e) { /* idem */ }

        // Una escritura a medio camino
        if (window.bdfEscriturasEnVuelo > 0) return false;
        try {
            if (window.inFlightRequestIds && window.inFlightRequestIds.size > 0) return false;
        } catch (e) { /* idem */ }

        return true;
    }

    /**
     * Evita el bucle: si ya recargamos para llegar a la versión X y seguimos sin
     * estar en X (una caché intermedia sirviendo lo viejo, por ejemplo), no se
     * vuelve a intentar. Mejor una versión vieja que una pestaña recargándose
     * sin parar delante de una escuela.
     */
    function yaLoIntentamos(destino) {
        try {
            return sessionStorage.getItem(CLAVE_INTENTO) === destino;
        } catch (e) { return false; }
    }

    function apuntarIntento(destino) {
        try { sessionStorage.setItem(CLAVE_INTENTO, destino); } catch (e) { /* sin sessionStorage, adelante */ }
    }

    function intentarRecargar() {
        if (!versionNueva) return false;
        if (yaLoIntentamos(versionNueva)) return false;
        if (!esBuenMomento()) return false;

        apuntarIntento(versionNueva);
        log('recargando para pasar de ' + miVersion + ' a ' + versionNueva);
        location.reload();
        return true;
    }

    function comprobar(forzar) {
        var ahora = Date.now();
        if (!forzar && ahora - ultimaConsulta < MINIMO_ENTRE_CONSULTAS) return Promise.resolve(false);
        ultimaConsulta = ahora;

        if (!miVersion) return Promise.resolve(false);   // sin ?v= no hay nada que comparar

        return fetch(VERSION_URL + '?t=' + ahora, { cache: 'no-store' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (datos) {
                var deServidor = datos && datos.version ? String(datos.version) : null;
                if (!deServidor || deServidor === miVersion) return false;
                versionNueva = deServidor;
                log('hay versión nueva: ' + deServidor + ' (esta pestaña tiene ' + miVersion + ')');
                intentarRecargar();
                return true;
            })
            .catch(function () { return false; });   // sin conexión: ya se mirará
    }

    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') {
            if (!intentarRecargar()) comprobar(false);
        }
    });
    window.addEventListener('focus', function () {
        if (!intentarRecargar()) comprobar(false);
    });
    setInterval(function () { comprobar(false); }, CADA);

    window.autoUpdate = {
        comprobar: comprobar,
        intentarRecargar: intentarRecargar,
        esBuenMomento: esBuenMomento,
        version: function () { return miVersion; },
        _estado: function () { return { miVersion: miVersion, versionNueva: versionNueva }; }
    };
})();
