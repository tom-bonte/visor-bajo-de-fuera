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
 * Dispara el webhook a Make.com para notificar al grupo de WhatsApp de Bajo de Fuera.
 * @param {string} msg
 */
async function sendBdfWebhook(msg) {
    // Para el admin: NUNCA enviar mensajes a WhatsApp
    if (currentUserKey === 'admin') {
        console.log("[Admin bypass] No se envían mensajes a WhatsApp en modo Administrador.");
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
            console.error(`[WhatsApp] El aviso no se pudo enviar (${response.status}). ${detail}`);
        }
    } catch (e) {
        console.error("Error enviando el aviso de WhatsApp:", e);
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
        console.error("Error escribiendo en log de historial:", e);
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
        console.error("Error escuchando día en Firestore:", error);
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
            console.error("Error escuchando rango en Firestore:", error);
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
        console.error(`Error obteniendo día ${dateStr} de Firestore:`, err);
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
            console.error("Error escuchando historial en Firestore:", error);
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
                    if (currentUserKey === 'admin') {
                        db.collection(BDF_COLLECTIONS.REQUESTS).doc(doc.id).delete().catch(console.error);
                    }
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
                    if (isMine) {
                        db.collection(BDF_COLLECTIONS.REQUESTS).doc(doc.id).update({
                            status: 'expired',
                            expiredAt: firebase.firestore.FieldValue.serverTimestamp()
                        }).catch(console.error);
                    }
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
            console.error("Error escuchando solicitudes en Firestore:", error);
        });
}

/**
 * Crea una nueva solicitud en Firestore para que la reciba el otro centro.
 * @param {Object} data
 */
