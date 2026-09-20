/**
 * @file firebase-service.js
 * @description Capa de datos y sincronización con Firebase Firestore y Auth para Visor Bajo de Fuera.
 * Utiliza colecciones independientes ('bdf_days', 'bdf_history_logs') para total aislamiento.
 */

// Inicialización de Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// Habilitar persistencia offline con soporte multi-pestaña para IndexedDB
db.enablePersistence({ synchronizeTabs: true }).catch((err) => {
    if (err.code === 'failed-precondition') {
        console.info('[Firestore] Persistencia offline limitada a la pestaña principal.');
    } else if (err.code === 'unimplemented') {
        console.warn('[Firestore] Este navegador no soporta IndexedDB para persistencia offline.');
    } else {
        console.warn('[Firestore] Aviso persistencia offline:', err);
    }
});

// Punteros a los listeners activos
let unsubscribeDayListener = null;
let unsubscribeMonthListener = null;
let unsubscribeHistoryListener = null;

/**
 * Un fallo que la app ya ha capturado, pero del que nadie se enteraba: iba a la
 * consola del navegador de la escuela y ahí moría. Ahora además se envía a la
 * alarma (Sentry) si está configurada.
 */
function reportFailure(err, donde) {
    console.error(donde + ':', err);
    if (typeof window !== 'undefined' && window.errorReporter) window.errorReporter.report(err, donde);
}

/**
 * Dispara el webhook a Make.com para notificar al grupo de WhatsApp de Bajo de Fuera.
 * @param {string} msg
 */
async function sendBdfWebhook(msg) {
    // Para el admin: NUNCA enviar mensajes a WhatsApp
    if (currentUserKey === 'admin') {
        console.log("[Admin bypass] No se envían mensajes a WhatsApp en modo Administrador.");
        return;
    }

    // En local no existe la función de Netlify (el servidor de pruebas sólo sirve
    // ficheros), así que la petición fallaría con un 501 confuso. Se avisa claro
    // y no se envía: probar en local nunca debe escribir en el grupo real.
    if (typeof location !== 'undefined' &&
        (location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.protocol === 'file:')) {
        console.log('[WhatsApp] Entorno local: el aviso NO se envía. Mensaje preparado:\n' + msg);
        return;
    }

    // El aviso pasa por el proxy de Netlify, que guarda la URL real del webhook
    // y exige un token de sesión válido. Sin sesión no se envía nada.
    const user = auth.currentUser;
    if (!user) {
        console.log("[WhatsApp] Sin sesión iniciada: no se envía el aviso.");
        return;
    }

    try {
        const idToken = await user.getIdToken();
        const response = await fetch(WHATSAPP_PROXY_PATH, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({ message: msg })
        });
        if (!response.ok) {
            let detail = '';
            try { detail = (await response.json()).error || ''; } catch (e) { /* respuesta sin JSON */ }
            reportFailure(new Error(`${response.status} ${detail}`), '[WhatsApp] El aviso no se pudo enviar');
        }
    } catch (e) {
        reportFailure(e, "Error enviando el aviso de WhatsApp");
    }
}

/**
 * Registra una acción en la colección de auditoría bdf_history_logs.
 * @param {string} actionType - 'transfer' | 'release' | 'claim' | 'admin_quota'
 * @param {Object} details - Datos descriptivos de la acción.
 */
