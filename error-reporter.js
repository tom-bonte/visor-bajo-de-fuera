/**
 * @file error-reporter.js
 * @description Alarma de incendios de la app.
 *
 * Hasta ahora, cuando algo fallaba en el navegador de una escuela no se
 * enteraba nadie: ni la escuela (que veía una pantalla que no reaccionaba) ni
 * el administrador. Este fichero hace dos cosas:
 *
 *   1. Recoge TODOS los fallos del navegador (errores sueltos y promesas que
 *      revientan) desde el primer instante de la carga.
 *   2. Si hay un DSN de Sentry configurado en config.js, los manda allí. Si no
 *      lo hay, la app funciona exactamente igual y no se carga nada de fuera.
 *
 * Se carga EL PRIMERO, antes que ningún otro script: un fallo en config.js o en
 * Firebase también tiene que quedar registrado. Por eso guarda los fallos en
 * una lista y los reenvía cuando Sentry termina de cargarse.
 */
(function () {
    'use strict';

    var MAX_BUFFER = 20;              // más que esto y ya no es un fallo, es una avería

    var buffer = [];
    var started = false;
    var context = { centro: 'desconocido' };

    function isLocal() {
        return typeof location !== 'undefined' &&
            (location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.protocol === 'file:');
    }

    /** Un fallo, en el formato mínimo que necesitamos para entenderlo después. */
    function normalize(kind, error, message) {
        return {
            kind: kind,
            message: (error && error.message) || message || String(error || 'error desconocido'),
            stack: (error && error.stack) || null,
            url: typeof location !== 'undefined' ? location.href : '',
            at: new Date().toISOString()
        };
    }

    function record(entry) {
        // La consola sigue siendo la primera parada: en local es lo único que hay.
        console.error('[BDF] ' + entry.kind + ': ' + entry.message, entry.stack || '');

        if (window.Sentry && window.Sentry.captureException) {
            window.Sentry.captureException(entry.original || new Error(entry.message), {
                tags: { tipo: entry.kind, centro: context.centro }
            });
            return;
        }
        if (buffer.length < MAX_BUFFER) buffer.push(entry);
    }

    window.addEventListener('error', function (ev) {
        var entry = normalize('error', ev.error, ev.message);
        entry.original = ev.error;
        record(entry);
    });

    window.addEventListener('unhandledrejection', function (ev) {
        var entry = normalize('promesa', ev.reason, 'promesa rechazada sin gestionar');
        entry.original = ev.reason instanceof Error ? ev.reason : null;
        record(entry);
    });

    /** Fallos que la app ya captura en un try/catch pero que conviene registrar. */
    function report(error, donde) {
        var entry = normalize('avisado', error, donde);
        entry.original = error instanceof Error ? error : null;
        record(entry);
    }

    /** Quién está usando la app: sin esto un fallo no se puede reproducir. */
    function setContext(datos) {
        Object.keys(datos || {}).forEach(function (k) { context[k] = datos[k]; });
        if (window.Sentry && window.Sentry.setTag) window.Sentry.setTag('centro', context.centro);
    }

    /**
     * Arranca el envío a Sentry. Se llama desde app.js cuando config.js ya está
     * cargado. Sin URL no se descarga nada: ninguna escuela paga con su batería
     * un script que no vamos a usar.
     */
    function start(loaderUrl, datos) {
        setContext(datos);
        if (started) return;
        started = true;

        if (!loaderUrl) {
            console.log('[BDF] Sin SENTRY_LOADER_URL configurado: los fallos sólo se ven en esta consola.');
            return;
        }
        if (isLocal()) {
            console.log('[BDF] Entorno local: los fallos NO se envían a Sentry.');
            return;
        }

        var script = document.createElement('script');
        script.src = loaderUrl;
        script.crossOrigin = 'anonymous';
        script.onload = function () {
            try {
                // El cargador de Sentry deja un Sentry de mentira que va apuntando
                // lo que ocurra; onLoad se ejecuta cuando ya está el de verdad.
                window.Sentry.onLoad(function () {
                    window.Sentry.init({
                        // Sólo fallos: ni grabación de sesiones ni medición de
                        // rendimiento. Nadie está vigilando cómo trabajan las escuelas.
                        tracesSampleRate: 0,
                        beforeSend: scrub
                    });
                    window.Sentry.setTag('centro', context.centro);
                });
                flush();
            } catch (e) {
                console.error('[BDF] Sentry no ha arrancado:', e);
            }
        };
        script.onerror = function () {
            console.warn('[BDF] No se ha podido cargar Sentry. La app sigue funcionando.');
        };
        document.head.appendChild(script);
    }

    /** Reenvía a Sentry los fallos ocurridos antes de que estuviera disponible. */
    function flush() {
        if (!window.Sentry || !window.Sentry.captureException) return;
        buffer.forEach(function (entry) {
            window.Sentry.captureException(entry.original || new Error(entry.message), {
                tags: { tipo: entry.kind, centro: context.centro }
            });
        });
        buffer = [];
    }

    /**
     * Quita de los informes cualquier cosa que no nos haga falta. Aquí no se
     * manejan datos personales de buceadores, pero una URL puede llevar la
     * sesión pegada y un correo identifica a una escuela: fuera los dos.
     */
    function scrub(event) {
        try {
            if (event.request && event.request.url) {
                event.request.url = String(event.request.url).split('?')[0];
            }
            if (event.user) delete event.user;
            var texto = JSON.stringify(event);
            if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(texto)) {
                event = JSON.parse(texto.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[correo]'));
            }
        } catch (e) { /* si el saneado falla, es mejor no enviar nada */ return null; }
        return event;
    }

    window.errorReporter = { start: start, report: report, setContext: setContext, scrub: scrub, isLocal: isLocal, _buffer: function () { return buffer; } };
})();
