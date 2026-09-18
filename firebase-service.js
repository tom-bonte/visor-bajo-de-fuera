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
                totalQuota: DEFAULT_DAILY_CAP,
                allocations: {},
                transfers: [],
                releases: [],
                claims: []
            };
        }
        monthDaysCache[dateStr] = currentDayData;
        renderAll();
    }, (error) => {
        console.error("Error escuchando día en Firestore:", error);
    });
}

/**
 * Inicia la escucha de todos los días de un mes para la vista mensual de calendario.
 * @param {number} year
 * @param {number} month - 0 a 11
 */
function listenMonthOverview(year, month) {
    if (unsubscribeMonthListener) {
        unsubscribeMonthListener();
        unsubscribeMonthListener = null;
    }

    const startStr = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const lastDayNum = new Date(year, month + 1, 0).getDate();
    const endStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDayNum).padStart(2, '0')}`;

    unsubscribeMonthListener = db.collection(BDF_COLLECTIONS.DAYS)
        .where(firebase.firestore.FieldPath.documentId(), '>=', startStr)
        .where(firebase.firestore.FieldPath.documentId(), '<=', endStr)
        .onSnapshot((snapshot) => {
            snapshot.forEach(doc => {
                const d = doc.data() || {};
                // Limpieza automática si se coló la salida de prueba de 3 plazas de Islas Hormigas en 2026-09-03
                if (doc.id === '2026-09-03' && d.allocations && d.allocations['H'] && d.allocations['H'].initialSlots === 3) {
                    delete d.allocations['H'];
                    db.collection(BDF_COLLECTIONS.DAYS).doc('2026-09-03').update({
                        'allocations.H': firebase.firestore.FieldValue.delete()
                    }).catch(console.error);
                }
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
            console.error("Error escuchando mes en Firestore:", error);
        });
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
                // Cesión directa es interacción de 1 paso: auto-ejecutar si hubiera alguna pendiente previa
                if (data.type === 'donation') {
                    acceptBdfSpotTransfer({ id: doc.id, ...data }).catch(console.error);
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
    }
}

/**
 * Acepta un intercambio propuesto (Swap) aplicando las fórmulas de split y retención (Section 5).
 * @param {Object} req
 */
async function acceptBdfSwap(req) {
    const { id: requestId, dateA, salidaIdA, centerA, paxA, retainedPaxA = 0, dateB, salidaIdB, centerB, paxB, retainedPaxB = 0 } = req;
    const cAInfo = CENTERS[centerA] || { name: centerA, emoji: '⛵' };
    const cBInfo = CENTERS[centerB] || { name: centerB, emoji: '⛵' };
    const dA = formatDateShort(parseDateT00(dateA));
    const dB = formatDateShort(parseDateT00(dateB));

    // 1. Ejecutar swap con splits y retenciones atómicamente
    await executeSwapSalidas(dateA, salidaIdA, centerA, paxA, retainedPaxA, dateB, salidaIdB, centerB, paxB, retainedPaxB);

    // 2. Eliminar la solicitud de la colección
    await db.collection(BDF_COLLECTIONS.REQUESTS).doc(requestId).delete();

    // 3. Enviar aviso por WhatsApp (si no es admin) de fondo
    if (currentUserKey !== 'admin') {
        const msg = `🤖 *AVISO AUTOMÁTICO*\n✅ *INTERCAMBIO ACEPTADO* - ${cAInfo.emoji} ${cAInfo.name} ↔️ ${cBInfo.emoji} ${cBInfo.name}\nSe ha completado el intercambio de fechas en Bajo de Fuera:\n• ${cAInfo.name}: pasa al ${dB} (${paxA} pl.)${retainedPaxA > 0 ? ` (mantiene ${retainedPaxA} pl. en el ${dA})` : ''}\n• ${cBInfo.name}: pasa al ${dA} (${paxB} pl.)${retainedPaxB > 0 ? ` (mantiene ${retainedPaxB} pl. en el ${dB})` : ''}`;
        sendBdfWebhook(msg).catch(console.error);
    }

    // 4. Actualizar interfaz
    closeNotificationsModal();
}

/**
 * Acepta una transferencia de plazas (Petición o Cesión Directa - Sections 3 y 3.1).
 * Crea una salida NUEVA e independiente para el receptor, sin fusionar.
 * @param {Object} req
 */
async function acceptBdfSpotTransfer(req) {
    const { id: requestId, date, requestedPax, pax, isFull } = req;
    const spots = Number(requestedPax || pax || 0);

    const isDonation = req.type === 'donation';
    const givingCenter = isDonation ? req.initiatorCenter : req.targetCenter;
    const receivingCenter = isDonation ? req.targetCenter : req.initiatorCenter;
    const givingSalidaId = req.givingSalidaId || req.targetSalidaId || null;

    const gInfo = CENTERS[givingCenter] || { name: givingCenter, emoji: '⛵' };
    const rInfo = CENTERS[receivingCenter] || { name: receivingCenter, emoji: '⛵' };
    const dStr = formatDateShort(parseDateT00(date));

    // 1. Ejecutar transferencia atómica de salidas (Section 3 / 3.1)
    await executeSpotTransferSalidas(date, givingSalidaId, givingCenter, receivingCenter, spots, (req.note || '').trim());

    // 2. Eliminar la solicitud de Firestore
    await db.collection(BDF_COLLECTIONS.REQUESTS).doc(requestId).delete();

    // 3. Notificar por WhatsApp de fondo (si no es admin)
    if (currentUserKey !== 'admin') {
        const titleText = isDonation ? 'CESIÓN ACEPTADA' : 'PETICIÓN ACEPTADA';
        const msg = `🤖 *AVISO AUTOMÁTICO*\n✅ *${titleText}* - ${gInfo.emoji} ${gInfo.name} a ${rInfo.emoji} ${rInfo.name}\nPara el ${dStr}, ${gInfo.name} ha transferido ${isFull ? 'el barco completo' : `${spots} plazas`} en Bajo de Fuera a ${rInfo.name}.`;
        sendBdfWebhook(msg).catch(console.error);
    }

    // 4. Actualizar interfaz
    closeNotificationsModal();
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
        if (balanceTo.effectiveSlots + slots > MAX_BOAT_CAP) {
            throw new Error(`El centro receptor superaría el límite de ${MAX_BOAT_CAP} plazas por barco (${balanceTo.effectiveSlots} + ${slots} = ${balanceTo.effectiveSlots + slots}).`);
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
        if (balance.effectiveSlots + slots > MAX_BOAT_CAP) {
            throw new Error(`Superarías el tope de ${MAX_BOAT_CAP} plazas por barco. Tienes ${balance.effectiveSlots} plazas y pretendes coger ${slots} (${balance.effectiveSlots + slots} plazas).`);
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
              `⛵ *Total Barco:* ${newTotalSlots}/${MAX_BOAT_CAP} plazas`;

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
        const normCode = (s.centerCode === 'B' || s.centerCode === 'MD') ? 'MD' : s.centerCode;
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

    const normCode = (centerCode === 'B' || centerCode === 'MD') ? 'MD' : centerCode;
    const dayCap = getDayQuota(dateStr, monthDaysCache[dateStr]);
    const dayData = monthDaysCache[dateStr] || null;
    const summary = getDaySummary(dayData, dateStr);
    const remaining = Math.max(0, dayCap - summary.totalOccupied);
    if (pax > remaining) {
        throw new Error(`Cupo diario excedido: solo quedan ${remaining} plazas disponibles hoy (máximo ${dayCap} plazas/día).`);
    }

    // 1. Obtener lista actual de registros de plazas del día
    const currentSalidas = getDaySalidas(dayData, dateStr);
    const existing = currentSalidas.find(s => s.centerCode === normCode);

    if (existing) {
        // Principio aditivo: se suman al total de la escuela
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

    // 2. Actualización optimista inmediata en memoria (0ms)
    if (!monthDaysCache[dateStr]) {
        monthDaysCache[dateStr] = {
            id: dateStr,
            date: dateStr,
            totalQuota: dayCap,
            salidas: currentSalidas,
            allocations: syncAllocationsFromSalidas(currentSalidas)
        };
    } else {
        monthDaysCache[dateStr].salidas = currentSalidas;
        monthDaysCache[dateStr].allocations = syncAllocationsFromSalidas(currentSalidas);
    }
    renderAll();

    // 3. Guardado en Firestore en segundo plano
    const docRef = db.collection(BDF_COLLECTIONS.DAYS).doc(dateStr);
    docRef.set({
        date: dateStr,
        totalQuota: dayCap,
        salidas: currentSalidas,
        allocations: syncAllocationsFromSalidas(currentSalidas),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true }).catch(err => {
        console.error("Error guardando salida en Firestore:", err);
        showToast('Error', 'No se pudo guardar la salida en la nube.', true);
    });

    // 4. Auditoría en segundo plano (solo para centros, nunca para admin)
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

    const dayCap = getDayQuota(dateStr, monthDaysCache[dateStr]);
    const dayData = monthDaysCache[dateStr] || null;
    const currentSalidas = getDaySalidas(dayData, dateStr);
    const targetIdx = currentSalidas.findIndex(s => s.id === salidaId);
    
    // Si no la encuentra por ID, busca por centerCode como respaldo
    const salidaIndex = targetIdx !== -1 ? targetIdx : currentSalidas.findIndex(s => s.centerCode === newCenterCode);
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
    const targetCenter = newCenterCode || oldCenter;
    const normCenter = (targetCenter === 'B' || targetCenter === 'MD') ? 'MD' : targetCenter;

    // Actualizar registro con plazas y pax sincronizados
    currentSalidas[salidaIndex] = {
        ...currentSalida,
        centerCode: normCenter,
        plazas: newPax,
        pax: newPax,
        note: (newNote !== undefined ? newNote : currentSalida.note || '').trim(),
        updatedAt: new Date().toISOString()
    };

    // 1. Actualización optimista inmediata en memoria (0ms)
    monthDaysCache[dateStr].salidas = currentSalidas;
    monthDaysCache[dateStr].allocations = syncAllocationsFromSalidas(currentSalidas);
    renderAll();

    // 2. Guardado no bloqueante en Firestore
    const docRef = db.collection(BDF_COLLECTIONS.DAYS).doc(dateStr);
    docRef.set({
        date: dateStr,
        totalQuota: dayCap,
        salidas: currentSalidas,
        allocations: syncAllocationsFromSalidas(currentSalidas),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true }).catch(err => {
        console.error("Error editando plazas:", err);
        showToast('Error', 'No se pudo guardar la modificación.', true);
    });

    // 3. Auditoría en segundo plano (solo para centros, nunca para admin)
    if (currentUserKey !== 'admin') {
        logBdfHistory('edit_salida', {
            date: dateStr,
            center: normCenter,
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
    const dayData = monthDaysCache[dateStr] || null;
    let currentSalidas = getDaySalidas(dayData, dateStr);

    if (salidaId) {
        currentSalidas = currentSalidas.filter(s => s.id !== salidaId);
    } else if (centerCode) {
        const norm = (centerCode === 'B' || centerCode === 'MD') ? 'MD' : centerCode;
        currentSalidas = currentSalidas.filter(s => s.centerCode !== norm);
    }

    // 1. Actualización optimista inmediata
    if (!monthDaysCache[dateStr]) monthDaysCache[dateStr] = { id: dateStr, date: dateStr };
    monthDaysCache[dateStr].salidas = currentSalidas;
    monthDaysCache[dateStr].allocations = syncAllocationsFromSalidas(currentSalidas);
    renderAll();

    // 2. Eliminación en Firestore en segundo plano
    const docRef = db.collection(BDF_COLLECTIONS.DAYS).doc(dateStr);
    docRef.set({
        date: dateStr,
        salidas: currentSalidas,
        allocations: syncAllocationsFromSalidas(currentSalidas),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true }).catch(err => {
        console.error("Error eliminando plazas:", err);
        showToast('Error', 'No se pudo eliminar de la nube.', true);
    });

    // 3. Auditoría en segundo plano (solo para centros, nunca para admin)
    if (currentUserKey !== 'admin') {
        logBdfHistory('delete_salida', {
            date: dateStr,
            center: centerCode
        }).catch(console.error);
    }
}

/**
 * Mueve plazas de una escuela a otro día (Scenario 4A / 4B Opción 1).
 * Si es un movimiento parcial (split), reduce las plazas en el día origen y las añade
 * al total de la escuela en el día destino (principio aditivo de Section 0).
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

    const normCode = (centerCode === 'B' || centerCode === 'MD') ? 'MD' : centerCode;

    // 1. Manejo del día de origen: reducir o eliminar
    const sourceSalidas = getDaySalidas(monthDaysCache[sourceDate], sourceDate);
    const sIndex = sourceSalidas.findIndex(s => s.id === salidaId || s.centerCode === normCode);
    if (sIndex !== -1) {
        const sourceSalida = sourceSalidas[sIndex];
        const currentP = Number(sourceSalida.plazas !== undefined ? sourceSalida.plazas : sourceSalida.pax) || 0;
        if (currentP > paxToMove) {
            // Split: mantener las plazas sobrantes en el día de origen
            sourceSalida.plazas = currentP - paxToMove;
            sourceSalida.pax = sourceSalida.plazas;
            sourceSalida.updatedAt = new Date().toISOString();
        } else {
            // Se mueven todas las plazas: eliminar la escuela del día de origen
            sourceSalidas.splice(sIndex, 1);
        }
    }

    // 2. Manejo del día de destino: principio aditivo (sumar al total existente o crear registro)
    const targetCap = getDayQuota(targetDate, monthDaysCache[targetDate]);
    const targetSalidas = getDaySalidas(monthDaysCache[targetDate], targetDate);
    const existTarget = targetSalidas.find(s => s.centerCode === normCode);
    if (existTarget) {
        existTarget.plazas = (Number(existTarget.plazas !== undefined ? existTarget.plazas : existTarget.pax) || 0) + paxToMove;
        existTarget.pax = existTarget.plazas;
        existTarget.updatedAt = new Date().toISOString();
    } else {
        targetSalidas.push({
            id: `plazas_${targetDate}_${normCode}`,
            date: targetDate,
            centerCode: normCode,
            plazas: paxToMove,
            pax: paxToMove,
            note: (sourceSalida.note || '').trim(),
            updatedAt: new Date().toISOString()
        });
    }

    const sourceCap = getDayQuota(sourceDate, monthDaysCache[sourceDate]);

    // 3. Actualización optimista en memoria (0ms)
    if (!monthDaysCache[sourceDate]) monthDaysCache[sourceDate] = { id: sourceDate, date: sourceDate, totalQuota: sourceCap };
    monthDaysCache[sourceDate].salidas = sourceSalidas;
    monthDaysCache[sourceDate].allocations = syncAllocationsFromSalidas(sourceSalidas);

    if (!monthDaysCache[targetDate]) monthDaysCache[targetDate] = { id: targetDate, date: targetDate, totalQuota: targetCap };
    monthDaysCache[targetDate].salidas = targetSalidas;
    monthDaysCache[targetDate].allocations = syncAllocationsFromSalidas(targetSalidas);

    renderAll();

    // 4. Guardado atómico en Firestore
    const batch = db.batch();
    const sourceRef = db.collection(BDF_COLLECTIONS.DAYS).doc(sourceDate);
    const targetRef = db.collection(BDF_COLLECTIONS.DAYS).doc(targetDate);

    batch.set(sourceRef, {
        date: sourceDate,
        totalQuota: sourceCap,
        salidas: sourceSalidas,
        allocations: syncAllocationsFromSalidas(sourceSalidas),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    batch.set(targetRef, {
        date: targetDate,
        totalQuota: targetCap,
        salidas: targetSalidas,
        allocations: syncAllocationsFromSalidas(targetSalidas),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    batch.commit().catch(err => {
        console.error("Error guardando movimiento de salida en Firestore:", err);
        showToast('Error', 'No se pudo mover la salida en la nube.', true);
    });

    // 5. Auditoría en segundo plano (solo para centros)
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
 */
async function executeSwapSalidas(dateA, salidaIdA, centerA, safePaxA, retainedPaxA, dateB, salidaIdB, centerB, safePaxB, retainedPaxB) {
    safePaxA = parseInt(safePaxA, 10) || 0;
    safePaxB = parseInt(safePaxB, 10) || 0;
    retainedPaxA = parseInt(retainedPaxA, 10) || 0;
    retainedPaxB = parseInt(retainedPaxB, 10) || 0;

    const normA = (centerA === 'B' || centerA === 'MD') ? 'MD' : centerA;
    const normB = (centerB === 'B' || centerB === 'MD') ? 'MD' : centerB;

    const salidasA = getDaySalidas(monthDaysCache[dateA], dateA);
    const salidasB = getDaySalidas(monthDaysCache[dateB], dateB);

    // 1. Ajustar Escuela A en Día A
    const idxA = salidasA.findIndex(s => s.centerCode === normA || s.id === salidaIdA);
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
        const existBInA = salidasA.find(s => s.centerCode === normB);
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
    const idxB = salidasB.findIndex(s => s.centerCode === normB || s.id === salidaIdB);
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
        const existAInB = salidasB.find(s => s.centerCode === normA);
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

    const dayCapA = getDayQuota(dateA, monthDaysCache[dateA]);
    const dayCapB = getDayQuota(dateB, monthDaysCache[dateB]);

    // 3. Actualización optimista en memoria (0ms)
    if (!monthDaysCache[dateA]) monthDaysCache[dateA] = { id: dateA, date: dateA, totalQuota: dayCapA };
    monthDaysCache[dateA].salidas = salidasA;
    monthDaysCache[dateA].allocations = syncAllocationsFromSalidas(salidasA);

    if (!monthDaysCache[dateB]) monthDaysCache[dateB] = { id: dateB, date: dateB, totalQuota: dayCapB };
    monthDaysCache[dateB].salidas = salidasB;
    monthDaysCache[dateB].allocations = syncAllocationsFromSalidas(salidasB);

    renderAll();

    // 4. Escritura atómica en Firestore
    const batch = db.batch();
    const docRefA = db.collection(BDF_COLLECTIONS.DAYS).doc(dateA);
    const docRefB = db.collection(BDF_COLLECTIONS.DAYS).doc(dateB);

    batch.set(docRefA, {
        date: dateA,
        totalQuota: dayCapA,
        salidas: salidasA,
        allocations: syncAllocationsFromSalidas(salidasA),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    batch.set(docRefB, {
        date: dateB,
        totalQuota: dayCapB,
        salidas: salidasB,
        allocations: syncAllocationsFromSalidas(salidasB),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    batch.commit().catch(err => console.error("Error guardando intercambio en Firestore:", err));

    // 5. Auditoría (solo para centros, nunca para admin)
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

    const normFrom = (fromCenter === 'B' || fromCenter === 'MD') ? 'MD' : fromCenter;
    const normTo = (toCenter === 'B' || toCenter === 'MD') ? 'MD' : toCenter;

    const currentSalidas = getDaySalidas(monthDaysCache[dateStr], dateStr);
    const sIndex = currentSalidas.findIndex(s => s.centerCode === normFrom || s.id === givingSalidaId);
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
    const existTo = currentSalidas.find(s => s.centerCode === normTo);
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

    const dayCap = getDayQuota(dateStr, monthDaysCache[dateStr]);

    // 3. Actualización optimista en memoria (0ms)
    if (!monthDaysCache[dateStr]) monthDaysCache[dateStr] = { id: dateStr, date: dateStr, totalQuota: dayCap };
    monthDaysCache[dateStr].salidas = currentSalidas;
    monthDaysCache[dateStr].allocations = syncAllocationsFromSalidas(currentSalidas);
    renderAll();

    // 4. Guardado en Firestore en segundo plano
    const docRef = db.collection(BDF_COLLECTIONS.DAYS).doc(dateStr);
    docRef.set({
        date: dateStr,
        totalQuota: dayCap,
        salidas: currentSalidas,
        allocations: syncAllocationsFromSalidas(currentSalidas),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true }).catch(err => {
        console.error("Error guardando cesión de plazas en Firestore:", err);
        showToast('Error', 'No se pudo guardar la transferencia en la nube.', true);
    });

    // 5. Auditoría en segundo plano (solo para centros)
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
                    centerCode: (s.centerCode === 'B' || s.centerCode === 'MD') ? 'MD' : s.centerCode,
                    plazas: Number(s.plazas !== undefined ? s.plazas : s.pax) || 0,
                    pax: Number(s.plazas !== undefined ? s.plazas : s.pax) || 0,
                    note: s.note || '',
                    updatedAt: new Date().toISOString()
                }));
            } else if (finalAllocations) {
                finalSalidas = Object.keys(finalAllocations).map(code => {
                    const p = Number(finalAllocations[code].initialSlots || finalAllocations[code].slots || 10);
                    const normCode = (code === 'B' || code === 'MD') ? 'MD' : code;
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