async function logBdfHistory(actionType, details) {
    // Las acciones realizadas por el Administrador o en modo invitado no se registran en el historial
    if (currentUserKey === 'admin' || isGuestMode) return;

    try {
        await db.collection(BDF_COLLECTIONS.HISTORY).add({
            actionType,
            centerKey: currentUserKey,
            details,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
    } catch (e) {
        reportFailure(e, "Error escribiendo en log de historial");
    }
}

/**
 * Traduce un error de Firestore en un mensaje claro y accionable para el usuario.
 * Las transacciones necesitan conexión: sin cobertura fallan, y el usuario debe
 * entender que NO se ha guardado nada en lugar de ver un error técnico.
 * @param {Error} err
 * @param {string} action - Acción en infinitivo, p. ej. 'eliminar las plazas'
 * @returns {string}
 */
function describeFirestoreError(err, action = 'guardar los cambios') {
    const code = (err && err.code) || '';
    const raw = String((err && err.message) || '');

    const isOffline = navigator.onLine === false
        || code === 'unavailable'
        || code === 'deadline-exceeded'
        || raw.includes('client is offline');

    if (isOffline) {
        return `Sin conexión a Internet: no se ha podido ${action}. No se ha cambiado nada. Vuelve a intentarlo cuando tengas señal.`;
    }
    if (code === 'aborted' || code === 'failed-precondition') {
        return `Otra escuela estaba modificando este día justo al mismo tiempo. No se ha cambiado nada. Vuelve a intentarlo.`;
    }
    if (code === 'permission-denied') {
        return `No tienes permisos para ${action}. Cierra sesión y vuelve a entrar.`;
    }
    return raw || `No se ha podido ${action}.`;
}

/**
 * Inicia la escucha en tiempo real de los datos del día seleccionado.
 * @param {string} dateStr - 'YYYY-MM-DD'
 */
function listenCurrentDay(dateStr) {
    if (unsubscribeDayListener) {
        unsubscribeDayListener();
        unsubscribeDayListener = null;
    }

    const docRef = db.collection(BDF_COLLECTIONS.DAYS).doc(dateStr);
    unsubscribeDayListener = docRef.onSnapshot((doc) => {
        if (doc.exists) {
            currentDayData = { id: doc.id, ...doc.data() };
        } else {
            // Estructura por defecto para días sin inicializar
            currentDayData = {
                id: dateStr,
                date: dateStr,
                totalQuota: getDayQuota(dateStr, null),
                salidas: [],
                allocations: {}
            };
        }
        monthDaysCache[dateStr] = currentDayData;
        renderAll();
    }, (error) => {
        reportFailure(error, "Error escuchando día en Firestore");
    });
}

/**
 * Inicia la escucha de un rango de fechas visible para el calendario.
 * Soporta (startStr, endStr) en formato 'YYYY-MM-DD', o (year, month) para retrocompatibilidad.
 * @param {string|number} startDateOrYear
 * @param {string|number} endDateOrMonth
 */
function listenMonthOverview(startDateOrYear, endDateOrMonth) {
    if (unsubscribeMonthListener) {
        unsubscribeMonthListener();
        unsubscribeMonthListener = null;
    }

    let startStr = startDateOrYear;
    let endStr = endDateOrMonth;

    // Retrocompatibilidad si se pasa (year, month)
    if (typeof startDateOrYear === 'number') {
        const year = startDateOrYear;
        const month = endDateOrMonth;
        const firstDay = new Date(year, month, 1);
        let startDow = firstDay.getDay() - 1;
        if (startDow === -1) startDow = 6;
        const firstVis = new Date(year, month, 1 - startDow);
        const lastDay = new Date(year, month + 1, 0);
        const total = startDow + lastDay.getDate();
        const rem = (7 - (total % 7)) % 7;
        const lastVis = new Date(year, month, lastDay.getDate() + rem);
        startStr = getStrYMD(firstVis);
        endStr = getStrYMD(lastVis);
    }

    unsubscribeMonthListener = db.collection(BDF_COLLECTIONS.DAYS)
        .where(firebase.firestore.FieldPath.documentId(), '>=', startStr)
        .where(firebase.firestore.FieldPath.documentId(), '<=', endStr)
        .onSnapshot((snapshot) => {
            snapshot.forEach(doc => {
                const d = doc.data() || {};
                monthDaysCache[doc.id] = { id: doc.id, date: doc.id, ...d };
            });
            renderAll();
        }, (error) => {
            reportFailure(error, "Error escuchando rango en Firestore");
        });
}

/**
 * Asegura que los datos de un día estén cargados en monthDaysCache.
 * Si no están en caché, los consulta directamente de Firestore antes de operar.
 * @param {string} dateStr - 'YYYY-MM-DD'
 * @returns {Promise<Object>}
 */
async function ensureDayInCache(dateStr) {
    if (monthDaysCache[dateStr]) {
        return monthDaysCache[dateStr];
    }
    const dayCap = getDayQuota(dateStr);
    try {
        const docSnap = await db.collection(BDF_COLLECTIONS.DAYS).doc(dateStr).get();
        if (docSnap.exists) {
            const d = docSnap.data() || {};
            monthDaysCache[dateStr] = { id: dateStr, date: dateStr, totalQuota: dayCap, ...d };
        } else {
            monthDaysCache[dateStr] = { id: dateStr, date: dateStr, totalQuota: dayCap, salidas: [], allocations: {} };
        }
    } catch (err) {
        reportFailure(err, `Error obteniendo día ${dateStr} de Firestore`);
        if (!monthDaysCache[dateStr]) {
            monthDaysCache[dateStr] = { id: dateStr, date: dateStr, totalQuota: dayCap, salidas: [], allocations: {} };
        }
    }
    return monthDaysCache[dateStr];
}

/**
 * Inicia la escucha del feed de actividad / historial.
 */
function listenHistoryLogs() {
    if (unsubscribeHistoryListener) {
        unsubscribeHistoryListener();
        unsubscribeHistoryListener = null;
    }

    unsubscribeHistoryListener = db.collection(BDF_COLLECTIONS.HISTORY)
        .orderBy('timestamp', 'desc')
        .limit(100)
        .onSnapshot((snapshot) => {
            const logs = [];
            snapshot.forEach(doc => {
                logs.push({ id: doc.id, ...doc.data() });
            });
            historyLogs = logs;
            if (activeViewMode === 'historial') {
                renderHistoryView();
            }
        }, (error) => {
            reportFailure(error, "Error escuchando historial en Firestore");
        });
}

let unsubscribeRequestsListener = null;

/**
 * Inicia la escucha en tiempo real de solicitudes pendientes (intercambios y peticiones).
 */
function listenBdfRequests() {
    if (unsubscribeRequestsListener) {
        unsubscribeRequestsListener();
        unsubscribeRequestsListener = null;
    }

    // Las solicitudes sólo las pueden leer los centros con sesión (así lo exigen
    // las reglas). En modo consulta esto pedía permiso igualmente y Firestore
    // respondía "Missing or insufficient permissions" en CADA visita: un fallo
    // que nadie veía hasta que se instaló la alarma. No se pide y ya está.
    if (typeof auth === 'undefined' || !auth.currentUser) {
        bdfRequests = [];
        if (typeof updateNotificationsUI === 'function') updateNotificationsUI();
        return;
    }

    unsubscribeRequestsListener = db.collection(BDF_COLLECTIONS.REQUESTS)
        .where('status', '==', 'pending')
        .onSnapshot((snapshot) => {
            const reqs = [];
            const todayStr = getStrYMD(new Date());

            snapshot.forEach(doc => {
                const data = doc.data();
                // Cesión directa ya la ejecuta directamente el centro cedente en confirmCesionDirecta()
                if (data.type === 'donation') {
                    // Si existen documentos antiguos pendientes de donation en bdf_requests, limpiarlos una sola vez desde admin
                    // (La limpieza de 'donation' heredados la hace el admin a mano.)
                    return;
                }

                // Solicitudes de fechas ya pasadas: se ocultan SIEMPRE en local.
                // Antes, cualquier navegador que abriese la app marcaba como 'expired'
                // las solicitudes de cualquier escuela usando SU reloj: un dispositivo
                // con la fecha o la zona horaria mal caducaba propuestas ajenas todavía
                // válidas. Ahora sólo escribe quien es parte de la solicitud (o el admin),
                // así un reloj equivocado sólo puede afectar a lo suyo.
                const isExpired = data.type === 'swap'
                    ? ((data.dateA && data.dateA < todayStr) || (data.dateB && data.dateB < todayStr))
                    : (data.date && data.date < todayStr);

                if (isExpired) {
                    const myCode = USER_CENTER_KEYS[currentUserKey];
                    const isMine = currentUserKey === 'admin' || (myCode && (
                        normCenter(data.initiatorCenter) === normCenter(myCode) ||
                        normCenter(data.targetCenter) === normCenter(myCode)
                    ));
                    // La caducidad ya no se escribe desde el navegador: se oculta
                    // en local y punto. Escribirla obligaba a cada dispositivo a
                    // tener el reloj en hora y, con las escrituras en el servidor,
                    // ya no tiene permiso para hacerlo.
                    return;
                }

                reqs.push({ id: doc.id, ...data });
            });
            bdfRequests = reqs;
            updateNotificationsUI();
            if (activeViewMode === 'mensual') {
                renderAll();
            }
        }, (error) => {
            reportFailure(error, "Error escuchando solicitudes en Firestore");
        });
}

/**
 * Crea una nueva solicitud en Firestore para que la reciba el otro centro.
 * @param {Object} data
 */
async function createBdfRequest(data) {
    return await callBdfWrite('createRequest', { request: data });
}

/** Solicitudes que se están procesando ahora mismo, para bloquear la doble pulsación. */
const inFlightRequestIds = new Set();

/**
 * Acepta cualquier solicitud pendiente (Intercambio, Petición o Cesión Directa).
 *
 * Con conexión lenta es fácil pulsar "Aceptar" dos veces; ambas llamadas llegaban a
 * ejecutarse y duplicaban las plazas. Aquí se bloquea la segunda pulsación y se da
 * feedback inmediato en el botón. La transacción de abajo es además idempotente:
 * si la solicitud ya no existe, no aplica nada.
 *
 * @param {string} requestId
 * @param {HTMLElement} [btnEl] - Botón pulsado, para deshabilitarlo mientras se procesa.
 */
async function acceptBdfRequest(requestId, btnEl = null) {
    if (inFlightRequestIds.has(requestId)) return;

    const req = bdfRequests.find(r => r.id === requestId);
    if (!req) {
        showNotification('Error', 'La solicitud ya no está disponible.', true);
        return;
    }

    const todayStr = getStrYMD(new Date());
    const isPast = (req.type === 'swap') ? (req.dateA < todayStr || req.dateB < todayStr) : (req.date < todayStr);
    if (isPast) {
        showNotification('Solicitud Caducada', 'Esta solicitud corresponde a una fecha que ya ha pasado y no se puede aceptar.', true);
        await cancelBdfRequest(requestId);
        return;
    }

    inFlightRequestIds.add(requestId);
    let originalLabel = null;
    if (btnEl) {
        originalLabel = btnEl.innerHTML;
        btnEl.disabled = true;
        btnEl.classList.add('opacity-60', 'cursor-not-allowed');
        btnEl.textContent = 'Procesando…';
    }

    try {
        // El servidor vuelve a leer la solicitud y los días, aplica el acuerdo y
        // borra la petición en una sola operación: o se hace todo, o nada.
        await callBdfWrite('acceptRequest', { requestId });
        showNotification(
            req.type === 'swap' ? 'Intercambio Completado' : 'Plazas Cedidas',
            'La solicitud se ha aplicado correctamente.',
            false
        );
        if (getEl('notifications-modal') && !getEl('notifications-modal').classList.contains('hidden')) {
            renderNotificationsList();
        }
    } catch (err) {
        reportFailure(err, "Error al aceptar solicitud");
        showNotification('Error', friendlyError(err, 'aplicar la solicitud'), true);
        renderAll();
    } finally {
        inFlightRequestIds.delete(requestId);
        if (btnEl && btnEl.isConnected) {
            btnEl.disabled = false;
            btnEl.classList.remove('opacity-60', 'cursor-not-allowed');
            btnEl.innerHTML = originalLabel;
        }
    }
}

/**
 * Acepta un intercambio propuesto (Swap) aplicando las fórmulas de split y retención (Section 5).
 *
 * TODO ocurre dentro de UNA sola transacción atómica: se leen la solicitud y los dos días
 * del servidor, se recalculan space_A/space_B/safe_A/safe_B con datos VIVOS (Section 5,
 * Case 4, paso 7), se aplican los cambios y se borra la solicitud. O pasa todo, o no pasa nada.
 *
 * Esto evita tres fallos del enfoque anterior en tres pasos sueltos:
 *  - pulsar "Aceptar" dos veces duplicaba las plazas que llegaban al día destino;
 *  - se validaba contra monthDaysCache (posiblemente obsoleta) y luego se aplicaban
 *    números absolutos, lo que podía destruir plazas añadidas mientras tanto;
 *  - si el borrado de la solicitud fallaba, quedaba pendiente y bloqueando plazas.
 *
 * @param {Object} req
 */
// acceptBdfSwap vivía aquí: aplicaba el acuerdo desde el navegador. Ahora lo hace el
// servidor (netlify/functions/bdf-write.js), que es el único que puede
// comprobar que quien acepta es de verdad el centro destinatario.

/**
 * Acepta una transferencia de plazas entre dos escuelas el mismo día (Sections 3 y 3.1).
 *
 * Igual que el intercambio, todo ocurre en UNA transacción atómica: se leen la solicitud
 * y el día, se comprueba que la escuela cedente sigue teniendo esas plazas, se aplica la
 * transferencia y se borra la solicitud.
 *
 * Las plazas cedidas se SUMAN al total de la escuela receptora ese día (principio aditivo
 * de Section 0); nunca se crea un segundo registro para la misma escuela y día.
 *
 * Si la propuesta ya no es válida (Section 3.B.4) se elimina con un aviso, en lugar de
 * quedarse pendiente bloqueando las plazas indefinidamente.
 *
 * @param {Object} req
 */
// acceptBdfSpotTransfer vivía aquí: aplicaba el acuerdo desde el navegador. Ahora lo hace el
// servidor (netlify/functions/bdf-write.js), que es el único que puede
// comprobar que quien acepta es de verdad el centro destinatario.

/**
 * Cancela una solicitud enviada por el centro propio (Section 6).
 * Desbloquea inmediatamente la(s) salida(s) asociadas.
 * @param {string} requestId
 */
async function cancelBdfRequest(requestId) {
    try {
        await callBdfWrite('cancelRequest', { requestId });
        if (getEl('pending-request-action-modal')) {
            hideEl('pending-request-action-modal');
        }
        if (getEl('notifications-modal') && !getEl('notifications-modal').classList.contains('hidden')) {
            renderNotificationsList();
        }
        showToast('Solicitud Retirada', 'La petición ha sido cancelada y las plazas quedan desbloqueadas.');
    } catch (err) {
        reportFailure(err, "Error al cancelar solicitud");
        showNotification('Error', friendlyError(err, 'retirar la solicitud'), true);
    }
}

/**
 * Rechaza y elimina una solicitud pendiente sin modificar el calendario (Section 3B / 3.1).
 * Desbloquea la(s) salida(s) asociadas.
 * @param {string} requestId
 */
async function rejectBdfRequest(requestId) {
    try {
        await callBdfWrite('rejectRequest', { requestId });
        if (getEl('pending-request-action-modal')) {
            hideEl('pending-request-action-modal');
        }
        if (getEl('notifications-modal') && !getEl('notifications-modal').classList.contains('hidden')) {
            renderNotificationsList();
        }
        showToast('Solicitud Denegada', 'La petición ha sido rechazada y las plazas quedan desbloqueadas.');
    } catch (err) {
        reportFailure(err, "Error al rechazar solicitud");
        showNotification('Error', friendlyError(err, 'rechazar la solicitud'), true);
    }
}

/* =========================================================================
   TRANSACCIONES Y OPERACIONES DE PLAZAS
   ========================================================================= */


/* =========================================================================
   ESCRITURAS: TODAS PASAN POR EL SERVIDOR
   =========================================================================
   Antes cada navegador escribía directamente en Firestore. Las reglas pueden
   comprobar que un día queda válido, pero no de quién son las plazas que has
   tocado, así que cualquier centro con la consola abierta podía reescribir el
   día entero y borrar los barcos de los demás.
   Ahora se le pide al servidor, que sí sabe quién eres y vuelve a mirar el dato
   real antes de escribir. La pantalla no se adelanta: se espera la confirmación
   y el propio listener de Firestore refresca el calendario.
   ========================================================================= */

/**
 * Envía una operación de escritura al servidor con el token de sesión.
 * @param {string} op
 * @param {Object} payload
 */
async function callBdfWrite(op, payload = {}) {
    if (typeof location !== 'undefined' &&
        (location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.protocol === 'file:')) {
        throw new Error('Estás en el servidor de pruebas local, donde no existe la función de escritura. Para probar cambios usa la vista previa de Netlify.');
    }

    const user = auth.currentUser;
    if (!user) throw new Error('Tu sesión ha caducado. Vuelve a iniciar sesión.');

    let res;
    try {
        const idToken = await user.getIdToken();
        res = await fetch(BDF_WRITE_PATH, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
            body: JSON.stringify({ op, ...payload })
        });
    } catch (e) {
        throw new Error('No hay conexión con el servidor. No se ha cambiado nada.');
    }

    let data = {};
    try { data = await res.json(); } catch (e) { /* respuesta sin cuerpo */ }

    if (!res.ok) {
        const err = new Error(data.error || 'No se ha podido guardar el cambio.');
        err.serverStatus = res.status;
        throw err;
    }
    return data;
}


/**
 * El texto que ve una escuela cuando algo falla.
 *
 * Los errores que vienen de nuestro servidor ya están escritos en castellano y
 * explican el motivo ("otro centro ha cambiado ese día a la vez"), así que se
 * muestran tal cual. Los que vienen de Firebase (las herramientas del admin,
 * que siguen escribiendo directamente, y los fallos de conexión) llegan en
 * inglés y en lenguaje de programador: esos se traducen. Antes se enseñaba
 * "FirebaseError: Missing or insufficient permissions" y nadie sabía si su
 * reserva se había guardado o no.
 *
 * @param {Error} err
 * @param {string} accion - qué se estaba intentando: 'guardar las plazas'…
 */
function friendlyError(err, accion = 'guardar los cambios') {
    if (!err) return `No se ha podido ${accion}.`;
    // Mensaje ya redactado por nuestra función del servidor.
    if (err.serverStatus) return err.message;
    return describeFirestoreError(err, accion);
}

/** Marca de tiempo del servidor de Firestore (el navegador no pone su reloj). */
function serverStamp() {
    return firebase.firestore.FieldValue.serverTimestamp();
}

// La aritmética de plazas (añadir, quitar, ceder, intercambiar) vive ahora en
// bdf-logic.js, compartida palabra por palabra con la función del servidor.


/**
 * Añade plazas a un día para una escuela (Section 1).
 * Si la escuela ya tiene plazas ese día, se SUMAN a su total existente (principio aditivo).
 * El límite de entrada es plazas_libres (sin límite de 12).
 * @param {string} dateStr - 'YYYY-MM-DD'
 * @param {string} centerCode - 'MD', 'M', etc.
 * @param {number} pax - Plazas asignadas (1..plazas_libres)
 * @param {string} [note]
 */
async function executeAddSalida(dateStr, centerCode, pax, note = '') {
    pax = parseInt(pax, 10);
    if (isNaN(pax) || pax <= 0) throw new Error("La cantidad de plazas debe ser mayor a 0");

    // El cupo se vuelve a comprobar en el servidor sobre el dato real; esto es
    // sólo para avisar antes de dar el viaje por bueno.
    const dayCap = getDayQuota(dateStr, monthDaysCache[dateStr] || null);
    const summary = getDaySummary(monthDaysCache[dateStr] || null, dateStr);
    const remaining = Math.max(0, dayCap - summary.totalOccupied);
    if (pax > remaining) {
        throw new Error(`Cupo diario excedido: solo quedan ${remaining} plazas disponibles hoy (máximo ${dayCap} plazas/día).`);
    }

    await callBdfWrite('addSalida', {
        dateStr,
        centerCode: normCenter(centerCode),
        pax,
        note: sanitizeNote(note)
    });
}

/**
 * Modifica las plazas, centro o nota de una salida existente optimísticamente (Section 2).
 * @param {string} dateStr
 * @param {string} salidaId
 * @param {number} newPax
 * @param {string} [newCenterCode]
 * @param {string} [newNote]
 */
async function executeEditSalida(dateStr, salidaId, newPax, newCenterCode = null, newNote = '') {
    newPax = parseInt(newPax, 10);
    if (isNaN(newPax) || newPax <= 0) throw new Error("La cantidad de plazas debe ser mayor a 0");

    await callBdfWrite('editSalida', {
        dateStr,
        salidaId,
        pax: newPax,
        newCenterCode: newCenterCode ? normCenter(newCenterCode) : null,
        note: sanitizeNote(newNote)
    });
}

/**
 * Elimina las plazas de una escuela en un día (Section 2, Opción 3).
 *
 * Se ejecuta dentro de una transacción atómica: relee el documento del servidor y
 * elimina ÚNICAMENTE el registro de esa escuela sobre la lista VIVA. Nunca sobrescribe
 * el día entero con la copia local, que puede estar desactualizada y borraría las
 * plazas que otras escuelas hayan añadido mientras tanto.
 *
 * @param {string} dateStr
 * @param {string} salidaId
 * @param {string} [centerCode]
 */
async function executeDeleteSalida(dateStr, salidaId, centerCode = null) {
    await callBdfWrite('deleteSalida', {
        dateStr,
        salidaId,
        centerCode: centerCode ? normCenter(centerCode) : null
    });
}

/**
 * Mueve plazas de una escuela a otro día optimísticamente en 0ms (Scenario 4A / 4B Opción 1).
 * Actualiza la memoria local y el DOM de inmediato, y persiste los cambios a Firestore de fondo.
 * En caso de fallo de red, revierte el estado local y alerta al usuario.
 * @param {string} sourceDate
 * @param {string} targetDate
 * @param {string} salidaId
 * @param {string} centerCode
 * @param {number} paxToMove
 */
async function executeMoveSalida(sourceDate, targetDate, salidaId, centerCode, paxToMove) {
    if (sourceDate === targetDate) return;
    paxToMove = parseInt(paxToMove, 10);
    if (isNaN(paxToMove) || paxToMove <= 0) return;

    await callBdfWrite('moveSalida', {
        sourceDate,
        targetDate,
        salidaId,
        centerCode: normCenter(centerCode),
        pax: paxToMove
    });
}

/**
 * Ejecuta el intercambio de fechas entre dos escuelas con soporte de split asimétrico (Section 5).
 * Optimista en 0ms: actualiza caché y DOM al instante, y persiste a Firestore en segundo plano con rollback.
 */
async function executeSwapSalidas(dateA, salidaIdA, centerA, safePaxA, retainedPaxA, dateB, salidaIdB, centerB, safePaxB, retainedPaxB) {
    safePaxA = parseInt(safePaxA, 10) || 0;
    safePaxB = parseInt(safePaxB, 10) || 0;
    retainedPaxA = parseInt(retainedPaxA, 10) || 0;
    retainedPaxB = parseInt(retainedPaxB, 10) || 0;

    await Promise.all([ensureDayInCache(dateA), ensureDayInCache(dateB)]);

    const normA = normCenter(centerA);
    const normB = normCenter(centerB);

    const docRefA = db.collection(BDF_COLLECTIONS.DAYS).doc(dateA);
    const docRefB = db.collection(BDF_COLLECTIONS.DAYS).doc(dateB);

    // Snapshot previo para rollback
    const prevCacheA = monthDaysCache[dateA] ? JSON.parse(JSON.stringify(monthDaysCache[dateA])) : null;
    const prevCacheB = monthDaysCache[dateB] ? JSON.parse(JSON.stringify(monthDaysCache[dateB])) : null;

    const swapOpts = {
        normA, normB, salidaIdA, salidaIdB, dateA, dateB,
        safePaxA, retainedPaxA, safePaxB, retainedPaxB
    };

    const dayDataA = monthDaysCache[dateA] || null;
    const dayDataB = monthDaysCache[dateB] || null;

    const dayCapA = getDayQuota(dateA, dayDataA);
    const dayCapB = getDayQuota(dateB, dayDataB);

    const salidasA = getDaySalidas(dayDataA, dateA);
    const salidasB = getDaySalidas(dayDataB, dateB);
    const occBefore = sumSalidasPlazas(salidasA) + sumSalidasPlazas(salidasB);

    applySwapToSalidas(salidasA, salidasB, swapOpts);

    const occA = sumSalidasPlazas(salidasA);
    const occB = sumSalidasPlazas(salidasB);

    if (occA + occB !== occBefore) {
        throw new Error(`Integridad: el intercambio alteraría el total de plazas (${occBefore} → ${occA + occB}). Operación cancelada.`);
    }
    if (occA > dayCapA) {
        throw new Error(`Cupo diario excedido en ${dateA}: total ocupado (${occA}) supera el límite de ${dayCapA}.`);
    }
    if (occB > dayCapB) {
        throw new Error(`Cupo diario excedido en ${dateB}: total ocupado (${occB}) supera el límite de ${dayCapB}.`);
    }

    // Actualización inmediata en caché y renderizado en 0ms
    monthDaysCache[dateA] = {
        id: dateA,
        date: dateA,
        totalQuota: dayCapA,
        salidas: salidasA,
        allocations: syncAllocationsFromSalidas(salidasA)
    };

    monthDaysCache[dateB] = {
        id: dateB,
        date: dateB,
        totalQuota: dayCapB,
        salidas: salidasB,
        allocations: syncAllocationsFromSalidas(salidasB)
    };

    renderAll();

    try {
        await db.runTransaction(async (transaction) => {
            const liveDocA = await transaction.get(docRefA);
            const liveDocB = await transaction.get(docRefB);

            const liveDataA = liveDocA.exists ? liveDocA.data() : null;
            const liveDataB = liveDocB.exists ? liveDocB.data() : null;

            const liveCapA = getDayQuota(dateA, liveDataA || {});
            const liveCapB = getDayQuota(dateB, liveDataB || {});

            const liveSalidasA = getDaySalidas(liveDataA, dateA);
            const liveSalidasB = getDaySalidas(liveDataB, dateB);
            const liveBefore = sumSalidasPlazas(liveSalidasA) + sumSalidasPlazas(liveSalidasB);

            applySwapToSalidas(liveSalidasA, liveSalidasB, swapOpts);

            const liveOccA = sumSalidasPlazas(liveSalidasA);
            const liveOccB = sumSalidasPlazas(liveSalidasB);

            if (liveOccA + liveOccB !== liveBefore) {
                throw new Error(`Integridad: el intercambio alteraría el total de plazas (${liveBefore} → ${liveOccA + liveOccB}). Operación cancelada.`);
            }
            if (liveOccA > liveCapA) {
                throw new Error(`Cupo diario excedido en ${dateA}: total ocupado (${liveOccA}) supera el límite de ${liveCapA}.`);
            }
            if (liveOccB > liveCapB) {
                throw new Error(`Cupo diario excedido en ${dateB}: total ocupado (${liveOccB}) supera el límite de ${liveCapB}.`);
            }

            transaction.set(docRefA, buildDayDocPayload(dateA, liveCapA, liveSalidasA, serverStamp()), { merge: true });
            transaction.set(docRefB, buildDayDocPayload(dateB, liveCapB, liveSalidasB, serverStamp()), { merge: true });
        });

        if (currentUserKey !== 'admin') {
            logBdfHistory('swap_salidas', {
                dateA, dateB, centerA: normA, centerB: normB, safePaxA, retainedPaxA, safePaxB, retainedPaxB
            }).catch(e => reportFailure(e, 'tarea en segundo plano'));
        }
    } catch (err) {
        reportFailure(err, "Error intercambiando salidas en Firestore");
        if (prevCacheA) monthDaysCache[dateA] = prevCacheA;
        else delete monthDaysCache[dateA];

        if (prevCacheB) monthDaysCache[dateB] = prevCacheB;
        else delete monthDaysCache[dateB];

        renderAll();
        throw new Error(describeFirestoreError(err, 'realizar el intercambio'));
    }
}

/**
 * Transfiere plazas de una escuela cedente a una escuela receptora de forma optimista en 0ms (Sections 3 y 3.1).
 * La escuela cedente reduce sus plazas (se elimina si llega a 0), y el receptor
 * suma esas plazas a su total en esa fecha (principio aditivo de Section 0).
 */
async function executeSpotTransferSalidas(dateStr, givingSalidaId, fromCenter, toCenter, spots, note = '') {
    spots = parseInt(spots, 10);
    if (isNaN(spots) || spots <= 0) throw new Error("El número de plazas a ceder debe ser mayor a 0");

    await callBdfWrite('spotTransfer', {
        dateStr,
        givingSalidaId,
        fromCenter: normCenter(fromCenter),
        toCenter: normCenter(toCenter),
        spots,
        note: sanitizeNote(note)
    });
}

/**
 * Guarda o actualiza la asignación inicial del día (administrador).
 * @param {string} dateStr
 * @param {number} totalQuota
 * @param {Object} allocations - { 'MD': { initialSlots: 8 }, 'M': { initialSlots: 8 }, ... }
 */
async function adminSaveDayAllocations(dateStr, totalQuota, allocations) {
    if (currentUserKey !== 'admin') throw new Error("Solo el administrador puede configurar cupos del sorteo.");

    const docRef = db.collection(BDF_COLLECTIONS.DAYS).doc(dateStr);
    
    await docRef.set({
        date: dateStr,
        totalQuota: Number(totalQuota) || DEFAULT_DAILY_CAP,
        allocations: allocations,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    await logBdfHistory('admin_quota', {
        date: dateStr,
        totalQuota: totalQuota,
        allocations: allocations
    });
}

/**
 * Importa masivamente las asignaciones de cuadrante desde CSV a Firestore en lotes seguros.
 * @param {Object} daysMap - { 'YYYY-MM-DD': { 'MD': { initialSlots: 8 }, 'M': { initialSlots: 8 } } }
 * @param {boolean} overwrite - Si sobreescribe o mezcla las asignaciones
 */
async function executeImportCsvSchedule(daysMap, overwrite = true, salidasMap = null) {
    const dates = Object.keys(daysMap);
    if (dates.length === 0) throw new Error("No hay fechas válidas para importar.");

    const BATCH_SIZE = 400;
    for (let i = 0; i < dates.length; i += BATCH_SIZE) {
        const batchDates = dates.slice(i, i + BATCH_SIZE);
        const batch = db.batch();

        for (const dateStr of batchDates) {
            const docRef = db.collection(BDF_COLLECTIONS.DAYS).doc(dateStr);
            const newAllocations = daysMap[dateStr];

            let dayData = monthDaysCache[dateStr] || {
                date: dateStr,
                allocations: {},
                salidas: [],
                transfers: [],
                releases: [],
                claims: []
            };

            const finalAllocations = overwrite 
                ? newAllocations 
                : { ...(dayData.allocations || {}), ...newAllocations };

            let finalSalidas = [];
            if (salidasMap && salidasMap[dateStr]) {
                finalSalidas = salidasMap[dateStr].map(s => ({
                    id: s.id || `plazas_${dateStr}_${s.centerCode}`,
                    date: dateStr,
                    centerCode: normCenter(s.centerCode),
                    plazas: Number(s.plazas !== undefined ? s.plazas : s.pax) || 0,
                    pax: Number(s.plazas !== undefined ? s.plazas : s.pax) || 0,
                    note: s.note || '',
                    updatedAt: new Date().toISOString()
                }));
            } else if (finalAllocations) {
                finalSalidas = Object.keys(finalAllocations).map(code => {
                    const p = Number(finalAllocations[code].initialSlots || finalAllocations[code].slots || 10);
                    const normCode = normCenter(code);
                    return {
                        id: `plazas_${dateStr}_${normCode}`,
                        date: dateStr,
                        centerCode: normCode,
                        plazas: p,
                        pax: p,
                        note: '',
                        updatedAt: new Date().toISOString()
                    };
                });
            }

            const dayCap = getDayQuota(dateStr, dayData);

            batch.set(docRef, {
                ...dayData,
                date: dateStr,
                totalQuota: dayCap,
                salidas: finalSalidas,
                allocations: finalAllocations,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });

            monthDaysCache[dateStr] = {
                ...dayData,
                date: dateStr,
                totalQuota: dayCap,
                salidas: finalSalidas,
                allocations: finalAllocations
            };
        }

        await batch.commit();
    }

    await logBdfHistory('import_csv', {
        totalDays: dates.length,
        timestamp: new Date().toISOString()
    });

    renderAll();
}

/**
 * Limpia notas automáticas generadas previamente (Importado, Intercambio con..., etc.)
 * en Firestore para que el campo note quede 100% exclusivo para los centros de buceo.
 */
async function scrubLegacyAutoNotes() {
    try {
        const snap = await db.collection(BDF_COLLECTIONS.DAYS).get();
        if (snap.empty) return;
        
        let batch = db.batch();
        let opsCount = 0;
        let scrubbedTotal = 0;

        snap.forEach(docSnap => {
            const data = docSnap.data();
            let changed = false;

            let newSalidas = null;
            if (Array.isArray(data.salidas)) {
                newSalidas = data.salidas.map(s => {
                    const cleanNote = sanitizeUserNote(s.note);
                    if (cleanNote !== (s.note || '')) {
                        changed = true;
                        return { ...s, note: cleanNote };
                    }
                    return s;
                });
            }

            let newAllocs = null;
            if (data.allocations) {
                newAllocs = { ...data.allocations };
                Object.keys(newAllocs).forEach(k => {
                    const cleanNote = sanitizeUserNote(newAllocs[k].note);
                    if (cleanNote !== (newAllocs[k].note || '')) {
                        changed = true;
                        newAllocs[k] = { ...newAllocs[k], note: cleanNote };
                    }
                });
            }

            if (changed) {
                const updates = {};
                if (newSalidas) updates.salidas = newSalidas;
                if (newAllocs) updates.allocations = newAllocs;
                batch.update(docSnap.ref, updates);
                opsCount++;
                scrubbedTotal++;
                if (opsCount >= 450) {
                    batch.commit();
                    batch = db.batch();
                    opsCount = 0;
                }
            }
        });

        if (opsCount > 0) {
            await batch.commit();
        }
        if (scrubbedTotal > 0) {
            console.log(`[Scrub] Limpiadas notas automáticas en ${scrubbedTotal} documentos de Firestore.`);
        }
    } catch (err) {
        console.warn('scrubLegacyAutoNotes non-blocking warning:', err);
    }
}