async function createBdfRequest(data) {
    return await db.collection(BDF_COLLECTIONS.REQUESTS).add({
        ...data,
        status: 'pending',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
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
        if (req.type === 'swap') {
            await acceptBdfSwap(req);
        } else if (req.type === 'donation' || req.type === 'request') {
            await acceptBdfSpotTransfer(req);
        }
    } catch (err) {
        console.error("Error al aceptar solicitud:", err);
        showNotification('Error', err.message, true);
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
async function acceptBdfSwap(req) {
    const { id: requestId, dateA, salidaIdA, centerA, dateB, salidaIdB, centerB } = req;

    const normA = normCenter(centerA);
    const normB = normCenter(centerB);

    const requestRef = db.collection(BDF_COLLECTIONS.REQUESTS).doc(requestId);
    const refA = db.collection(BDF_COLLECTIONS.DAYS).doc(dateA);
    const refB = db.collection(BDF_COLLECTIONS.DAYS).doc(dateB);

    const reqPaxA = parseInt(req.paxA, 10) || 0;
    const reqRetainedA = parseInt(req.retainedPaxA, 10) || 0;
    const reqPaxB = parseInt(req.paxB, 10) || 0;
    const reqRetainedB = parseInt(req.retainedPaxB, 10) || 0;

    const cAInfo = CENTERS[normA] || { name: normA, emoji: '⛵' };
    const cBInfo = CENTERS[normB] || { name: normB, emoji: '⛵' };
    const dA = formatDateShort(parseDateT00(dateA));
    const dB = formatDateShort(parseDateT00(dateB));

    let outcome;
    try {
        outcome = await db.runTransaction(async (transaction) => {
            // ---- LECTURAS (Firestore exige todas las lecturas antes de escribir) ----
            const reqSnap = await transaction.get(requestRef);
            const docA = await transaction.get(refA);
            const docB = await transaction.get(refB);

            // Ya aceptada, rechazada o cancelada (p. ej. doble pulsación): no hacer nada
            const reqData = reqSnap.exists ? reqSnap.data() : null;
            if (!reqData || (reqData.status && reqData.status !== 'pending')) {
                return { ok: false, reason: 'ALREADY_HANDLED' };
            }

            const dataA = docA.exists ? docA.data() : null;
            const dataB = docB.exists ? docB.data() : null;

            const capA = getDayQuota(dateA, dataA || {});
            const capB = getDayQuota(dateB, dataB || {});

            const salidasA = getDaySalidas(dataA, dateA);
            const salidasB = getDaySalidas(dataB, dateB);

            const sA = salidasA.find(s => s.id === salidaIdA || normCenter(s.centerCode) === normA);
            const sB = salidasB.find(s => s.id === salidaIdB || normCenter(s.centerCode) === normB);
            if (!sA || !sB) {
                transaction.delete(requestRef);
                return { ok: false, reason: 'STALE' };
            }

            const occA = sumSalidasPlazas(salidasA);
            const occB = sumSalidasPlazas(salidasB);
            if (occA > capA || occB > capB) {
                transaction.delete(requestRef);
                return { ok: false, reason: 'STALE' };
            }

            const currentPaxA = Number(sA.plazas !== undefined ? sA.plazas : sA.pax) || 0;
            const currentPaxB = Number(sB.plazas !== undefined ? sB.plazas : sB.pax) || 0;

            // Recalcular con las mismas fórmulas que initiateSwap(), sobre datos vivos
            const space_A = capA - (occA - currentPaxA);
            const space_B = capB - (occB - currentPaxB);
            if (space_A <= 0 || space_B <= 0) {
                transaction.delete(requestRef);
                return { ok: false, reason: 'STALE' };
            }

            const safe_A = Math.min(currentPaxA, space_B);
            const safe_B = Math.min(currentPaxB, space_A);
            const retained_A = currentPaxA - safe_A;
            const retained_B = currentPaxB - safe_B;

            const differs = (
                safe_A !== reqPaxA ||
                retained_A !== reqRetainedA ||
                safe_B !== reqPaxB ||
                retained_B !== reqRetainedB ||
                (req.spaceA !== undefined && space_A !== req.spaceA) ||
                (req.spaceB !== undefined && space_B !== req.spaceB)
            );
            if (differs) {
                transaction.delete(requestRef);
                return { ok: false, reason: 'STALE' };
            }

            applySwapToSalidas(salidasA, salidasB, {
                normA, normB, salidaIdA, salidaIdB, dateA, dateB,
                safePaxA: safe_A, retainedPaxA: retained_A,
                safePaxB: safe_B, retainedPaxB: retained_B
            });

            const finalA = sumSalidasPlazas(salidasA);
            const finalB = sumSalidasPlazas(salidasB);

            // Invariante de Section 0: un intercambio nunca crea ni pierde plazas
            if (finalA + finalB !== occA + occB) {
                throw new Error(`Integridad: el intercambio alteraría el total de plazas (${occA + occB} → ${finalA + finalB}). Operación cancelada.`);
            }
            if (finalA > capA) {
                throw new Error(`Cupo diario excedido en ${dateA}: total ocupado (${finalA}) supera el límite de ${capA}.`);
            }
            if (finalB > capB) {
                throw new Error(`Cupo diario excedido en ${dateB}: total ocupado (${finalB}) supera el límite de ${capB}.`);
            }

            // ---- ESCRITURAS ----
            transaction.set(refA, buildDayDocPayload(dateA, capA, salidasA), { merge: true });
            transaction.set(refB, buildDayDocPayload(dateB, capB, salidasB), { merge: true });
            transaction.delete(requestRef);

            return { ok: true, safe_A, safe_B, retained_A, retained_B };
        });
    } catch (err) {
        console.error("Error aceptando intercambio:", err);
        renderAll();
        throw new Error(describeFirestoreError(err, 'aceptar el intercambio'));
    }

    if (!outcome.ok) {
        closeNotificationsModal();
        renderAll();
        if (outcome.reason === 'ALREADY_HANDLED') {
            showNotification(
                'Solicitud Ya Procesada',
                'Esta propuesta ya se había aceptado, rechazado o cancelado. No se ha realizado ningún cambio.',
                false
            );
        } else {
            showNotification(
                'Propuesta No Válida',
                'Las plazas o los cupos han cambiado desde que se envió esta propuesta. Pídele a la otra escuela que la proponga de nuevo.',
                true
            );
        }
        return;
    }

    const { safe_A, safe_B, retained_A, retained_B } = outcome;

    if (currentUserKey !== 'admin') {
        logBdfHistory('swap_salidas', {
            dateA, dateB, centerA: normA, centerB: normB,
            safePaxA: safe_A, retainedPaxA: retained_A, safePaxB: safe_B, retainedPaxB: retained_B
        }).catch(console.error);

        const msg = `🤖 *AVISO AUTOMÁTICO*\n✅ *INTERCAMBIO ACEPTADO* - ${cAInfo.emoji} ${cAInfo.name} ↔️ ${cBInfo.emoji} ${cBInfo.name}\nSe ha completado el intercambio de fechas en Bajo de Fuera:\n• ${cAInfo.name}: pasa al ${dB} (${safe_A} pl.)${retained_A > 0 ? ` (mantiene ${retained_A} pl. en el ${dA})` : ''}\n• ${cBInfo.name}: pasa al ${dA} (${safe_B} pl.)${retained_B > 0 ? ` (mantiene ${retained_B} pl. en el ${dB})` : ''}`;
        sendBdfWebhook(msg).catch(console.error);
    }

    closeNotificationsModal();
    renderAll();
    showNotification(
        'Intercambio Aceptado',
        `${cAInfo.name} pasa al ${dB} (${safe_A} pl.) y ${cBInfo.name} pasa al ${dA} (${safe_B} pl.).`,
        false
    );
}

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
async function acceptBdfSpotTransfer(req) {
    const { id: requestId, date, requestedPax, pax, isFull } = req;
    const spots = Number(requestedPax || pax || 0);

    const isDonation = req.type === 'donation';
    const givingCenter = normCenter(isDonation ? req.initiatorCenter : req.targetCenter);
    const receivingCenter = normCenter(isDonation ? req.targetCenter : req.initiatorCenter);
    const givingSalidaId = req.givingSalidaId || req.targetSalidaId || null;
    const note = sanitizeNote((req.note || '').trim());

    const gInfo = CENTERS[givingCenter] || { name: givingCenter, emoji: '⛵' };
    const rInfo = CENTERS[receivingCenter] || { name: receivingCenter, emoji: '⛵' };
    const dStr = formatDateShort(parseDateT00(date));

    const requestRef = db.collection(BDF_COLLECTIONS.REQUESTS).doc(requestId);
    const dayRef = db.collection(BDF_COLLECTIONS.DAYS).doc(date);

    let outcome;
    try {
        outcome = await db.runTransaction(async (transaction) => {
            // ---- LECTURAS ----
            const reqSnap = await transaction.get(requestRef);
            const daySnap = await transaction.get(dayRef);

            const reqData = reqSnap.exists ? reqSnap.data() : null;
            if (!reqData || (reqData.status && reqData.status !== 'pending')) {
                return { ok: false, reason: 'ALREADY_HANDLED' };
            }

            if (!spots || spots <= 0) {
                transaction.delete(requestRef);
                return { ok: false, reason: 'STALE' };
            }

            const dayData = daySnap.exists ? daySnap.data() : null;
            const cap = getDayQuota(date, dayData || {});
            const salidas = getDaySalidas(dayData, date);
            const occBefore = sumSalidasPlazas(salidas);

            const applied = applyTransferToSalidas(salidas, {
                dateStr: date,
                normFrom: givingCenter,
                normTo: receivingCenter,
                givingSalidaId,
                spots,
                note
            });

            // La escuela cedente ya no existe o no tiene suficientes plazas
            if (!applied) {
                transaction.delete(requestRef);
                return { ok: false, reason: 'STALE' };
            }

            // Invariante de Section 0: una cesión mueve plazas, nunca las crea ni las pierde
            const occAfter = sumSalidasPlazas(salidas);
            if (occAfter !== occBefore) {
                throw new Error(`Integridad: la transferencia alteraría el total de plazas del día (${occBefore} → ${occAfter}). Operación cancelada.`);
            }

            // ---- ESCRITURAS ----
            transaction.set(dayRef, buildDayDocPayload(date, cap, salidas), { merge: true });
            transaction.delete(requestRef);

            return { ok: true };
        });
    } catch (err) {
        console.error("Error aceptando transferencia de plazas:", err);
        renderAll();
        throw new Error(describeFirestoreError(err, 'aceptar la cesión de plazas'));
    }

    if (!outcome.ok) {
        closeNotificationsModal();
        renderAll();
        if (outcome.reason === 'ALREADY_HANDLED') {
            showNotification(
                'Solicitud Ya Procesada',
                'Esta solicitud ya se había aceptado, rechazado o cancelado. No se ha realizado ningún cambio.',
                false
            );
        } else {
            showNotification(
                'Solicitud No Válida',
                `${gInfo.name} ya no dispone de esas plazas el ${dStr}. La solicitud se ha retirado; pídelas de nuevo si siguen haciendo falta.`,
                true
            );
        }
        return;
    }

    if (currentUserKey !== 'admin') {
        logBdfHistory('transfer_salida', {
            date: date,
            from: givingCenter,
            to: receivingCenter,
            slots: spots,
            note: note
        }).catch(console.error);

        const titleText = isDonation ? 'CESIÓN ACEPTADA' : 'PETICIÓN ACEPTADA';
        const msg = `🤖 *AVISO AUTOMÁTICO*\n✅ *${titleText}* - ${gInfo.emoji} ${gInfo.name} a ${rInfo.emoji} ${rInfo.name}\nPara el ${dStr}, ${gInfo.name} ha transferido ${isFull ? 'el barco completo' : `${spots} plazas`} en Bajo de Fuera a ${rInfo.name}.`;
        sendBdfWebhook(msg).catch(console.error);
    }

    closeNotificationsModal();
    renderAll();
    showNotification(
        'Plazas Transferidas',
        `${gInfo.name} ha cedido ${spots} plazas a ${rInfo.name} para el ${dStr}.`,
        false
    );
}

/**
 * Cancela una solicitud enviada por el centro propio (Section 6).
 * Desbloquea inmediatamente la(s) salida(s) asociadas.
 * @param {string} requestId
 */
async function cancelBdfRequest(requestId) {
    try {
        await db.collection(BDF_COLLECTIONS.REQUESTS).doc(requestId).delete();
        if (getEl('pending-request-action-modal')) {
            hideEl('pending-request-action-modal');
        }
        if (getEl('notifications-modal') && !getEl('notifications-modal').classList.contains('hidden')) {
            renderNotificationsList();
        }
        showToast('Solicitud Retirada', 'La petición ha sido cancelada y las plazas quedan desbloqueadas.');
    } catch (err) {
        console.error("Error al cancelar solicitud:", err);
        showNotification('Error', 'No se pudo cancelar la solicitud: ' + err.message, true);
    }
}

/**
 * Rechaza y elimina una solicitud pendiente sin modificar el calendario (Section 3B / 3.1).
 * Desbloquea la(s) salida(s) asociadas.
 * @param {string} requestId
 */
async function rejectBdfRequest(requestId) {
    try {
        await db.collection(BDF_COLLECTIONS.REQUESTS).doc(requestId).delete();
        if (getEl('pending-request-action-modal')) {
            hideEl('pending-request-action-modal');
        }
        if (getEl('notifications-modal') && !getEl('notifications-modal').classList.contains('hidden')) {
            renderNotificationsList();
        }
        showToast('Solicitud Denegada', 'La petición ha sido rechazada y las plazas quedan desbloqueadas.');
    } catch (err) {
        console.error("Error al rechazar solicitud:", err);
        showNotification('Error', 'No se pudo rechazar la solicitud: ' + err.message, true);
    }
}

/* =========================================================================
   TRANSACCIONES Y OPERACIONES DE PLAZAS
   ========================================================================= */

/**
 * Genera un ID único para una salida independiente.
 */
function generateSalidaId(dateStr, centerCode) {
    return `${dateStr}_${centerCode}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
}

/**
 * Sincroniza el mapa de allocations a partir del array de salidas para compatibilidad hacia atrás.
 */
function syncAllocationsFromSalidas(salidas) {
    const allocs = {};
    (salidas || []).forEach(s => {
        if (!s || !s.centerCode) return;
        const p = Number(s.plazas !== undefined ? s.plazas : s.pax) || 0;
        if (p <= 0) return;
        const normCode = normCenter(s.centerCode);
        if (!allocs[normCode]) {
            allocs[normCode] = { initialSlots: 0, slots: 0, note: s.note || '' };
        }
        allocs[normCode].initialSlots += p;
        allocs[normCode].slots += p;
        if (s.note) allocs[normCode].note = s.note;
    });
    return allocs;
}

/**
 * Devuelve la lista de salidas sin el registro indicado. Busca primero por id y,
 * si no aparece (documentos heredados con ids aleatorios), por código de centro.
 * @param {Array} salidas
 * @param {string} salidaId
 * @param {string} normCode
 * @returns {{salidas: Array, removed: boolean}}
 */
function removeSalidaFromList(salidas, salidaId, normCode) {
    const list = salidas || [];
    if (salidaId) {
        const filtered = list.filter(s => s.id !== salidaId);
        if (filtered.length !== list.length) return { salidas: filtered, removed: true };
    }
    if (normCode) {
        const filtered = list.filter(s => normCenter(s.centerCode) !== normCode);
        if (filtered.length !== list.length) return { salidas: filtered, removed: true };
    }
    return { salidas: list, removed: false };
}

/**
 * Suma total de plazas de una lista de salidas.
 * @param {Array} list
 * @returns {number}
 */
function sumSalidasPlazas(list) {
    return (list || []).reduce((sum, s) => sum + (Number(s.plazas !== undefined ? s.plazas : s.pax) || 0), 0);
}

/**
 * Añade plazas al total de una escuela dentro de una lista de salidas (principio
 * aditivo de Section 0): suma si ya tiene registro ese día, o crea uno nuevo.
 * Muta la lista recibida.
 * @param {Array} list
 * @param {string} dateStr
 * @param {string} normCode
 * @param {number} plazas
 * @param {string} [note]
 */
function addPlazasToSalidas(list, dateStr, normCode, plazas, note = '') {
    const existing = list.find(s => normCenter(s.centerCode) === normCode);
    if (existing) {
        existing.plazas = (Number(existing.plazas !== undefined ? existing.plazas : existing.pax) || 0) + plazas;
        existing.pax = existing.plazas;
        if (!existing.note && note) existing.note = note;
        existing.updatedAt = new Date().toISOString();
        return existing;
    }
    const created = {
        id: `plazas_${dateStr}_${normCode}`,
        date: dateStr,
        centerCode: normCode,
        plazas: plazas,
        pax: plazas,
        note: (note || '').trim(),
        updatedAt: new Date().toISOString()
    };
    list.push(created);
    return created;
}

/**
 * Aplica un intercambio (Section 5) sobre dos listas de salidas. Muta ambas listas.
 * Cada escuela conserva `retainedPax` en su día original y traslada `safePax` al otro,
 * donde se SUMAN a su total existente. Función pura sobre las listas: no toca Firestore
 * ni la caché, para poder usarse tanto en la ejecución directa como dentro de la
 * transacción de aceptación.
 * @param {Array} salidasA
 * @param {Array} salidasB
 * @param {Object} opts
 */
function applySwapToSalidas(salidasA, salidasB, opts) {
    const { normA, normB, salidaIdA, salidaIdB, dateA, dateB,
            safePaxA, retainedPaxA, safePaxB, retainedPaxB } = opts;

    // Día A: la escuela A conserva lo retenido o desaparece
    const idxA = salidasA.findIndex(s => normCenter(s.centerCode) === normA || s.id === salidaIdA);
    if (idxA !== -1) {
        if (retainedPaxA > 0) {
            salidasA[idxA].plazas = retainedPaxA;
            salidasA[idxA].pax = retainedPaxA;
            salidasA[idxA].updatedAt = new Date().toISOString();
        } else {
            salidasA.splice(idxA, 1);
        }
    }
    // Día A: llegada de la escuela B
    if (safePaxB > 0) addPlazasToSalidas(salidasA, dateA, normB, safePaxB);

    // Día B: la escuela B conserva lo retenido o desaparece
    const idxB = salidasB.findIndex(s => normCenter(s.centerCode) === normB || s.id === salidaIdB);
    if (idxB !== -1) {
        if (retainedPaxB > 0) {
            salidasB[idxB].plazas = retainedPaxB;
            salidasB[idxB].pax = retainedPaxB;
            salidasB[idxB].updatedAt = new Date().toISOString();
        } else {
            salidasB.splice(idxB, 1);
        }
    }
    // Día B: llegada de la escuela A
    if (safePaxA > 0) addPlazasToSalidas(salidasB, dateB, normA, safePaxA);

    return { salidasA, salidasB };
}

/**
 * Aplica una transferencia de plazas entre dos escuelas EL MISMO DÍA (Sections 3 y 3.1).
 * Muta la lista recibida. La cedente se reduce (o desaparece) y la receptora suma.
 * @param {Array} list
 * @param {Object} opts
 * @returns {boolean} true si se pudo aplicar
 */
function applyTransferToSalidas(list, opts) {
    const { dateStr, normFrom, normTo, givingSalidaId, spots, note } = opts;

    const idx = list.findIndex(s => normCenter(s.centerCode) === normFrom || s.id === givingSalidaId);
    if (idx === -1) return false;

    const available = Number(list[idx].plazas !== undefined ? list[idx].plazas : list[idx].pax) || 0;
    if (available < spots) return false;

    if (available > spots) {
        list[idx].plazas = available - spots;
        list[idx].pax = list[idx].plazas;
        list[idx].updatedAt = new Date().toISOString();
    } else {
        list.splice(idx, 1);
    }

    addPlazasToSalidas(list, dateStr, normTo, spots, note);
    return true;
}

/**
 * Construye el objeto que se escribe en un documento de día.
 * @param {string} dateStr
 * @param {number} cap
 * @param {Array} salidas
 */
function buildDayDocPayload(dateStr, cap, salidas) {
    return {
        date: dateStr,
        totalQuota: cap,
        salidas: salidas,
        allocations: syncAllocationsFromSalidas(salidas),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
}

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
    note = sanitizeNote(note);

    const normCode = normCenter(centerCode);
    const docRef = db.collection(BDF_COLLECTIONS.DAYS).doc(dateStr);

    // Snapshot previo para rollback en caso de error
    const prevDayCache = monthDaysCache[dateStr] ? JSON.parse(JSON.stringify(monthDaysCache[dateStr])) : null;

    const currentDayData = monthDaysCache[dateStr] || null;
    const dayCap = getDayQuota(dateStr, currentDayData);
    const summary = getDaySummary(currentDayData, dateStr);
    const remaining = Math.max(0, dayCap - summary.totalOccupied);
    if (pax > remaining) {
        throw new Error(`Cupo diario excedido: solo quedan ${remaining} plazas disponibles hoy (máximo ${dayCap} plazas/día).`);
    }

    const currentSalidas = getDaySalidas(currentDayData, dateStr);
    const existing = currentSalidas.find(s => normCenter(s.centerCode) === normCode);

    if (existing) {
        existing.centerCode = normCode;
        existing.plazas = (Number(existing.plazas !== undefined ? existing.plazas : existing.pax) || 0) + pax;
        existing.pax = existing.plazas;
        if (note && note.trim()) existing.note = note.trim();
        existing.updatedAt = new Date().toISOString();
    } else {
        currentSalidas.push({
            id: `plazas_${dateStr}_${normCode}`,
            date: dateStr,
            centerCode: normCode,
            plazas: pax,
            pax: pax,
            note: (note || '').trim(),
            updatedAt: new Date().toISOString()
        });
    }

    // Actualización inmediata en caché y pantalla en 0ms
    monthDaysCache[dateStr] = {
        id: dateStr,
        date: dateStr,
        totalQuota: dayCap,
        salidas: currentSalidas,
        allocations: syncAllocationsFromSalidas(currentSalidas)
    };
    renderAll();

    try {
        await db.runTransaction(async (transaction) => {
            const liveDoc = await transaction.get(docRef);
            const liveData = liveDoc.exists ? liveDoc.data() : null;
            const liveCap = getDayQuota(dateStr, liveData);
            const liveSummary = getDaySummary(liveData, dateStr);
            const liveRemaining = Math.max(0, liveCap - liveSummary.totalOccupied);

            if (pax > liveRemaining) {
                throw new Error(`Cupo diario excedido en el servidor: solo quedan ${liveRemaining} plazas disponibles hoy (máximo ${liveCap} plazas/día).`);
            }

            const liveSalidas = getDaySalidas(liveData, dateStr);
            const liveExisting = liveSalidas.find(s => normCenter(s.centerCode) === normCode);

            if (liveExisting) {
                liveExisting.centerCode = normCode;
                liveExisting.plazas = (Number(liveExisting.plazas !== undefined ? liveExisting.plazas : liveExisting.pax) || 0) + pax;
                liveExisting.pax = liveExisting.plazas;
                if (note && note.trim()) liveExisting.note = note.trim();
                liveExisting.updatedAt = new Date().toISOString();
            } else {
                liveSalidas.push({
                    id: `plazas_${dateStr}_${normCode}`,
                    date: dateStr,
                    centerCode: normCode,
                    plazas: pax,
                    pax: pax,
                    note: (note || '').trim(),
                    updatedAt: new Date().toISOString()
                });
            }

            transaction.set(docRef, {
                date: dateStr,
                totalQuota: liveCap,
                salidas: liveSalidas,
                allocations: syncAllocationsFromSalidas(liveSalidas),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
        });

        if (currentUserKey !== 'admin') {
            logBdfHistory('add_salida', {
                date: dateStr,
                center: normCode,
                slots: pax,
                note: note
            }).catch(console.error);
        }
    } catch (err) {
        console.error("Error guardando salida en Firestore:", err);
        if (prevDayCache) {
            monthDaysCache[dateStr] = prevDayCache;
        } else {
            delete monthDaysCache[dateStr];
        }
        renderAll();
        throw err;
    }
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
    newNote = sanitizeNote(newNote);

    const docRef = db.collection(BDF_COLLECTIONS.DAYS).doc(dateStr);
    const prevDayCache = monthDaysCache[dateStr] ? JSON.parse(JSON.stringify(monthDaysCache[dateStr])) : null;

    const currentDayData = monthDaysCache[dateStr] || null;
    const dayCap = getDayQuota(dateStr, currentDayData);
    const currentSalidas = getDaySalidas(currentDayData, dateStr);
    const normNewCenter = newCenterCode ? normCenter(newCenterCode) : null;

    const targetIdx = currentSalidas.findIndex(s => s.id === salidaId);
    const salidaIndex = targetIdx !== -1 ? targetIdx : currentSalidas.findIndex(s => normCenter(s.centerCode) === normNewCenter);
    if (salidaIndex === -1) throw new Error("No se encontró el registro de plazas a modificar.");

    const currentSalida = currentSalidas[salidaIndex];
    const otherOccupied = currentSalidas.reduce((sum, s, idx) => {
        if (idx === salidaIndex) return sum;
        return sum + (Number(s.plazas !== undefined ? s.plazas : s.pax) || 0);
    }, 0);
    const maxAvailableForThis = Math.max(0, dayCap - otherOccupied);

    if (newPax > maxAvailableForThis) {
        throw new Error(`Cupo diario excedido: solo hay espacio para un máximo de ${maxAvailableForThis} plazas hoy (cupo diario: ${dayCap}).`);
    }

    const oldCenter = currentSalida.centerCode;
    const finalTarget = normNewCenter || normCenter(oldCenter);

    currentSalidas[salidaIndex] = {
        ...currentSalida,
        centerCode: finalTarget,
        plazas: newPax,
        pax: newPax,
        note: (newNote !== undefined ? newNote : currentSalida.note || '').trim(),
        updatedAt: new Date().toISOString()
    };

    // Actualización inmediata en caché y pantalla en 0ms
    monthDaysCache[dateStr] = {
        id: dateStr,
        date: dateStr,
        totalQuota: dayCap,
        salidas: currentSalidas,
        allocations: syncAllocationsFromSalidas(currentSalidas)
    };
    renderAll();

    try {
        await db.runTransaction(async (transaction) => {
            const liveDoc = await transaction.get(docRef);
            const liveData = liveDoc.exists ? liveDoc.data() : null;
            const liveCap = getDayQuota(dateStr, liveData);
            const liveSalidas = getDaySalidas(liveData, dateStr);

            const targetIdx = liveSalidas.findIndex(s => s.id === salidaId);
            const sIndex = targetIdx !== -1 ? targetIdx : liveSalidas.findIndex(s => normCenter(s.centerCode) === normNewCenter);
            if (sIndex === -1) throw new Error("No se encontró en el servidor el registro de plazas a modificar.");

            const otherOccupied = liveSalidas.reduce((sum, s, idx) => {
                if (idx === sIndex) return sum;
                return sum + (Number(s.plazas !== undefined ? s.plazas : s.pax) || 0);
            }, 0);
            const liveMaxAvailable = Math.max(0, liveCap - otherOccupied);

            if (newPax > liveMaxAvailable) {
                throw new Error(`Cupo diario excedido en el servidor: solo hay espacio para ${liveMaxAvailable} plazas hoy (cupo diario: ${liveCap}).`);
            }

            const liveSalida = liveSalidas[sIndex];
            liveSalidas[sIndex] = {
                ...liveSalida,
                centerCode: finalTarget,
                plazas: newPax,
                pax: newPax,
                note: (newNote !== undefined ? newNote : liveSalida.note || '').trim(),
                updatedAt: new Date().toISOString()
            };

            transaction.set(docRef, {
                date: dateStr,
                totalQuota: liveCap,
                salidas: liveSalidas,
                allocations: syncAllocationsFromSalidas(liveSalidas),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
        });

        if (currentUserKey !== 'admin') {
            logBdfHistory('edit_salida', {
                date: dateStr,
                center: finalTarget,
                oldCenter: oldCenter,
                slots: newPax,
                note: newNote
            }).catch(console.error);
        }
    } catch (err) {
        console.error("Error modificando salida en Firestore:", err);
        if (prevDayCache) {
            monthDaysCache[dateStr] = prevDayCache;
        } else {
            delete monthDaysCache[dateStr];
        }
        renderAll();
        throw err;
    }
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
    const docRef = db.collection(BDF_COLLECTIONS.DAYS).doc(dateStr);
    const prevDayCache = monthDaysCache[dateStr] ? JSON.parse(JSON.stringify(monthDaysCache[dateStr])) : null;
    const normCode = centerCode ? normCenter(centerCode) : null;

    if (!salidaId && !normCode) {
        throw new Error("No se ha indicado qué plazas eliminar.");
    }

    const currentDayData = monthDaysCache[dateStr] || null;
    const dayCap = getDayQuota(dateStr, currentDayData);

    // Actualización optimista en caché y pantalla en 0ms (se revierte si falla la escritura)
    const currentSalidas = removeSalidaFromList(getDaySalidas(currentDayData, dateStr), salidaId, normCode).salidas;

    monthDaysCache[dateStr] = {
        id: dateStr,
        date: dateStr,
        totalQuota: dayCap,
        salidas: currentSalidas,
        allocations: syncAllocationsFromSalidas(currentSalidas)
    };
    renderAll();

    try {
        await db.runTransaction(async (transaction) => {
            const liveDoc = await transaction.get(docRef);
            const liveData = liveDoc.exists ? liveDoc.data() : null;
            const liveCap = getDayQuota(dateStr, liveData);

            // Elimina sobre la lista viva del servidor, no sobre la copia local
            const { salidas: liveSalidas, removed } = removeSalidaFromList(
                getDaySalidas(liveData, dateStr), salidaId, normCode
            );

            if (!removed) {
                throw new Error("Estas plazas ya no existen: es posible que se hayan eliminado o movido desde otro dispositivo.");
            }

            transaction.set(docRef, {
                date: dateStr,
                totalQuota: liveCap,
                salidas: liveSalidas,
                allocations: syncAllocationsFromSalidas(liveSalidas),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
        });

        if (currentUserKey !== 'admin') {
            logBdfHistory('delete_salida', {
                date: dateStr,
                center: centerCode
            }).catch(console.error);
        }
    } catch (err) {
        console.error("Error eliminando salida en Firestore:", err);
        if (prevDayCache) {
            monthDaysCache[dateStr] = prevDayCache;
        } else {
            delete monthDaysCache[dateStr];
        }
        renderAll();
        throw new Error(describeFirestoreError(err, 'eliminar las plazas'));
    }
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

    await Promise.all([ensureDayInCache(sourceDate), ensureDayInCache(targetDate)]);

    const normCode = normCenter(centerCode);
    const sourceRef = db.collection(BDF_COLLECTIONS.DAYS).doc(sourceDate);
    const targetRef = db.collection(BDF_COLLECTIONS.DAYS).doc(targetDate);

    // Snapshot previo para rollback en caso de fallo
    const prevSourceCache = monthDaysCache[sourceDate] ? JSON.parse(JSON.stringify(monthDaysCache[sourceDate])) : null;
    const prevTargetCache = monthDaysCache[targetDate] ? JSON.parse(JSON.stringify(monthDaysCache[targetDate])) : null;

    const sourceData = monthDaysCache[sourceDate] || null;
    const targetData = monthDaysCache[targetDate] || null;

    const sourceCap = getDayQuota(sourceDate, sourceData);
    const targetCap = getDayQuota(targetDate, targetData);

    const sourceSalidas = getDaySalidas(sourceData, sourceDate);
    const sIndex = sourceSalidas.findIndex(s => s.id === salidaId || normCenter(s.centerCode) === normCode);
    if (sIndex === -1) throw new Error("No se encontró la salida en el día de origen.");

    const sourceSalida = sourceSalidas[sIndex];
    const sourceNote = (sourceSalida.note || '').trim();
    const currentP = Number(sourceSalida.plazas !== undefined ? sourceSalida.plazas : sourceSalida.pax) || 0;
    if (currentP < paxToMove) {
        throw new Error(`Plazas insuficientes en el día de origen: tiene ${currentP} y pretendes mover ${paxToMove}.`);
    }

    // Re-comprobar cupo del día destino
    const targetSalidas = getDaySalidas(targetData, targetDate);
    const targetSummary = getDaySummary(targetData, targetDate);
    const availableInTarget = Math.max(0, targetCap - targetSummary.totalOccupied);
    if (paxToMove > availableInTarget) {
        throw new Error(`Cupo diario excedido en destino: solo quedan ${availableInTarget} plazas disponibles en el día de destino.`);
    }

    // Modificar día de origen
    if (currentP > paxToMove) {
        sourceSalida.plazas = currentP - paxToMove;
        sourceSalida.pax = sourceSalida.plazas;
        sourceSalida.updatedAt = new Date().toISOString();
    } else {
        sourceSalidas.splice(sIndex, 1);
    }

    // Modificar día de destino
    const existTarget = targetSalidas.find(s => normCenter(s.centerCode) === normCode);
    if (existTarget) {
        existTarget.plazas = (Number(existTarget.plazas !== undefined ? existTarget.plazas : existTarget.pax) || 0) + paxToMove;
        existTarget.pax = existTarget.plazas;
        if (!existTarget.note && sourceNote) existTarget.note = sourceNote;
        existTarget.updatedAt = new Date().toISOString();
    } else {
        targetSalidas.push({
            id: `plazas_${targetDate}_${normCode}`,
            date: targetDate,
            centerCode: normCode,
            plazas: paxToMove,
            pax: paxToMove,
            note: sourceNote,
            updatedAt: new Date().toISOString()
        });
    }

    // Actualización inmediata en caché local y renderizado en 0ms
    monthDaysCache[sourceDate] = {
        id: sourceDate,
        date: sourceDate,
        totalQuota: sourceCap,
        salidas: sourceSalidas,
        allocations: syncAllocationsFromSalidas(sourceSalidas)
    };

    monthDaysCache[targetDate] = {
        id: targetDate,
        date: targetDate,
        totalQuota: targetCap,
        salidas: targetSalidas,
        allocations: syncAllocationsFromSalidas(targetSalidas)
    };

    renderAll();

    try {
        await db.runTransaction(async (transaction) => {
            const liveSourceDoc = await transaction.get(sourceRef);
            const liveTargetDoc = await transaction.get(targetRef);

            const liveSourceData = liveSourceDoc.exists ? liveSourceDoc.data() : null;
            const liveTargetData = liveTargetDoc.exists ? liveTargetDoc.data() : null;

            const liveSourceCap = getDayQuota(sourceDate, liveSourceData);
            const liveTargetCap = getDayQuota(targetDate, liveTargetData);

            const liveSourceSalidas = getDaySalidas(liveSourceData, sourceDate);
            const sIndex = liveSourceSalidas.findIndex(s => s.id === salidaId || normCenter(s.centerCode) === normCode);
            if (sIndex === -1) throw new Error("No se encontró la salida en el día de origen.");

            const liveSourceSalida = liveSourceSalidas[sIndex];
            const liveSourceNote = (liveSourceSalida.note || '').trim();
            const currentP = Number(liveSourceSalida.plazas !== undefined ? liveSourceSalida.plazas : liveSourceSalida.pax) || 0;
            if (currentP < paxToMove) {
                throw new Error(`Plazas insuficientes en el día de origen: tiene ${currentP} y pretendes mover ${paxToMove}.`);
            }

            const liveTargetSalidas = getDaySalidas(liveTargetData, targetDate);
            const liveTargetSummary = getDaySummary(liveTargetData, targetDate);
            const liveAvailableInTarget = Math.max(0, liveTargetCap - liveTargetSummary.totalOccupied);

            if (paxToMove > liveAvailableInTarget) {
                throw new Error(`Cupo diario excedido en destino en el servidor: solo quedan ${liveAvailableInTarget} plazas disponibles.`);
            }

            if (currentP > paxToMove) {
                liveSourceSalida.plazas = currentP - paxToMove;
                liveSourceSalida.pax = liveSourceSalida.plazas;
                liveSourceSalida.updatedAt = new Date().toISOString();
            } else {
                liveSourceSalidas.splice(sIndex, 1);
            }

            const liveExistTarget = liveTargetSalidas.find(s => normCenter(s.centerCode) === normCode);
            if (liveExistTarget) {
                liveExistTarget.plazas = (Number(liveExistTarget.plazas !== undefined ? liveExistTarget.plazas : liveExistTarget.pax) || 0) + paxToMove;
                liveExistTarget.pax = liveExistTarget.plazas;
                if (!liveExistTarget.note && liveSourceNote) liveExistTarget.note = liveSourceNote;
                liveExistTarget.updatedAt = new Date().toISOString();
            } else {
                liveTargetSalidas.push({
                    id: `plazas_${targetDate}_${normCode}`,
                    date: targetDate,
                    centerCode: normCode,
                    plazas: paxToMove,
                    pax: paxToMove,
                    note: liveSourceNote,
                    updatedAt: new Date().toISOString()
                });
            }

            transaction.set(sourceRef, {
                date: sourceDate,
                totalQuota: liveSourceCap,
                salidas: liveSourceSalidas,
                allocations: syncAllocationsFromSalidas(liveSourceSalidas),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });

            transaction.set(targetRef, {
                date: targetDate,
                totalQuota: liveTargetCap,
                salidas: liveTargetSalidas,
                allocations: syncAllocationsFromSalidas(liveTargetSalidas),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
        });

        if (currentUserKey !== 'admin') {
            logBdfHistory('move_salida', {
                from: sourceDate,
                to: targetDate,
                center: normCode,
                slots: paxToMove
            }).catch(console.error);
        }
    } catch (err) {
        console.error("Error moviendo salida en Firestore:", err);
        if (prevSourceCache) monthDaysCache[sourceDate] = prevSourceCache;
        else delete monthDaysCache[sourceDate];

        if (prevTargetCache) monthDaysCache[targetDate] = prevTargetCache;
        else delete monthDaysCache[targetDate];

        renderAll();
        throw err;
    }
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

            transaction.set(docRefA, buildDayDocPayload(dateA, liveCapA, liveSalidasA), { merge: true });
            transaction.set(docRefB, buildDayDocPayload(dateB, liveCapB, liveSalidasB), { merge: true });
        });

        if (currentUserKey !== 'admin') {
            logBdfHistory('swap_salidas', {
                dateA, dateB, centerA: normA, centerB: normB, safePaxA, retainedPaxA, safePaxB, retainedPaxB
            }).catch(console.error);
        }
    } catch (err) {
        console.error("Error intercambiando salidas en Firestore:", err);
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
    if (isNaN(spots) || spots <= 0) throw new Error("La cantidad de plazas debe ser mayor a 0");
    note = sanitizeNote(note);

    await ensureDayInCache(dateStr);

    const normFrom = normCenter(fromCenter);
    const normTo = normCenter(toCenter);
    const docRef = db.collection(BDF_COLLECTIONS.DAYS).doc(dateStr);

    const transferOpts = { dateStr, normFrom, normTo, givingSalidaId, spots, note };

    // Snapshot previo para rollback
    const prevDayCache = monthDaysCache[dateStr] ? JSON.parse(JSON.stringify(monthDaysCache[dateStr])) : null;

    const currentDayData = monthDaysCache[dateStr] || null;
    const dayCap = getDayQuota(dateStr, currentDayData);

    const currentSalidas = getDaySalidas(currentDayData, dateStr);
    const occBefore = sumSalidasPlazas(currentSalidas);

    if (!applyTransferToSalidas(currentSalidas, transferOpts)) {
        throw new Error(`${CENTERS[normFrom]?.name || normFrom} no dispone de ${spots} plazas ese día.`);
    }
    if (sumSalidasPlazas(currentSalidas) !== occBefore) {
        throw new Error("Integridad: la transferencia alteraría el total de plazas del día. Operación cancelada.");
    }

    // Actualización inmediata en caché y renderizado en 0ms
    monthDaysCache[dateStr] = {
        id: dateStr,
        date: dateStr,
        totalQuota: dayCap,
        salidas: currentSalidas,
        allocations: syncAllocationsFromSalidas(currentSalidas)
    };
    renderAll();

    try {
        await db.runTransaction(async (transaction) => {
            const liveDoc = await transaction.get(docRef);
            const liveData = liveDoc.exists ? liveDoc.data() : null;
            const liveCap = getDayQuota(dateStr, liveData || {});
            const liveSalidas = getDaySalidas(liveData, dateStr);
            const liveBefore = sumSalidasPlazas(liveSalidas);

            if (!applyTransferToSalidas(liveSalidas, transferOpts)) {
                throw new Error(`${CENTERS[normFrom]?.name || normFrom} ya no dispone de ${spots} plazas ese día.`);
            }
            if (sumSalidasPlazas(liveSalidas) !== liveBefore) {
                throw new Error("Integridad: la transferencia alteraría el total de plazas del día. Operación cancelada.");
            }

            transaction.set(docRef, buildDayDocPayload(dateStr, liveCap, liveSalidas), { merge: true });
        });

        if (currentUserKey !== 'admin') {
            logBdfHistory('transfer_salida', {
                date: dateStr,
                from: normFrom,
                to: normTo,
                slots: spots,
                note: note
            }).catch(console.error);
        }
    } catch (err) {
        console.error("Error transfiriendo plazas en Firestore:", err);
        if (prevDayCache) {
            monthDaysCache[dateStr] = prevDayCache;
        } else {
            delete monthDaysCache[dateStr];
        }
        renderAll();
        throw new Error(describeFirestoreError(err, 'ceder las plazas'));
    }
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

