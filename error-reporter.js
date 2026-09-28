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
     * Avisos del almacenamiento del navegador, NO fallos de la app.
     *
     * Los dos casos reales, el 28/09/2026, del mismo iPhone con Safari:
     *   "UnknownError: Database deleted by request of the user"
     *   "UnknownError: An internal error was encountered in the Indexed Database server"
     *
     * Suenan a catástrofe y no lo son. La "database" es la copia del calendario
     * que la app guarda DENTRO del teléfono para funcionar sin cobertura. Safari
     * la borra por su cuenta cuando se limpian los datos del sitio, se navega en
     * privado, escasea el espacio o pasa una semana sin entrar; y el
     * almacenamiento de Safari en iOS falla de vez en cuando por sus propios
     * motivos. Cloud Firestore ni se entera: el teléfono vuelve a descargar el
     * calendario y sigue. De hecho estos sucesos llegan marcados como
     * 'handled: yes', es decir, la app no se rompió.
     *
     * Se marcan como 'warning' y se agrupan aparte. NO se descartan: uno suelto
     * es Safari siendo Safari; doscientos en un día significaría que el modo sin
     * conexión está roto de verdad, y eso sí hay que verlo.
     */
    var AVISOS_DE_ALMACENAMIENTO = [
        /database deleted by request of the user/i,
        /internal error was encountered in the indexed database server/i,
        /the operation failed for reasons unrelated to the database itself/i,
        /a mutation operation was attempted on a database that did not allow mutations/i,
        /an attempt was made to open a database using a lower version/i,
        /connection to indexed database server lost/i,
        /quota.?exceeded/i
    ];

    function esAvisoDeAlmacenamiento(event) {
        var mensajes = [];
        try {
            if (event.message) mensajes.push(String(event.message));
            var valores = (event.exception && event.exception.values) || [];
            valores.forEach(function (v) {
                if (!v) return;
                if (v.value) mensajes.push(String(v.value));
                if (v.type) mensajes.push(String(v.type) + ': ' + String(v.value || ''));
            });
        } catch (e) { return false; }

        return mensajes.some(function (m) {
            return AVISOS_DE_ALMACENAMIENTO.some(function (patron) { return patron.test(m); });
        });
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

            if (esAvisoDeAlmacenamiento(event)) {
                event.level = 'warning';
                // Huella propia: todos estos avisos caen en un mismo grupo en
                // vez de mezclarse con los fallos de verdad.
                event.fingerprint = ['almacenamiento-del-navegador'];
                event.tags = event.tags || {};
                event.tags.causa = 'limpieza-del-navegador';
            }

            var texto = JSON.stringify(event);
            if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(texto)) {
                event = JSON.parse(texto.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[correo]'));
            }
        } catch (e) { /* si el saneado falla, es mejor no enviar nada */ return null; }
        return event;
    }

    window.errorReporter = { start: start, report: report, setContext: setContext, scrub: scrub, isLocal: isLocal, _buffer: function () { return buffer; } };
})();
