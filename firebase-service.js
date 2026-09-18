/**
 * @file firebase-service.js
 * @description Capa de datos y sincronización con Firebase Firestore y Auth para Visor Bajo de Fuera.
 * Utiliza colecciones independientes ('bdf_days', 'bdf_history_logs') para total aislamiento.
 */

// Inicialización de Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

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
    if (!WHATSAPP_WEBHOOK_URL || typeof WHATSAPP_WEBHOOK_URL !== 'string' || WHATSAPP_WEBHOOK_URL.trim() === "") {
        console.log("[WhatsApp Webhook inactivo] No se envía a ningún grupo. Mensaje preparado:", msg);
        return;
    }
    try {
        await fetch(WHATSAPP_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({ message: msg })
        });
    } catch (e) {
        console.error("Error en Webhook WhatsApp:", e);
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
                if (d.allocations && d.allocations['B']) {
                    if (!d.allocations['MD']) {
                        d.allocations['MD'] = d.allocations['B'];
                    }
                    delete d.allocations['B'];
                }
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
            if (d.allocations && d.allocations['B']) {
                if (!d.allocations['MD']) d.allocations['MD'] = d.allocations['B'];
                delete d.allocations['B'];
            }
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

/**
 * Acepta cualquier solicitud pendiente (Intercambio, Petición o Cesión Directa).
 * @param {string} requestId
 */
async function acceptBdfRequest(requestId) {
    const req = bdfRequests.find(r => r.id === requestId);
    if (!req) {
        showNotification('Error', 'La solicitud ya no está disponible.', true);
        return;
    }

    try {
        if (req.type === 'swap') {
            await acceptBdfSwap(req);
        } else if (req.type === 'donation' || req.type === 'request') {
            await acceptBdfSpotTransfer(req);
        }
    } catch (err) {
        console.error("Error al aceptar solicitud:", err);
        showNotification('Error', 'Hubo un problema al procesar la solicitud: ' + err.message, true);
        renderAll();
    }
}

/**
 * Acepta un intercambio propuesto (Swap) aplicando las fórmulas de split y retención (Section 5).
 * Re-valida plazas y cupos antes de ejecutar; si cambiaron, descarta la propuesta.
 * @param {Object} req
 */
async function acceptBdfSwap(req) {
    const { id: requestId, dateA, salidaIdA, centerA, dateB, salidaIdB, centerB } = req;
    await Promise.all([ensureDayInCache(dateA), ensureDayInCache(dateB)]);

    const normA = normCenter(centerA);
    const normB = normCenter(centerB);

    const dayDataA = monthDaysCache[dateA] || null;
    const summaryA = getDaySummary(dayDataA, dateA);
    const maxQuotaA = getDayQuota(dateA, dayDataA);

    const dayDataB = monthDaysCache[dateB] || null;
    const summaryB = getDaySummary(dayDataB, dateB);
    const maxQuotaB = getDayQuota(dateB, dayDataB);

    const salidasA = getDaySalidas(dayDataA, dateA);
    const salidasB = getDaySalidas(dayDataB, dateB);

    const sA = salidasA.find(s => s.id === salidaIdA || normCenter(s.centerCode) === normA);
    const sB = salidasB.find(s => s.id === salidaIdB || normCenter(s.centerCode) === normB);

    // Si los barcos ya no existen, la propuesta no es válida
    if (!sA || !sB) {
        await db.collection(BDF_COLLECTIONS.REQUESTS).doc(requestId).delete().catch(console.error);
        closeNotificationsModal();
        showNotification(
            'Propuesta No Válida',
            'Las plazas o los cupos han cambiado desde que se envió esta propuesta. Pídele a la otra escuela que la proponga de nuevo.',
            true
        );
        renderAll();
        return;
    }

    // Si algún día supera el cupo máximo
    if (summaryA.totalOccupied > maxQuotaA || summaryB.totalOccupied > maxQuotaB) {
        await db.collection(BDF_COLLECTIONS.REQUESTS).doc(requestId).delete().catch(console.error);
        closeNotificationsModal();
        showNotification(
            'Propuesta No Válida',
            'Las plazas o los cupos han cambiado desde que se envió esta propuesta. Pídele a la otra escuela que la proponga de nuevo.',
            true
        );
        renderAll();
        return;
    }

    const currentPaxA = Number(sA.totalPlazas !== undefined ? sA.totalPlazas : (sA.plazas !== undefined ? sA.plazas : sA.pax)) || 0;
    const currentPaxB = Number(sB.totalPlazas !== undefined ? sB.totalPlazas : (sB.plazas !== undefined ? sB.plazas : sB.pax)) || 0;

    // Recalcular con las mismas fórmulas que initiateSwap():
    const space_A = maxQuotaA - (summaryA.totalOccupied - currentPaxA);
    const space_B = maxQuotaB - (summaryB.totalOccupied - currentPaxB);

    // Si el swap está bloqueado (espacio <= 0)
    if (space_A <= 0 || space_B <= 0) {
        await db.collection(BDF_COLLECTIONS.REQUESTS).doc(requestId).delete().catch(console.error);
        closeNotificationsModal();
        showNotification(
            'Propuesta No Válida',
            'Las plazas o los cupos han cambiado desde que se envió esta propuesta. Pídele a la otra escuela que la proponga de nuevo.',
            true
        );
        renderAll();
        return;
    }

    const safe_A = Math.min(currentPaxA, space_B);
    const safe_B = Math.min(currentPaxB, space_A);
    const retained_A = currentPaxA - safe_A;
    const retained_B = currentPaxB - safe_B;

    const reqPaxA = parseInt(req.paxA, 10) || 0;
    const reqRetainedA = parseInt(req.retainedPaxA, 10) || 0;
    const reqPaxB = parseInt(req.paxB, 10) || 0;
    const reqRetainedB = parseInt(req.retainedPaxB, 10) || 0;

    const differs = (
        safe_A !== reqPaxA ||
        retained_A !== reqRetainedA ||
        safe_B !== reqPaxB ||
        retained_B !== reqRetainedB ||
        (req.spaceA !== undefined && space_A !== req.spaceA) ||
        (req.spaceB !== undefined && space_B !== req.spaceB)
    );

    if (differs) {
        await db.collection(BDF_COLLECTIONS.REQUESTS).doc(requestId).delete().catch(console.error);
        closeNotificationsModal();
        showNotification(
            'Propuesta No Válida',
            'Las plazas o los cupos han cambiado desde que se envió esta propuesta. Pídele a la otra escuela que la proponga de nuevo.',
            true
        );
        renderAll();
        return;
    }

    const cAInfo = CENTERS[normA] || { name: normA, emoji: '⛵' };
    const cBInfo = CENTERS[normB] || { name: normB, emoji: '⛵' };
    const dA = formatDateShort(parseDateT00(dateA));
    const dB = formatDateShort(parseDateT00(dateB));

    // 1. Ejecutar swap con transacción atómica y esperar escritura
    await executeSwapSalidas(dateA, salidaIdA, normA, safe_A, retained_A, dateB, salidaIdB, normB, safe_B, retained_B);

    // 2. Eliminar la solicitud de la colección SOLO DESPUÉS de que la escritura se complete con éxito
    await db.collection(BDF_COLLECTIONS.REQUESTS).doc(requestId).delete();

    // 3. Enviar aviso por WhatsApp (si no es admin) de fondo
    if (currentUserKey !== 'admin') {
        const msg = `🤖 *AVISO AUTOMÁTICO*\n✅ *INTERCAMBIO ACEPTADO* - ${cAInfo.emoji} ${cAInfo.name} ↔️ ${cBInfo.emoji} ${cBInfo.name}\nSe ha completado el intercambio de fechas en Bajo de Fuera:\n• ${cAInfo.name}: pasa al ${dB} (${safe_A} pl.)${retained_A > 0 ? ` (mantiene ${retained_A} pl. en el ${dA})` : ''}\n• ${cBInfo.name}: pasa al ${dA} (${safe_B} pl.)${retained_B > 0 ? ` (mantiene ${retained_B} pl. en el ${dB})` : ''}`;
        sendBdfWebhook(msg).catch(console.error);
    }

    // 4. Actualizar interfaz y feedback de éxito
    closeNotificationsModal();
    showToast('Intercambio Aceptado', `Completado el intercambio entre ${dA} y ${dB}.`);
}

/**
 * Acepta una transferencia de plazas (Petición - Sections 3 y 3.1).
 * Crea una salida NUEVA e independiente para el receptor, sin fusionar.
 * @param {Object} req
 */
async function acceptBdfSpotTransfer(req) {
    const { id: requestId, date, requestedPax, pax, isFull } = req;
    await ensureDayInCache(date);
    const spots = Number(requestedPax || pax || 0);

    const isDonation = req.type === 'donation';
    const givingCenter = normCenter(isDonation ? req.initiatorCenter : req.targetCenter);
    const receivingCenter = normCenter(isDonation ? req.targetCenter : req.initiatorCenter);
    const givingSalidaId = req.givingSalidaId || req.targetSalidaId || null;

    const gInfo = CENTERS[givingCenter] || { name: givingCenter, emoji: '⛵' };
    const rInfo = CENTERS[receivingCenter] || { name: receivingCenter, emoji: '⛵' };
    const dStr = formatDateShort(parseDateT00(date));

    // 1. Ejecutar transferencia atómica de salidas (Section 3 / 3.1) y esperar escritura
    await executeSpotTransferSalidas(date, givingSalidaId, givingCenter, receivingCenter, spots, (req.note || '').trim());

    // 2. Eliminar la solicitud de Firestore SOLO DESPUÉS de que la escritura se complete con éxito
    await db.collection(BDF_COLLECTIONS.REQUESTS).doc(requestId).delete();

    // 3. Notificar por WhatsApp de fondo (si no es admin)
    if (currentUserKey !== 'admin') {
        const titleText = isDonation ? 'CESIÓN ACEPTADA' : 'PETICIÓN ACEPTADA';
        const msg = `🤖 *AVISO AUTOMÁTICO*\n✅ *${titleText}* - ${gInfo.emoji} ${gInfo.name} a ${rInfo.emoji} ${rInfo.name}\nPara el ${dStr}, ${gInfo.name} ha transferido ${isFull ? 'el barco completo' : `${spots} plazas`} en Bajo de Fuera a ${rInfo.name}.`;
        sendBdfWebhook(msg).catch(console.error);
    }

    // 4. Actualizar interfaz y feedback de éxito
    closeNotificationsModal();
    showToast('Petición Aceptada', `Has transferido ${spots} plazas a ${rInfo.name}.`);
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
 * Ejecuta una Cesión Directa de plazas del Centro A al Centro B.
 * @param {string} dateStr - 'YYYY-MM-DD'
 * @param {string} fromCenterCode - 'B', 'M', etc.
 * @param {string} toCenterCode - 'B', 'M', etc.
 * @param {number} slots - Cantidad de plazas a transferir
 * @param {string} note - Nota opcional
 */
async function executeTransfer(dateStr, fromCenterCode, toCenterCode, slots, note = '') {
    slots = parseInt(slots, 10);
    if (isNaN(slots) || slots <= 0) throw new Error("La cantidad de plazas debe ser mayor a 0");
    if (fromCenterCode === toCenterCode) throw new Error("No puedes ceder plazas a tu propio centro");

    const docRef = db.collection(BDF_COLLECTIONS.DAYS).doc(dateStr);

    await db.runTransaction(async (transaction) => {
        const doc = await transaction.get(docRef);
        let dayData = doc.exists ? doc.data() : {
            date: dateStr,
            totalQuota: DEFAULT_DAILY_CAP,
            allocations: {},
            transfers: [],
            releases: [],
            claims: []
        };

        const balanceFrom = getCenterBalance(fromCenterCode, dayData);
        if (balanceFrom.effectiveSlots < slots) {
            throw new Error(`Plazas insuficientes. Tienes ${balanceFrom.effectiveSlots} plazas y quieres ceder ${slots}.`);
        }

        const balanceTo = getCenterBalance(toCenterCode, dayData);
        const dayCap = getDayQuota(dateStr, dayData);
        if (balanceTo.effectiveSlots + slots > dayCap) {
            throw new Error(`El centro receptor superaría el cupo diario de ${dayCap} plazas (${balanceTo.effectiveSlots} + ${slots} = ${balanceTo.effectiveSlots + slots}).`);
        }

        const transferObj = {
            id: 'trans_' + Date.now(),
            from: fromCenterCode,
            to: toCenterCode,
            slots: slots,
            note: note.trim(),
            timestamp: new Date().toISOString()
        };

        const currentTransfers = dayData.transfers || [];
        currentTransfers.push(transferObj);

        transaction.set(docRef, {
            ...dayData,
            transfers: currentTransfers
        }, { merge: true });
    });

    // Auditoría e Historial
    const fromName = CENTERS[fromCenterCode]?.name || fromCenterCode;
    const toName = CENTERS[toCenterCode]?.name || toCenterCode;
    const fromEmoji = CENTERS[fromCenterCode]?.emoji || '🔴';
    const toEmoji = CENTERS[toCenterCode]?.emoji || '🔵';

    await logBdfHistory('transfer', {
        date: dateStr,
        fromCenter: fromCenterCode,
        toCenter: toCenterCode,
        slots: slots,
        note: note
    });

    // Notificación WhatsApp (Solo para centros, no para admin)
    const dateFormatted = formatDateShort(parseDateT00(dateStr));
    let msg = `🌊 *BAJO DE FUERA* | Cesión de Plazas\n` +
              `📅 *Fecha:* ${dateFormatted}\n` +
              `📤 *De:* ${fromEmoji} ${fromName}\n` +
              `📥 *A:* ${toEmoji} ${toName}\n` +
              `🎟️ *Plazas:* ${slots} ${slots === 1 ? 'plaza' : 'plazas'}`;
    if (note) msg += `\n📝 *Nota:* ${note}`;

    if (currentUserKey !== 'admin') {
        await sendBdfWebhook(msg);
    }
}

/**
 * Libera plazas al Pool Común de Plazas Libres del día.
 * @param {string} dateStr - 'YYYY-MM-DD'
 * @param {string} centerCode
 * @param {number} slots
 * @param {string} note
 */
async function executeReleaseToPool(dateStr, centerCode, slots, note = '') {
    slots = parseInt(slots, 10);
    if (isNaN(slots) || slots <= 0) throw new Error("La cantidad de plazas debe ser mayor a 0");

    const docRef = db.collection(BDF_COLLECTIONS.DAYS).doc(dateStr);

    await db.runTransaction(async (transaction) => {
        const doc = await transaction.get(docRef);
        let dayData = doc.exists ? doc.data() : {
            date: dateStr,
            totalQuota: DEFAULT_DAILY_CAP,
            allocations: {},
            transfers: [],
            releases: [],
            claims: []
        };

        const balance = getCenterBalance(centerCode, dayData);
        if (balance.effectiveSlots < slots) {
            throw new Error(`Plazas insuficientes. Tienes ${balance.effectiveSlots} plazas y quieres liberar ${slots}.`);
        }

        const releaseObj = {
            id: 'rel_' + Date.now(),
            from: centerCode,
            slots: slots,
            note: note.trim(),
            timestamp: new Date().toISOString()
        };

        const currentReleases = dayData.releases || [];
        currentReleases.push(releaseObj);

        transaction.set(docRef, {
            ...dayData,
            releases: currentReleases
        }, { merge: true });
    });

    const centerName = CENTERS[centerCode]?.name || centerCode;
    const centerEmoji = CENTERS[centerCode]?.emoji || '🟢';

    await logBdfHistory('release', {
        date: dateStr,
        center: centerCode,
        slots: slots,
        note: note
    });

    const dateFormatted = formatDateShort(parseDateT00(dateStr));
    let msg = `🌊 *BAJO DE FUERA* | Plazas Liberadas al Pool\n` +
              `📅 *Fecha:* ${dateFormatted}\n` +
              `🔓 *Centro:* ${centerEmoji} ${centerName}\n` +
              `🎟️ *Plazas liberadas:* ${slots} ${slots === 1 ? 'plaza' : 'plazas'} al Pool Común`;
    if (note) msg += `\n📝 *Nota:* ${note}`;

    if (currentUserKey !== 'admin') {
        await sendBdfWebhook(msg);
    }
}

/**
 * Coge plazas disponibles del Pool Libre del día.
 * @param {string} dateStr - 'YYYY-MM-DD'
 * @param {string} centerCode
 * @param {number} slots
 */
async function executeClaimFromPool(dateStr, centerCode, slots) {
    slots = parseInt(slots, 10);
    if (isNaN(slots) || slots <= 0) throw new Error("La cantidad de plazas debe ser mayor a 0");

    const docRef = db.collection(BDF_COLLECTIONS.DAYS).doc(dateStr);

    let newTotalSlots = 0;

    await db.runTransaction(async (transaction) => {
        const doc = await transaction.get(docRef);
        let dayData = doc.exists ? doc.data() : {
            date: dateStr,
            totalQuota: DEFAULT_DAILY_CAP,
            allocations: {},
            transfers: [],
            releases: [],
            claims: []
        };

        const summary = getDaySummary(dayData);
        if (summary.poolAvailable < slots) {
            throw new Error(`Solo hay ${summary.poolAvailable} plazas disponibles en el Pool Libre.`);
        }

        const balance = getCenterBalance(centerCode, dayData);
        const dayCap = getDayQuota(dateStr, dayData);
        if (balance.effectiveSlots + slots > dayCap) {
            throw new Error(`Superarías el cupo diario de ${dayCap} plazas. Tienes ${balance.effectiveSlots} plazas y pretendes coger ${slots} (${balance.effectiveSlots + slots} plazas).`);
        }

        newTotalSlots = balance.effectiveSlots + slots;

        const claimObj = {
            id: 'clm_' + Date.now(),
            by: centerCode,
            slots: slots,
            timestamp: new Date().toISOString()
        };

        const currentClaims = dayData.claims || [];
        currentClaims.push(claimObj);

        transaction.set(docRef, {
            ...dayData,
            claims: currentClaims
        }, { merge: true });
    });

    const centerName = CENTERS[centerCode]?.name || centerCode;
    const centerEmoji = CENTERS[centerCode]?.emoji || '🔵';

    await logBdfHistory('claim', {
        date: dateStr,
        center: centerCode,
        slots: slots,
        totalEffective: newTotalSlots
    });

    const dateFormatted = formatDateShort(parseDateT00(dateStr));
    let msg = `🌊 *BAJO DE FUERA* | Plazas Cogidas del Pool\n` +
              `📅 *Fecha:* ${dateFormatted}\n` +
              `🎯 *Centro:* ${centerEmoji} ${centerName}\n` +
              `🎟️ *Plazas añadidas:* +${slots} plazas\n` +
              `⛵ *Total Plazas Centro:* ${newTotalSlots} plazas`;

    if (currentUserKey !== 'admin') {
        await sendBdfWebhook(msg);
    }
}

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

    const normCode = normCenter(centerCode);
    const docRef = db.collection(BDF_COLLECTIONS.DAYS).doc(dateStr);

    let finalSalidas = [];
    let finalCap = 0;

    await db.runTransaction(async (transaction) => {
        const docSnap = await transaction.get(docRef);
        const dayData = docSnap.exists ? docSnap.data() : null;

        const dayCap = getDayQuota(dateStr, dayData);
        const summary = getDaySummary(dayData, dateStr);
        const remaining = Math.max(0, dayCap - summary.totalOccupied);
        if (pax > remaining) {
            throw new Error(`Cupo diario excedido: solo quedan ${remaining} plazas disponibles hoy (máximo ${dayCap} plazas/día).`);
        }

        const currentSalidas = getDaySalidas(dayData, dateStr);
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

        finalSalidas = currentSalidas;
        finalCap = dayCap;

        transaction.set(docRef, {
            date: dateStr,
            totalQuota: dayCap,
            salidas: currentSalidas,
            allocations: syncAllocationsFromSalidas(currentSalidas),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
    });

    if (!monthDaysCache[dateStr]) {
        monthDaysCache[dateStr] = {
            id: dateStr,
            date: dateStr,
            totalQuota: finalCap,
            salidas: finalSalidas,
            allocations: syncAllocationsFromSalidas(finalSalidas)
        };
    } else {
        monthDaysCache[dateStr].totalQuota = finalCap;
        monthDaysCache[dateStr].salidas = finalSalidas;
        monthDaysCache[dateStr].allocations = syncAllocationsFromSalidas(finalSalidas);
    }
    renderAll();

    if (currentUserKey !== 'admin') {
        logBdfHistory('add_salida', {
            date: dateStr,
            center: normCode,
            slots: pax,
            note: note
        }).catch(console.error);
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

    const docRef = db.collection(BDF_COLLECTIONS.DAYS).doc(dateStr);
    let finalSalidas = [];
    let finalCap = 0;
    let oldCenter = '';
    let finalTarget = '';

    await db.runTransaction(async (transaction) => {
        const docSnap = await transaction.get(docRef);
        const dayData = docSnap.exists ? docSnap.data() : null;

        const dayCap = getDayQuota(dateStr, dayData);
        const currentSalidas = getDaySalidas(dayData, dateStr);
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

        oldCenter = currentSalida.centerCode;
        finalTarget = normNewCenter || normCenter(oldCenter);

        currentSalidas[salidaIndex] = {
            ...currentSalida,
            centerCode: finalTarget,
            plazas: newPax,
            pax: newPax,
            note: (newNote !== undefined ? newNote : currentSalida.note || '').trim(),
            updatedAt: new Date().toISOString()
        };

        finalSalidas = currentSalidas;
        finalCap = dayCap;

        transaction.set(docRef, {
            date: dateStr,
            totalQuota: dayCap,
            salidas: currentSalidas,
            allocations: syncAllocationsFromSalidas(currentSalidas),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
    });

    if (!monthDaysCache[dateStr]) monthDaysCache[dateStr] = { id: dateStr, date: dateStr, totalQuota: finalCap };
    monthDaysCache[dateStr].totalQuota = finalCap;
    monthDaysCache[dateStr].salidas = finalSalidas;
    monthDaysCache[dateStr].allocations = syncAllocationsFromSalidas(finalSalidas);
    renderAll();

    if (currentUserKey !== 'admin') {
        logBdfHistory('edit_salida', {
            date: dateStr,
            center: finalTarget,
            oldCenter: oldCenter,
            slots: newPax,
            note: newNote
        }).catch(console.error);
    }
}

/**
 * Elimina las plazas de una escuela en un día optimísticamente en 0ms (Section 2, Opción 3).
 * @param {string} dateStr
 * @param {string} salidaId
 * @param {string} [centerCode]
 */
async function executeDeleteSalida(dateStr, salidaId, centerCode = null) {
    const docRef = db.collection(BDF_COLLECTIONS.DAYS).doc(dateStr);
    let finalSalidas = [];
    let finalCap = 0;
    const normCode = centerCode ? normCenter(centerCode) : null;

    await db.runTransaction(async (transaction) => {
        const docSnap = await transaction.get(docRef);
        const dayData = docSnap.exists ? docSnap.data() : null;
        const dayCap = getDayQuota(dateStr, dayData);

        let currentSalidas = getDaySalidas(dayData, dateStr);
        if (salidaId) {
            currentSalidas = currentSalidas.filter(s => s.id !== salidaId);
        } else if (normCode) {
            currentSalidas = currentSalidas.filter(s => normCenter(s.centerCode) !== normCode);
        }

        finalSalidas = currentSalidas;
        finalCap = dayCap;

        transaction.set(docRef, {
            date: dateStr,
            salidas: currentSalidas,
            allocations: syncAllocationsFromSalidas(currentSalidas),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
    });

    if (!monthDaysCache[dateStr]) monthDaysCache[dateStr] = { id: dateStr, date: dateStr, totalQuota: finalCap };
    monthDaysCache[dateStr].salidas = finalSalidas;
    monthDaysCache[dateStr].allocations = syncAllocationsFromSalidas(finalSalidas);
    renderAll();

    if (currentUserKey !== 'admin') {
        logBdfHistory('delete_salida', {
            date: dateStr,
            center: centerCode
        }).catch(console.error);
    }
}

/**
 * Mueve plazas de una escuela a otro día (Scenario 4A / 4B Opción 1).
 * Lee ambos días en una misma transacción Firestore antes de modificar.
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

    const normCode = normCenter(centerCode);
    const sourceRef = db.collection(BDF_COLLECTIONS.DAYS).doc(sourceDate);
    const targetRef = db.collection(BDF_COLLECTIONS.DAYS).doc(targetDate);

    let finalSourceSalidas = [];
    let finalTargetSalidas = [];
    let finalSourceCap = 0;
    let finalTargetCap = 0;

    await db.runTransaction(async (transaction) => {
        // Lectura de ambos documentos antes de cualquier escritura
        const [sourceDoc, targetDoc] = await Promise.all([
            transaction.get(sourceRef),
            transaction.get(targetRef)
        ]);

        const sourceData = sourceDoc.exists ? sourceDoc.data() : null;
        const targetData = targetDoc.exists ? targetDoc.data() : null;

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

        finalSourceSalidas = sourceSalidas;
        finalTargetSalidas = targetSalidas;
        finalSourceCap = sourceCap;
        finalTargetCap = targetCap;

        transaction.set(sourceRef, {
            date: sourceDate,
            totalQuota: sourceCap,
            salidas: sourceSalidas,
            allocations: syncAllocationsFromSalidas(sourceSalidas),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        transaction.set(targetRef, {
            date: targetDate,
            totalQuota: targetCap,
            salidas: targetSalidas,
            allocations: syncAllocationsFromSalidas(targetSalidas),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
    });

    if (!monthDaysCache[sourceDate]) monthDaysCache[sourceDate] = { id: sourceDate, date: sourceDate, totalQuota: finalSourceCap };
    monthDaysCache[sourceDate].totalQuota = finalSourceCap;
    monthDaysCache[sourceDate].salidas = finalSourceSalidas;
    monthDaysCache[sourceDate].allocations = syncAllocationsFromSalidas(finalSourceSalidas);

    if (!monthDaysCache[targetDate]) monthDaysCache[targetDate] = { id: targetDate, date: targetDate, totalQuota: finalTargetCap };
    monthDaysCache[targetDate].totalQuota = finalTargetCap;
    monthDaysCache[targetDate].salidas = finalTargetSalidas;
    monthDaysCache[targetDate].allocations = syncAllocationsFromSalidas(finalTargetSalidas);

    renderAll();

    if (currentUserKey !== 'admin') {
        logBdfHistory('move_salida', {
            from: sourceDate,
            to: targetDate,
            center: normCode,
            slots: paxToMove
        }).catch(console.error);
    }
}

/**
 * Ejecuta el intercambio de fechas entre dos escuelas con soporte de split asimétrico (Section 5).
 * Las plazas retained se mantienen en sus días de origen como total activo.
 * En los días de destino, las plazas se SUMAN al total de la escuela si ya tenía plazas (principio aditivo).
 * Lee y escribe ambos días en una misma transacción Firestore.
 */
async function executeSwapSalidas(dateA, salidaIdA, centerA, safePaxA, retainedPaxA, dateB, salidaIdB, centerB, safePaxB, retainedPaxB) {
    safePaxA = parseInt(safePaxA, 10) || 0;
    safePaxB = parseInt(safePaxB, 10) || 0;
    retainedPaxA = parseInt(retainedPaxA, 10) || 0;
    retainedPaxB = parseInt(retainedPaxB, 10) || 0;

    const normA = normCenter(centerA);
    const normB = normCenter(centerB);

    const docRefA = db.collection(BDF_COLLECTIONS.DAYS).doc(dateA);
    const docRefB = db.collection(BDF_COLLECTIONS.DAYS).doc(dateB);

    let finalSalidasA = [];
    let finalSalidasB = [];
    let finalCapA = 0;
    let finalCapB = 0;

    await db.runTransaction(async (transaction) => {
        // Lectura de ambos documentos dentro de la transacción
        const [docSnapA, docSnapB] = await Promise.all([
            transaction.get(docRefA),
            transaction.get(docRefB)
        ]);

        const dayDataA = docSnapA.exists ? docSnapA.data() : null;
        const dayDataB = docSnapB.exists ? docSnapB.data() : null;

        const dayCapA = getDayQuota(dateA, dayDataA);
        const dayCapB = getDayQuota(dateB, dayDataB);

        const salidasA = getDaySalidas(dayDataA, dateA);
        const salidasB = getDaySalidas(dayDataB, dateB);

        // 1. Ajustar Escuela A en Día A
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

        // Llegada de Escuela B a Día A (safePaxB plazas)
        if (safePaxB > 0) {
            const existBInA = salidasA.find(s => normCenter(s.centerCode) === normB);
            if (existBInA) {
                existBInA.plazas = (Number(existBInA.plazas !== undefined ? existBInA.plazas : existBInA.pax) || 0) + safePaxB;
                existBInA.pax = existBInA.plazas;
                existBInA.updatedAt = new Date().toISOString();
            } else {
                salidasA.push({
                    id: `plazas_${dateA}_${normB}`,
                    date: dateA,
                    centerCode: normB,
                    plazas: safePaxB,
                    pax: safePaxB,
                    note: '',
                    updatedAt: new Date().toISOString()
                });
            }
        }

        // 2. Ajustar Escuela B en Día B
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

        // Llegada de Escuela A a Día B (safePaxA plazas)
        if (safePaxA > 0) {
            const existAInB = salidasB.find(s => normCenter(s.centerCode) === normA);
            if (existAInB) {
                existAInB.plazas = (Number(existAInB.plazas !== undefined ? existAInB.plazas : existAInB.pax) || 0) + safePaxA;
                existAInB.pax = existAInB.plazas;
                existAInB.updatedAt = new Date().toISOString();
            } else {
                salidasB.push({
                    id: `plazas_${dateB}_${normA}`,
                    date: dateB,
                    centerCode: normA,
                    plazas: safePaxA,
                    pax: safePaxA,
                    note: '',
                    updatedAt: new Date().toISOString()
                });
            }
        }

        // Comprobación de cupos en ambos días
        const occA = salidasA.reduce((sum, s) => sum + (Number(s.plazas !== undefined ? s.plazas : s.pax) || 0), 0);
        const occB = salidasB.reduce((sum, s) => sum + (Number(s.plazas !== undefined ? s.plazas : s.pax) || 0), 0);

        if (occA > dayCapA) {
            throw new Error(`Cupo diario excedido en ${dateA}: total ocupado (${occA}) supera el límite de ${dayCapA}.`);
        }
        if (occB > dayCapB) {
            throw new Error(`Cupo diario excedido en ${dateB}: total ocupado (${occB}) supera el límite de ${dayCapB}.`);
        }

        finalSalidasA = salidasA;
        finalSalidasB = salidasB;
        finalCapA = dayCapA;
        finalCapB = dayCapB;

        transaction.set(docRefA, {
            date: dateA,
            totalQuota: dayCapA,
            salidas: salidasA,
            allocations: syncAllocationsFromSalidas(salidasA),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        transaction.set(docRefB, {
            date: dateB,
            totalQuota: dayCapB,
            salidas: salidasB,
            allocations: syncAllocationsFromSalidas(salidasB),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
    });

    // Actualización de cache y renderizado
    if (!monthDaysCache[dateA]) monthDaysCache[dateA] = { id: dateA, date: dateA, totalQuota: finalCapA };
    monthDaysCache[dateA].totalQuota = finalCapA;
    monthDaysCache[dateA].salidas = finalSalidasA;
    monthDaysCache[dateA].allocations = syncAllocationsFromSalidas(finalSalidasA);

    if (!monthDaysCache[dateB]) monthDaysCache[dateB] = { id: dateB, date: dateB, totalQuota: finalCapB };
    monthDaysCache[dateB].totalQuota = finalCapB;
    monthDaysCache[dateB].salidas = finalSalidasB;
    monthDaysCache[dateB].allocations = syncAllocationsFromSalidas(finalSalidasB);

    renderAll();

    if (currentUserKey !== 'admin') {
        logBdfHistory('swap_salidas', {
            dateA, dateB, centerA: normA, centerB: normB, safePaxA, retainedPaxA, safePaxB, retainedPaxB
        }).catch(console.error);
    }
}

/**
 * Transfiere plazas de una escuela cedente a una escuela receptora (Sections 3 y 3.1).
 * La escuela cedente reduce sus plazas (se elimina si llega a 0), y el receptor
 * suma esas plazas a su total en esa fecha (principio aditivo de Section 0).
 */
async function executeSpotTransferSalidas(dateStr, givingSalidaId, fromCenter, toCenter, spots, note = '') {
    spots = parseInt(spots, 10);
    if (isNaN(spots) || spots <= 0) throw new Error("La cantidad de plazas debe ser mayor a 0");

    const normFrom = normCenter(fromCenter);
    const normTo = normCenter(toCenter);
    const docRef = db.collection(BDF_COLLECTIONS.DAYS).doc(dateStr);

    let finalSalidas = [];
    let finalCap = 0;

    await db.runTransaction(async (transaction) => {
        const docSnap = await transaction.get(docRef);
        const dayData = docSnap.exists ? docSnap.data() : null;
        const dayCap = getDayQuota(dateStr, dayData);

        const currentSalidas = getDaySalidas(dayData, dateStr);
        const sIndex = currentSalidas.findIndex(s => normCenter(s.centerCode) === normFrom || s.id === givingSalidaId);
        if (sIndex === -1) throw new Error("No se encontró la escuela que cede las plazas.");

        const givingSalida = currentSalidas[sIndex];
        const currentFromPlazas = Number(givingSalida.plazas !== undefined ? givingSalida.plazas : givingSalida.pax) || 0;
        if (currentFromPlazas < spots) {
            throw new Error(`Plazas insuficientes en la escuela: tiene ${currentFromPlazas} y pretendes transferir ${spots}.`);
        }

        // 1. Reducir plazas de la escuela cedente (o eliminarla si llega a 0)
        if (currentFromPlazas > spots) {
            givingSalida.plazas = currentFromPlazas - spots;
            givingSalida.pax = givingSalida.plazas;
            givingSalida.updatedAt = new Date().toISOString();
        } else {
            currentSalidas.splice(sIndex, 1);
        }

        // 2. Sumar al total de la escuela receptora si ya existe, o crear nuevo registro si no
        const existTo = currentSalidas.find(s => normCenter(s.centerCode) === normTo);
        if (existTo) {
            existTo.plazas = (Number(existTo.plazas !== undefined ? existTo.plazas : existTo.pax) || 0) + spots;
            existTo.pax = existTo.plazas;
            existTo.updatedAt = new Date().toISOString();
        } else {
            currentSalidas.push({
                id: `plazas_${dateStr}_${normTo}`,
                date: dateStr,
                centerCode: normTo,
                plazas: spots,
                pax: spots,
                note: (note || '').trim(),
                updatedAt: new Date().toISOString()
            });
        }

        finalSalidas = currentSalidas;
        finalCap = dayCap;

        transaction.set(docRef, {
            date: dateStr,
            totalQuota: dayCap,
            salidas: currentSalidas,
            allocations: syncAllocationsFromSalidas(currentSalidas),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
    });

    if (!monthDaysCache[dateStr]) monthDaysCache[dateStr] = { id: dateStr, date: dateStr, totalQuota: finalCap };
    monthDaysCache[dateStr].totalQuota = finalCap;
    monthDaysCache[dateStr].salidas = finalSalidas;
    monthDaysCache[dateStr].allocations = syncAllocationsFromSalidas(finalSalidas);
    renderAll();

    if (currentUserKey !== 'admin') {
        logBdfHistory('transfer_salida', {
            date: dateStr,
            from: normFrom,
            to: normTo,
            slots: spots,
            note: note
        }).catch(console.error);
    }
}

/**
 * Guarda o actualiza la asignación inicial del día (administrador).
 * @param {string} dateStr
 * @param {number} totalQuota
 * @param {Object} allocations - { 'B': { initialSlots: 8 }, 'M': { initialSlots: 8 }, ... }
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
 * @param {Object} daysMap - { 'YYYY-MM-DD': { 'B': { initialSlots: 8 }, 'M': { initialSlots: 8 } } }
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
        const snap = await db.collection(DAYS_COLLECTION).get();
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

