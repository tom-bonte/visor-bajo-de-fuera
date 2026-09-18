/**
 * @file app.js
 * @description Controlador principal de eventos, navegación mensual y operaciones para Visor Bajo de Fuera.
 * Incluye el popup de confirmación de WhatsApp antes de cualquier acción en la nube.
 */

/* =========================================================================
   1. INICIALIZACIÓN Y CONTROL DE AUTENTICACIÓN
   ========================================================================= */

auth.onAuthStateChanged((user) => {
    isGuestMode = !user;
    if (user) {
        currentUserKey = Object.keys(EMAIL_MAP).find(k => EMAIL_MAP[k] === user.email) || 'admin';
    } else {
        currentUserKey = 'guest';
    }

    hideEl('password-modal');
    hideEl('password-error');

    // Iniciar escucha del rango visible actual, del historial y de solicitudes pendientes
    refreshRangeListener();
    listenHistoryLogs();
    listenBdfRequests();

    renderAll();
});

function verifyLogin() {
    const userKey = getEl('login-user').value;
    const password = getEl('login-password').value;
    const email = EMAIL_MAP[userKey];

    if (!email || !password) {
        showEl('password-error');
        return;
    }

    auth.signInWithEmailAndPassword(email, password)
        .then(() => {
            hideEl('password-modal');
            hideEl('password-error');
            getEl('login-password').value = '';
            showToast('Sesión Iniciada', `Has accedido como ${BADGE_INFO[userKey]?.name || userKey}`);
        })
        .catch((error) => {
            console.error("Error de autenticación:", error);
            showEl('password-error');
        });
}

function logout() {
    auth.signOut().then(() => {
        showToast('Sesión Cerrada', 'Has vuelto al modo de consulta.');
    });
}

function togglePassword() {
    const input = getEl('login-password');
    const eye = getEl('eye-icon');
    if (!input) return;
    if (input.type === 'password') {
        input.type = 'text';
    } else {
        input.type = 'password';
    }
}

function openLoginModal() {
    getEl('login-password').value = '';
    hideEl('password-error');
    showEl('password-modal');
    setTimeout(() => getEl('login-password')?.focus(), 100);
}

function toggleUserMenu(e) {
    if (e && e.stopPropagation) e.stopPropagation();
    toggleVis('user-dropdown');
}

function openHelpModal() {
    showEl('help-modal');
}

/* =========================================================================
   2. CONTROL DE VISTAS Y MESES
   ========================================================================= */

/**
 * Calcula el rango de fechas visible en el calendario según la vista activa.
 * @returns {{ startStr: string, endStr: string }}
 */
function getVisibleDateRange() {
    const firstDay = new Date(currentYear, currentMonth, 1);
    let startDow = firstDay.getDay() - 1;
    if (startDow === -1) startDow = 6;
    const firstVis = new Date(currentYear, currentMonth, 1 - startDow);
    const lastDay = new Date(currentYear, currentMonth + 1, 0);
    const total = startDow + lastDay.getDate();
    const rem = (7 - (total % 7)) % 7;
    const lastVis = new Date(currentYear, currentMonth, lastDay.getDate() + rem);
    return { startStr: getStrYMD(firstVis), endStr: getStrYMD(lastVis) };
}

/**
 * Actualiza la suscripción de Firestore para cubrir todo el rango visible de fechas.
 */
function refreshRangeListener() {
    const { startStr, endStr } = getVisibleDateRange();
    listenMonthOverview(startStr, endStr);
}

function switchView(mode) {
    activeViewMode = mode;
    refreshRangeListener();
    renderAll();
}

function toggleYearMonths(year = 2026) {
    expandedYears[year] = !expandedYears[year];
    renderLeftNavigation();
}

function selectMonth(m, y = 2026) {
    currentMonth = m;
    currentYear = y;
    currentDate = new Date(currentYear, currentMonth, 1);
    if (activeViewMode === 'historial') {
        activeViewMode = 'mensual';
    }
    refreshRangeListener();
    renderAll();
}

function changeMonth(delta) {
    currentMonth += delta;
    if (currentMonth < 0) {
        currentMonth = 11;
        currentYear -= 1;
    } else if (currentMonth > 11) {
        currentMonth = 0;
        currentYear += 1;
    }

    currentDate = new Date(currentYear, currentMonth, 1);
    refreshRangeListener();
    renderAll();
}

function goToCurrentMonth() {
    const now = new Date();
    currentYear = 2026;
    currentMonth = (now.getFullYear() === 2026) ? now.getMonth() : 8; // Septiembre por defecto si el reloj no está en 2026
    currentDate = new Date(currentYear, currentMonth, (now.getFullYear() === 2026) ? now.getDate() : 14);
    activeViewMode = 'mensual'; // Salir automáticamente de estadísticas o historial y mostrar el mes actual
    expandedYears[2026] = true;
    refreshRangeListener();
    renderAll();
}

/* =========================================================================
   3. FILTROS DE CENTROS (ESTILO SHEET CON CHECKBOXES)
   ========================================================================= */

function toggleFilterDropdown(e) {
    if (e && e.stopPropagation) e.stopPropagation();
    toggleVis('filter-dropdown-panel');
}

function toggleCenterFilter(code) {
    if (activeCenterFilters.has(code)) {
        activeCenterFilters.delete(code);
    } else {
        activeCenterFilters.add(code);
    }
    renderAll();
}

function setAllFilters(enableAll) {
    if (enableAll) {
        activeCenterFilters = new Set(Object.keys(CENTERS));
    } else {
        activeCenterFilters.clear();
    }
    renderAll();
}

function onHistoryFilterChange(val) {
    historyCenterFilter = val;
    renderHistoryView();
}

/* =========================================================================
   4. POPUP CONFIRMAR WHATSAPP (AVISO AUTOMÁTICO)
   ========================================================================= */

let pendingWhatsAppCallback = null;

/**
 * Muestra el popup exacto de confirmación de WhatsApp antes de realizar cualquier acción.
 * @param {string} actionType - 'Nueva Salida' | 'Cesión de Plazas' | 'Liberación al Pool' | 'Plazas del Pool' | 'Petición'
 * @param {string} msg - Texto que se enviaría por WhatsApp
 * @param {Function} callback - Acción a ejecutar si el usuario pulsa Confirmar
 */
function triggerWhatsAppConfirm(actionType, msg, callback) {
    pendingWhatsAppCallback = callback;
    getEl('wa-action-type').textContent = actionType;
    getEl('confirm-whatsapp-msg').innerText = msg;
    showEl('whatsapp-confirm-modal');
}

function cancelWhatsAppAction() {
    hideEl('whatsapp-confirm-modal');
    pendingWhatsAppCallback = null;
}

async function confirmWhatsAppAction() {
    if (!pendingWhatsAppCallback) return;
    const cb = pendingWhatsAppCallback;
    hideEl('whatsapp-confirm-modal');
    pendingWhatsAppCallback = null;

    try {
        await cb();
    } catch (e) {
        console.error("Error al ejecutar acción:", e);
        showNotification('Error', e.message, true);
    }
}

/* =========================================================================
   5. AÑADIR SALIDA (ESTILO VISOR RESERVA)
   ========================================================================= */

let pendingNewSalida = null;

function openNewSalidaModal(dateStr, targetCenterCode = null) {
    if (isGuestMode) {
        openLoginModal();
        return;
    }

    const myCenterKey = currentUserKey;
    const targetCenter = targetCenterCode || USER_CENTER_KEYS[myCenterKey] || 'M';
    const dayData = monthDaysCache[dateStr] || null;
    const summary = getDaySummary(dayData, dateStr);
    const dayCap = getDayQuota(dateStr, dayData);
    const remainingCapacity = Math.max(0, dayCap - summary.totalOccupied);

    if (remainingCapacity <= 0) {
        showNotification('Cupo Lleno', `No quedan plazas disponibles para este día.\nCupo máximo diario alcanzado: ${dayCap} pl.`, true);
        return;
    }

    const dObj = parseDateT00(dateStr);
    const allowedMax = Math.min(MAX_BOAT_CAP, remainingCapacity);
    pendingNewSalida = { date: dateStr, targetCenterCode: targetCenter, remainingCapacity, dayCap };

    getEl('new-salida-title').textContent = `Bajo de Fuera · ${formatDateShort(dObj)}`;
    getEl('new-salida-avail').textContent = `Plazas disponibles: ${remainingCapacity}`;

    const paxInput = getEl('new-salida-pax');
    paxInput.value = Math.min(10, allowedMax);
    paxInput.max = allowedMax;

    const isAdmin = currentUserKey === 'admin';
    const centerSelector = getEl('new-salida-center-container');
    const paxContainer = getEl('new-salida-pax-container');
    const submitBtn = getEl('btn-confirm-new-salida');

    if (centerSelector) {
        centerSelector.classList.toggle('hidden', !isAdmin);
        if (paxContainer) {
            paxContainer.className = isAdmin ? "mb-4" : "mb-6";
        }
    }

    if (submitBtn) {
        if (isAdmin) {
            submitBtn.innerHTML = `Guardar <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"></path></svg>`;
        } else {
            submitBtn.innerHTML = `Siguiente <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3"></path></svg>`;
        }
    }

    showEl('new-salida-modal');
    setTimeout(() => {
        paxInput.focus();
        paxInput.select();
    }, 50);
}

function cancelNewSalida() {
    hideEl('new-salida-modal');
    pendingNewSalida = null;
}

function confirmNewSalida() {
    if (!pendingNewSalida) return;
    const { date, remainingCapacity, dayCap } = pendingNewSalida;
    const pax = parseInt(getEl('new-salida-pax').value, 10);
    if (!pax || isNaN(pax) || pax <= 0) {
        showToast('Error', 'Introduce un número válido de plazas.', true);
        return;
    }
    if (pax > MAX_BOAT_CAP) {
        showToast('Límite excedido', `El máximo permitido es de ${MAX_BOAT_CAP} plazas por barco.`, true);
        return;
    }

    // Verificar cupo restante en tiempo real
    const dayData = monthDaysCache[date] || null;
    const summary = getDaySummary(dayData, date);
    const maxDayCap = getDayQuota(date, dayData);
    const currentRemaining = Math.max(0, maxDayCap - summary.totalOccupied);

    if (currentRemaining <= 0) {
        showNotification('Cupo Lleno', `El cupo diario de ${maxDayCap} plazas ya está completo para este día.`, true);
        return;
    }

    if (pax > currentRemaining) {
        showNotification('Plazas Insuficientes', `Solo quedan ${currentRemaining} plazas disponibles hoy (máximo ${maxDayCap} plazas/día).\nNo es posible asignar ${pax} plazas.`, true);
        return;
    }

    hideEl('new-salida-modal');

    const targetCenterKey = currentUserKey === 'admin' ? getEl('new-salida-center').value : currentUserKey;
    const centerCode = USER_CENTER_KEYS[targetCenterKey] || 'M';
    const centerInfo = CENTERS[centerCode] || { name: targetCenterKey, emoji: '⛵' };
    const dObj = parseDateT00(date);

    // Para el Administrador: NO pedir confirmación y NO enviar a WhatsApp
    if (currentUserKey === 'admin') {
        executeAddSalida(date, centerCode, pax)
            .then(() => {
                showToast('Salida añadida', `Añadidas ${pax} plazas para ${centerInfo.name}.`);
            })
            .catch(err => {
                showNotification('Error', err.message, true);
                renderAll();
            });
        return;
    }

    const msg = `🤖 *AVISO AUTOMÁTICO*\n➕ *NUEVA SALIDA* - ${centerInfo.emoji} ${centerInfo.name}\nPara el ${dObj.getDate()} de ${MONTHS_ES[dObj.getMonth()].toUpperCase()}, añadió una salida a *Bajo de Fuera* de ${pax} plazas.`;

    triggerWhatsAppConfirm("Nueva Salida", msg, async () => {
        try {
            await executeAddSalida(date, centerCode, pax);
            sendBdfWebhook(msg).catch(console.error);
            showToast('Salida añadida', `Añadidas ${pax} plazas para ${centerInfo.name}.`);
        } catch (err) {
            console.error("Error añadiendo salida:", err);
            showNotification('Error', err.message, true);
            renderAll();
        }
    });
}

/* =========================================================================
   6. DOBLE CLIC EN DÍA / SALIDA (Add, Edit, Delete, Pedir)
   ========================================================================= */

let pendingEditSalida = null;
let pendingDonationRequest = null;
let pendingSwap = null;
let draggedBoat = null;

/**
 * Doble clic en un día vacío (o fuera de una salida): abre el wizard para añadir salida.
 * @param {string} dateStr - 'YYYY-MM-DD'
 */
function handleDayDoubleClick(dateStr) {
    openNewSalidaModal(dateStr);
}

/**
 * Clic simple sobre una salida:
 * Si la salida está bloqueada con reloj de arena (⏳), abre inmediatamente el modal de gestión / retirada
 * para que funcione al instante con un solo clic o con doble clic sin problemas de latencia o selección táctil.
 */
function handleBoatClick(e, dateStr, salidaId, centerCode) {
    const reqId = e?.currentTarget?.dataset?.pendingRequestId || e?.target?.closest?.('[data-pending-request-id]')?.dataset?.pendingRequestId;
    const normCode = normCenter(centerCode);
    const pendingReq = reqId ? bdfRequests.find(r => r.id === reqId && r.status === 'pending') : getPendingRequestForSalida(salidaId, dateStr, normCode);

    if (pendingReq) {
        if (e && e.stopPropagation) e.stopPropagation();
        openPendingRequestActionModal(pendingReq, dateStr, normCode);
    }
}

/**
 * Doble clic en una salida existente:
 * - Si está bloqueada por solicitud/intercambio: abre modal para gestionar, retirar o responder según el rol.
 * - Si es propia o Administrador: abrir modal para modificar plazas, ceder o eliminar.
 * - Si es de otra escuela: abrir modal para pedir plazas (solicitud).
 * @param {Event} e
 * @param {string} dateStr - 'YYYY-MM-DD'
 * @param {string} salidaId - ID único de la salida
 * @param {string} centerCode - 'MD', 'M', etc.
 */
function handleBoatDoubleClick(e, dateStr, salidaId, centerCode) {
    if (e && e.stopPropagation) e.stopPropagation(); // Evita que se dispare el doble clic del día
    if (isGuestMode) {
        openLoginModal();
        return;
    }

    const normCode = normCenter(centerCode);
    const myCenterCode = USER_CENTER_KEYS[currentUserKey] || null;
    const isOwnOrAdmin = currentUserKey === 'admin' || normCode === myCenterCode;

    // 1. Comprobar bloqueo por solicitud pendiente (Section 2A / 3A)
    // Primero por data-pending-request-id directo del elemento, y luego por salidaId / fecha / centro
    const reqId = e?.currentTarget?.dataset?.pendingRequestId || e?.target?.closest?.('[data-pending-request-id]')?.dataset?.pendingRequestId;
    let pendingReq = reqId ? bdfRequests.find(r => r.id === reqId && r.status === 'pending') : null;
    if (!pendingReq) {
        pendingReq = getPendingRequestForSalida(salidaId, dateStr, normCode);
    }

    if (pendingReq) {
        console.log('[BDF] Salida bloqueada seleccionada:', pendingReq);
        openPendingRequestActionModal(pendingReq, dateStr, normCode);
        return;
    }

    if (isOwnOrAdmin) {
        openEditSalidaModal(dateStr, salidaId, normCode);
    } else {
        promptDonationRequest(dateStr, salidaId, normCode);
    }
}

/**
 * Abre el modal interactivo para gestionar, retirar, aceptar o denegar una solicitud pendiente
 * al hacer doble clic sobre cualquier salida bloqueada con reloj de arena (⏳).
 * @param {Object} pendingReq
 * @param {string} dateStr
 * @param {string} centerCode
 */
function openPendingRequestActionModal(pendingReq, dateStr, centerCode) {
    const myCenterCode = USER_CENTER_KEYS[currentUserKey] || null;
    const isAdmin = currentUserKey === 'admin';
    const isInitiator = !isAdmin && normCenter(pendingReq.initiatorCenter) === normCenter(myCenterCode);
    const isTarget = !isAdmin && normCenter(pendingReq.targetCenter) === normCenter(myCenterCode);

    const initInfo = CENTERS[pendingReq.initiatorCenter] || { name: pendingReq.initiatorCenter || 'Centro' };
    const targetInfo = CENTERS[pendingReq.targetCenter] || { name: pendingReq.targetCenter || 'Centro' };

    const modalTitle = getEl('pending-modal-title');
    const modalSubtitle = getEl('pending-modal-subtitle');
    const modalContent = getEl('pending-modal-content');
    const modalActions = getEl('pending-modal-actions');

    let typeText = 'Solicitud Pendiente';
    let detailsHtml = '';

    if (pendingReq.type === 'swap') {
        typeText = 'Propuesta de Intercambio';
        const cA = CENTERS[pendingReq.centerA] || { name: pendingReq.centerA };
        const cB = CENTERS[pendingReq.centerB] || { name: pendingReq.centerB };
        const paxA = pendingReq.paxA !== undefined ? pendingReq.paxA : (pendingReq.salidaA?.pax || '?');
        const paxB = pendingReq.paxB !== undefined ? pendingReq.paxB : (pendingReq.salidaB?.pax || '?');
        const dA = formatDateShort(parseDateT00(pendingReq.dateA));
        const dB = formatDateShort(parseDateT00(pendingReq.dateB));

        detailsHtml = `
            <div class="bg-amber-50/80 border border-amber-200/80 rounded-xl p-3.5 space-y-2 text-xs">
                <div class="font-bold text-amber-900 flex items-center justify-between">
                    <span>Propuesto por ${initInfo.name}</span>
                    <span class="text-[10px] px-1.5 py-0.5 rounded bg-amber-200/70 text-amber-800 uppercase font-black">Intercambio</span>
                </div>
                <div class="text-slate-700 leading-relaxed">
                    • <b>${cA.name}:</b> ${paxA} plazas el <b>${dA}</b><br>
                    <span class="text-amber-600 font-bold">↕️</span> <b>${cB.name}:</b> ${paxB} plazas el <b>${dB}</b>
                </div>
            </div>
            <p class="text-xs text-slate-500">
                ${isInitiator ? 'Has propuesto este intercambio. Puedes retirarlo en cualquier momento para liberar las plazas.' :
                isTarget ? `${initInfo.name} te ha enviado esta propuesta. Puedes aceptarla o rechazarla.` :
                    isAdmin ? 'Como Administrador, puedes retirar o anular esta solicitud para desbloquear las plazas.' :
                        'Esta salida está bloqueada mientras espera respuesta entre las escuelas involucradas.'}
            </p>
        `;
    } else if (pendingReq.type === 'request') {
        typeText = 'Petición de Plazas';
        const spots = pendingReq.isAll ? 'todas las plazas' : `${pendingReq.requestedPax || '?'} plazas`;
        const dFormatted = formatDateShort(parseDateT00(pendingReq.date));

        detailsHtml = `
            <div class="bg-blue-50/80 border border-blue-200/80 rounded-xl p-3.5 space-y-2 text-xs">
                <div class="font-bold text-blue-900 flex items-center justify-between">
                    <span>Petición de ${initInfo.name}</span>
                    <span class="text-[10px] px-1.5 py-0.5 rounded bg-blue-200/70 text-blue-800 uppercase font-black">Petición</span>
                </div>
                <div class="text-slate-700 leading-relaxed">
                    <b>${initInfo.name}</b> ha solicitado <b>${spots}</b> a <b>${targetInfo.name}</b> para el <b>${dFormatted}</b>.
                </div>
            </div>
            <p class="text-xs text-slate-500">
                ${isInitiator ? 'Has realizado esta petición. Puedes retirarla en cualquier momento para liberar la salida.' :
                isTarget ? `${initInfo.name} te pide plazas. Puedes cederlas aceptando la petición o denegarla.` :
                    isAdmin ? 'Como Administrador, puedes retirar esta solicitud para desbloquear la salida.' :
                        'Esta salida está bloqueada por una petición pendiente.'}
            </p>
        `;
    } else {
        typeText = 'Cesión de Plazas';
        const spots = pendingReq.isFull ? 'el barco completo' : `${pendingReq.requestedPax || pendingReq.pax || '?'} plazas`;
        const dFormatted = formatDateShort(parseDateT00(pendingReq.date));

        detailsHtml = `
            <div class="bg-emerald-50/80 border border-emerald-200/80 rounded-xl p-3.5 space-y-2 text-xs">
                <div class="font-bold text-emerald-900 flex items-center justify-between">
                    <span>Cesión de ${initInfo.name}</span>
                    <span class="text-[10px] px-1.5 py-0.5 rounded bg-emerald-200/70 text-emerald-800 uppercase font-black">Cesión</span>
                </div>
                <div class="text-slate-700 leading-relaxed">
                    <b>${initInfo.name}</b> ofrece ceder <b>${spots}</b> a <b>${targetInfo.name}</b> para el <b>${dFormatted}</b>.
                </div>
            </div>
            <p class="text-xs text-slate-500">
                ${isInitiator ? 'Ofreciste ceder estas plazas. Puedes retirar la oferta.' :
                isTarget ? 'Puedes aceptar o rechazar las plazas ofrecidas.' :
                    isAdmin ? 'Como Administrador, puedes retirar esta solicitud.' :
                        'Salida en proceso de cesión.'}
            </p>
        `;
    }

    if (modalTitle) modalTitle.textContent = typeText;
    if (modalSubtitle) modalSubtitle.textContent = `Bajo de Fuera · ${formatDateShort(parseDateT00(dateStr))}`;
    if (modalContent) modalContent.innerHTML = detailsHtml;

    let actionsHtml = '';
    if (isAdmin) {
        actionsHtml = `
            <button onclick="hideEl('pending-request-action-modal')" class="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer">
                Cerrar
            </button>
            <button onclick="cancelBdfRequest('${pendingReq.id}')" class="px-4 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors shadow-sm cursor-pointer flex items-center gap-1.5">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                Retirar Solicitud (Admin)
            </button>
        `;
    } else if (isInitiator) {
        actionsHtml = `
            <button onclick="hideEl('pending-request-action-modal')" class="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer">
                Cerrar
            </button>
            <button onclick="cancelBdfRequest('${pendingReq.id}')" class="px-4 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors shadow-sm cursor-pointer flex items-center gap-1.5">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                Retirar Petición
            </button>
        `;
    } else if (isTarget) {
        actionsHtml = `
            <button onclick="rejectBdfRequest('${pendingReq.id}')" class="px-3.5 py-2 text-xs font-bold text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors cursor-pointer">
                Denegar
            </button>
            <button onclick="acceptBdfRequest('${pendingReq.id}')" class="px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors shadow-sm cursor-pointer flex items-center gap-1.5">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
                Aceptar
            </button>
        `;
    } else {
        actionsHtml = `
            <button onclick="hideEl('pending-request-action-modal')" class="w-full px-4 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer">
                Entendido
            </button>
        `;
    }

    if (modalActions) modalActions.innerHTML = actionsHtml;
    showEl('pending-request-action-modal');
}

/**
 * Abre el modal para editar plazas, reasignar, ceder o eliminar una salida existente (Section 2).
 */
function openEditSalidaModal(dateStr, salidaId, centerCode) {
    const dayData = monthDaysCache[dateStr] || null;
    const daySalidas = getDaySalidas(dayData, dateStr);
    const targetSalida = daySalidas.find(s => s.id === salidaId || s.centerCode === centerCode) || { id: salidaId, pax: 10, note: '' };
    const currentPax = targetSalida.pax;
    const centerInfo = CENTERS[centerCode] || { name: centerCode, color: 'bg-slate-700', text: 'text-white' };
    const dObj = parseDateT00(dateStr);

    const summary = getDaySummary(dayData, dateStr);
    const dayCap = getDayQuota(dateStr, dayData);
    const freeSpots = Math.max(0, dayCap - summary.totalOccupied);
    const availableForThisBoat = currentPax + freeSpots;
    const allowedMax = Math.min(MAX_BOAT_CAP, availableForThisBoat);

    pendingEditSalida = {
        dateStr,
        salidaId: targetSalida.id || salidaId,
        centerCode,
        currentPax,
        allowedMax,
        dayCap,
        itemNote: targetSalida.note || ''
    };

    getEl('edit-salida-title').textContent = `${centerInfo.name} · ${formatDateShort(dObj)}`;
    getEl('edit-salida-avail').textContent = `Plazas asignadas: ${currentPax} | Plazas libres hoy: ${freeSpots} (Máximo posible: ${allowedMax})`;

    const paxInput = getEl('edit-salida-pax');
    paxInput.value = currentPax;
    paxInput.max = allowedMax;

    const noteInput = getEl('edit-salida-note');
    if (noteInput) noteInput.value = pendingEditSalida.itemNote;

    const centerSelector = getEl('edit-salida-center-container');
    if (centerSelector) {
        const isAdmin = currentUserKey === 'admin';
        centerSelector.classList.toggle('hidden', !isAdmin);
        if (isAdmin) {
            getEl('edit-salida-center').value = normCenter(centerCode);
        }
    }

    const btnSave = getEl('btn-save-edit-salida');
    if (btnSave) {
        btnSave.textContent = currentUserKey === 'admin' ? "Guardar Cambios" : "Siguiente";
    }

    const btnSwap = getEl('btn-open-proponer-intercambio');
    if (btnSwap) {
        btnSwap.classList.toggle('hidden', currentUserKey === 'admin');
    }

    showEl('edit-salida-modal');
    setTimeout(() => {
        paxInput.focus();
        paxInput.select();
    }, 50);
}

function cancelEditSalida() {
    hideEl('edit-salida-modal');
    pendingEditSalida = null;
}

function confirmEditSalida() {
    if (!pendingEditSalida) return;
    const pax = parseInt(getEl('edit-salida-pax').value, 10);
    if (!pax || isNaN(pax) || pax <= 0) {
        showNotification('Error', 'Introduce un número válido de plazas.', true);
        return;
    }
    if (pax > MAX_BOAT_CAP) {
        showNotification('Límite excedido', `El máximo permitido es de ${MAX_BOAT_CAP} plazas por barco.`, true);
        return;
    }

    const { dateStr, salidaId, centerCode, currentPax } = pendingEditSalida;
    const dayData = monthDaysCache[dateStr] || null;
    const summary = getDaySummary(dayData, dateStr);
    const maxDayCap = getDayQuota(dateStr, dayData);
    const freeSpots = Math.max(0, maxDayCap - summary.totalOccupied);
    const availableForThisBoat = currentPax + freeSpots;

    // Opción 2: Aumento de plazas validado contra cupo libre
    if (pax > availableForThisBoat) {
        showNotification('Cupo Excedido', `Solo hay espacio para un máximo de ${availableForThisBoat} plazas hoy (cupo diario: ${maxDayCap}).`, true);
        return;
    }

    const note = getEl('edit-salida-note')?.value || '';
    const newCenterCode = currentUserKey === 'admin' ? getEl('edit-salida-center').value : pendingEditSalida.centerCode;
    const centerInfo = CENTERS[newCenterCode] || { name: newCenterCode, emoji: '⛵' };
    const dObj = parseDateT00(dateStr);

    hideEl('edit-salida-modal');

    // Modo Administrador: sin confirmación ni WhatsApp
    if (currentUserKey === 'admin') {
        executeEditSalida(dateStr, salidaId, pax, newCenterCode, note)
            .then(() => {
                pendingEditSalida = null;
                showToast('Salida Modificada', 'Los cambios se han guardado.');
            })
            .catch(err => {
                showNotification('Error', err.message, true);
                pendingEditSalida = null;
                renderAll();
            });
        return;
    }

    const actionWord = pax > currentPax ? 'aumentó' : 'redujo';
    const msg = `🤖 *AVISO AUTOMÁTICO*\n✏️ *MODIFICACIÓN DE SALIDA* - ${centerInfo.emoji} ${centerInfo.name}\nPara el ${dObj.getDate()} de ${MONTHS_ES[dObj.getMonth()].toUpperCase()}, ${actionWord} su salida en *Bajo de Fuera* de ${currentPax} a ${pax} plazas.`;

    triggerWhatsAppConfirm("Modificar Salida", msg, async () => {
        try {
            await executeEditSalida(dateStr, salidaId, pax, newCenterCode, note);
            sendBdfWebhook(msg).catch(console.error);
            pendingEditSalida = null;
            showToast('Salida Modificada', 'Los cambios se han guardado.');
        } catch (err) {
            console.error("Error modificando salida:", err);
            showNotification('Error', err.message, true);
            pendingEditSalida = null;
            renderAll();
        }
    });
}

function promptDeleteSalida() {
    if (!pendingEditSalida) return;
    const cName = CENTERS[pendingEditSalida.centerCode]?.name || pendingEditSalida.centerCode;
    const dStr = formatDateShort(parseDateT00(pendingEditSalida.dateStr));
    getEl('delete-confirm-msg').textContent = `¿Seguro que deseas eliminar la salida de ${cName} (${pendingEditSalida.currentPax} pl.) para el ${dStr}? Se liberarán las plazas.`;

    hideEl('edit-salida-modal');
    showEl('delete-confirm-modal');
}

function cancelDeleteSalida() {
    hideEl('delete-confirm-modal');
    if (pendingEditSalida) {
        showEl('edit-salida-modal');
    }
}

function confirmDeleteSalida() {
    if (!pendingEditSalida) return;
    const { dateStr, salidaId, centerCode } = pendingEditSalida;
    const centerInfo = CENTERS[centerCode] || { name: centerCode, emoji: '⛵' };
    const dObj = parseDateT00(dateStr);

    hideEl('delete-confirm-modal');

    // Admin: ejecución directa
    if (currentUserKey === 'admin') {
        executeDeleteSalida(dateStr, salidaId, centerCode)
            .then(() => {
                pendingEditSalida = null;
                showToast('Salida Eliminada', 'Se han liberado las plazas.');
            })
            .catch(err => {
                showNotification('Error', err.message, true);
                pendingEditSalida = null;
                renderAll();
            });
        return;
    }

    const msg = `🤖 *AVISO AUTOMÁTICO*\n🗑️ *CANCELACIÓN DE SALIDA* - ${centerInfo.emoji} ${centerInfo.name}\nPara el ${dObj.getDate()} de ${MONTHS_ES[dObj.getMonth()].toUpperCase()}, canceló su salida de *Bajo de Fuera*, liberando las plazas.`;

    triggerWhatsAppConfirm("Eliminar Salida", msg, async () => {
        try {
            await executeDeleteSalida(dateStr, salidaId, centerCode);
            sendBdfWebhook(msg).catch(console.error);
            pendingEditSalida = null;
            showToast('Salida Eliminada', 'Se han liberado las plazas.');
        } catch (err) {
            console.error("Error eliminando salida:", err);
            showNotification('Error', err.message, true);
            pendingEditSalida = null;
            renderAll();
        }
    });
}

/* =========================================================================
   6B. CESIÓN DIRECTA DE PLAZAS (Section 3.1)
   ========================================================================= */

let pendingCesionDirecta = null;

function openCesionDirectaFromEdit() {
    if (!pendingEditSalida) return;
    const { dateStr, salidaId, centerCode, currentPax } = pendingEditSalida;
    hideEl('edit-salida-modal');
    openCesionDirectaModal(dateStr, salidaId, centerCode, currentPax);
}

function openCesionDirectaModal(dateStr, salidaId, fromCenterCode, currentPax) {
    pendingCesionDirecta = { dateStr, salidaId, fromCenterCode, currentPax };

    const cInfo = CENTERS[fromCenterCode] || { name: fromCenterCode };
    const dObj = parseDateT00(dateStr);

    getEl('cesion-directa-subtitle').textContent = `Bajo de Fuera · ${formatDateShort(dObj)}`;
    getEl('cesion-directa-info').textContent = `${cInfo.name} tiene ${currentPax} plazas asignadas en esta salida.`;

    // Rellenar selector de escuelas receptoras (las otras 7)
    const select = getEl('cesion-directa-target-center');
    if (select) {
        select.innerHTML = Object.keys(CENTERS)
            .filter(code => code !== fromCenterCode && code !== 'B')
            .map(code => `<option value="${code}">${CENTERS[code].name}</option>`)
            .join('');
    }

    const paxInput = getEl('cesion-directa-pax');
    paxInput.value = Math.min(2, currentPax);
    paxInput.max = currentPax;

    getEl('cesion-type-partial').checked = true;
    getEl('cesion-pax-container').classList.remove('hidden');
    getEl('cesion-directa-note').value = '';

    showEl('cesion-directa-modal');
}

function cancelCesionDirecta() {
    hideEl('cesion-directa-modal');
    pendingCesionDirecta = null;
}

function confirmCesionDirecta() {
    if (!pendingCesionDirecta) return;
    const { dateStr, salidaId, fromCenterCode, currentPax } = pendingCesionDirecta;
    const isFull = getEl('cesion-type-full').checked;
    const pax = parseInt(getEl('cesion-directa-pax').value, 10);

    if (!isFull && (!pax || isNaN(pax) || pax <= 0 || pax > currentPax)) {
        showNotification('Error', `Introduce entre 1 y ${currentPax} plazas, o selecciona "Barco completo".`, true);
        return;
    }

    const targetCenter = getEl('cesion-directa-target-center').value;
    const note = getEl('cesion-directa-note').value || '';
    const spotsToGive = isFull ? currentPax : pax;

    hideEl('cesion-directa-modal');

    const fromInfo = CENTERS[fromCenterCode] || { name: fromCenterCode, emoji: '⛵' };
    const targetInfo = CENTERS[targetCenter] || { name: targetCenter, emoji: '⛵' };
    const dObj = parseDateT00(dateStr);

    // 1-step direct transfer: no confirmation needed from the other dive center
    executeSpotTransferSalidas(dateStr, salidaId, fromCenterCode, targetCenter, spotsToGive, note)
        .then(() => {
            const msg = `🤖 *AVISO AUTOMÁTICO*\n🎁 *CESIÓN DIRECTA DE PLAZAS* - ${fromInfo.emoji} ${fromInfo.name} a ${targetInfo.emoji} ${targetInfo.name}\nPara el ${dObj.getDate()} de ${MONTHS_ES[dObj.getMonth()].toUpperCase()}, cedió ${isFull ? '*EL BARCO COMPLETO*' : `*${spotsToGive} plazas*`} en *Bajo de Fuera*.`;
            sendBdfWebhook(msg).catch(console.error);
            showToast('Plazas Cedidas', `Has transferido ${spotsToGive} plazas a ${targetInfo.name}.`);
            pendingCesionDirecta = null;
        })
        .catch(err => {
            console.error("Error cediendo plazas:", err);
            showNotification('Error', err.message, true);
            pendingCesionDirecta = null;
            renderAll();
        });
}

/* =========================================================================
   6C. PROPONER INTERCAMBIO SIN DRAG & DROP (Wizard)
   ========================================================================= */

let proposeSwapState = null;

function openProponerIntercambioFromEdit() {
    if (!pendingEditSalida) return;
    const { dateStr, salidaId, centerCode, currentPax } = pendingEditSalida;
    hideEl('edit-salida-modal');

    proposeSwapState = {
        sourceDate: dateStr,
        salidaId,
        centerCode,
        pax: currentPax,
        targetDate: null
    };

    const cInfo = CENTERS[centerCode] || { name: centerCode };
    const dObj = parseDateT00(dateStr);

    getEl('propose-swap-subtitle').textContent = `Bajo de Fuera · ${formatDateShort(dObj)}`;
    getEl('propose-swap-origin-info').innerHTML = `
        <div class="flex items-center justify-between w-full">
            <span><b>${cInfo.name}</b> · Tu salida actual:</span>
            <span class="font-bold bg-purple-200/80 px-2 py-0.5 rounded text-purple-950">${currentPax} plazas el ${formatDateShort(dObj)}</span>
        </div>
    `;

    const dateInput = getEl('propose-swap-target-date');
    if (dateInput) {
        dateInput.value = '';
    }

    const errP = getEl('propose-swap-date-error');
    if (errP) errP.classList.add('hidden');

    hideEl('propose-swap-step2-container');
    showEl('propose-swap-modal');
}

function closeProposeSwapModal() {
    hideEl('propose-swap-modal');
    proposeSwapState = null;
}

async function handleProposeSwapDateChange(selectedDateStr) {
    if (!proposeSwapState) return;
    const errP = getEl('propose-swap-date-error');

    if (!selectedDateStr) {
        if (errP) hideEl('propose-swap-date-error');
        hideEl('propose-swap-step2-container');
        return;
    }

    // La fecha actual de la escuela no es seleccionable
    if (selectedDateStr === proposeSwapState.sourceDate) {
        if (errP) {
            errP.textContent = 'No puedes seleccionar la misma fecha de tu salida actual.';
            showEl('propose-swap-date-error');
        }
        hideEl('propose-swap-step2-container');
        return;
    }

    if (errP) hideEl('propose-swap-date-error');
    proposeSwapState.targetDate = selectedDateStr;

    showEl('propose-swap-step2-container');
    showEl('propose-swap-loading');
    hideEl('propose-swap-schools-list');
    hideEl('propose-swap-empty-day');

    try {
        // Cargar los datos del día desde Firestore si no están en caché
        const targetDayData = await ensureDayInCache(selectedDateStr);
        hideEl('propose-swap-loading');

        const summary = getDaySummary(targetDayData, selectedDateStr);
        getEl('propose-swap-target-summary').textContent = `${summary.totalOccupied}/${summary.totalQuota} plazas ocupadas`;

        const targetSalidas = getDaySalidas(targetDayData, selectedDateStr);
        const normMyCode = normCenter(proposeSwapState.centerCode);

        // Filtrar plazas de la propia escuela
        const otherSchoolsSalidas = targetSalidas.filter(s => {
            const c = normCenter(s.centerCode);
            return c !== normMyCode;
        });

        const schoolsList = getEl('propose-swap-schools-list');
        const emptyDayContainer = getEl('propose-swap-empty-day');
        const freeSpots = Math.max(0, summary.totalQuota - summary.totalOccupied);

        if (otherSchoolsSalidas.length === 0) {
            hideEl('propose-swap-schools-list');
            showEl('propose-swap-empty-day');

            const emptyP = emptyDayContainer.querySelector('p');
            const moveBtn = getEl('btn-propose-swap-move');
            if (freeSpots > 0) {
                if (emptyP) emptyP.textContent = `Ninguna otra escuela tiene plazas asignadas en esta fecha (${freeSpots} plazas libres disponibles).`;
                if (moveBtn) showEl('btn-propose-swap-move');
            } else {
                if (emptyP) emptyP.textContent = `El cupo de este día está completo (${summary.totalOccupied}/${summary.totalQuota}) y ninguna otra escuela tiene plazas.`;
                if (moveBtn) hideEl('btn-propose-swap-move');
            }
        } else {
            hideEl('propose-swap-empty-day');
            showEl('propose-swap-schools-list');

            let rowsHtml = '';
            if (freeSpots > 0) {
                rowsHtml += `
                <div class="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between shadow-xs mb-2">
                    <div class="flex items-center gap-2">
                        <span class="text-base">🚚</span>
                        <div>
                            <div class="font-bold text-xs text-emerald-900">Mover a plazas libres</div>
                            <div class="text-[11px] text-emerald-700">Hay ${freeSpots} plazas disponibles en este día</div>
                        </div>
                    </div>
                    <button onclick="handleProposeSwapMoveAction()" class="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer shrink-0">
                        Mover aquí →
                    </button>
                </div>
                <div class="text-[11px] font-bold text-slate-400 uppercase tracking-wider my-2">O permutar con otra escuela:</div>
                `;
            }

            otherSchoolsSalidas.forEach(s => {
                const sCode = normCenter(s.centerCode);
                const cInfo = CENTERS[sCode] || { name: sCode, hex: '#64748b' };
                const totalPax = Number(s.plazas !== undefined ? s.plazas : s.pax) || 0;
                const pendingReq = getPendingRequestForSalida(s.id, selectedDateStr, sCode);

                if (pendingReq) {
                    rowsHtml += `
                    <div class="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between opacity-60 cursor-not-allowed">
                        <div class="flex items-center gap-2">
                            <span class="w-3 h-3 rounded-full" style="background-color: ${cInfo.hex || '#64748b'}"></span>
                            <span class="font-bold text-xs text-slate-700">${cInfo.name}</span>
                            <span class="text-xs font-semibold text-slate-400">(${totalPax} pl.)</span>
                        </div>
                        <span class="text-[10px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-md">
                            ⏳ Solicitud pendiente
                        </span>
                    </div>
                    `;
                } else {
                    rowsHtml += `
                    <button onclick="confirmProposeSwapWithSchool('${s.id}', '${sCode}', ${totalPax})"
                            class="w-full p-3 bg-white hover:bg-purple-50/70 border border-slate-200 hover:border-purple-300 rounded-xl flex items-center justify-between transition-all group cursor-pointer shadow-xs">
                        <div class="flex items-center gap-2">
                            <span class="w-3 h-3 rounded-full" style="background-color: ${cInfo.hex || '#64748b'}"></span>
                            <span class="font-bold text-xs text-slate-800 group-hover:text-purple-900">${cInfo.name}</span>
                            <span class="text-xs font-bold text-slate-500">(${totalPax} pl.)</span>
                        </div>
                        <span class="text-xs font-bold text-purple-700 group-hover:translate-x-0.5 transition-transform flex items-center gap-1">
                            Permutar <span>→</span>
                        </span>
                    </button>
                    `;
                }
            });

            schoolsList.innerHTML = rowsHtml;
        }
    } catch (err) {
        console.error("Error al cargar disponibilidad del día en wizard:", err);
        hideEl('propose-swap-loading');
        if (errP) {
            errP.textContent = 'Error al cargar los datos del día. Por favor, reintenta.';
            showEl('propose-swap-date-error');
        }
    }
}

window.handleProposeSwapDateChange = handleProposeSwapDateChange;

function confirmProposeSwapWithSchool(targetSalidaId, targetCenterCode, targetPax) {
    if (!proposeSwapState) return;
    const { sourceDate, salidaId, centerCode, pax, targetDate } = proposeSwapState;

    const sourceBoat = {
        id: salidaId,
        dateStr: sourceDate,
        centerCode: centerCode,
        pax: pax,
        totalPlazas: pax
    };

    const targetSalida = {
        id: targetSalidaId,
        date: targetDate,
        centerCode: targetCenterCode,
        pax: targetPax,
        totalPlazas: targetPax
    };

    closeProposeSwapModal();
    initiateSwap(sourceBoat, targetSalida);
}

function handleProposeSwapMoveAction() {
    if (!proposeSwapState || !proposeSwapState.targetDate) return;
    const { sourceDate, salidaId, centerCode, pax, targetDate } = proposeSwapState;

    const sourceBoat = {
        id: salidaId,
        dateStr: sourceDate,
        centerCode: centerCode,
        pax: pax,
        totalPlazas: pax
    };

    closeProposeSwapModal();
    initiateMoveToDate(sourceBoat, targetDate);
}

/**
 * Lógica reutilizable para mover plazas a un día objetivo (Scenario 4A).
 * Gestiona cupo lleno, movimiento completo o ajuste automático parcial (split).
 * @param {Object} sourceBoat
 * @param {string} targetDate
 */
async function initiateMoveToDate(sourceBoat, targetDate) {
    const targetDayData = await ensureDayInCache(targetDate);
    const targetSummary = getDaySummary(targetDayData, targetDate);
    const targetCap = getDayQuota(targetDate, targetDayData);
    const freeSpotsTarget = targetCap - targetSummary.totalOccupied;

    if (freeSpotsTarget <= 0) {
        showNotification('Cupo Lleno', `No se puede mover la salida al ${formatDateShort(parseDateT00(targetDate))} porque el cupo diario está completamente lleno.`, true);
        return;
    }

    if (freeSpotsTarget >= sourceBoat.pax) {
        executeMoveWithAdminCheck(sourceBoat.dateStr, targetDate, sourceBoat.id, sourceBoat.centerCode, sourceBoat.pax);
    } else {
        promptPartialMove(sourceBoat, targetDate, freeSpotsTarget);
    }
}

/* =========================================================================
   7. SOLICITAR PLAZAS A OTRA ESCUELA (Section 3 - Request Spots)
   ========================================================================= */

function promptDonationRequest(dateStr, salidaId, targetCenterCode) {
    const dayData = monthDaysCache[dateStr] || null;
    const daySalidas = getDaySalidas(dayData, dateStr);
    const targetSalida = daySalidas.find(s => s.id === salidaId || s.centerCode === targetCenterCode);
    const maxPax = targetSalida ? targetSalida.pax : 10;
    const targetInfo = CENTERS[targetCenterCode] || { name: targetCenterCode, emoji: '⛵' };
    const dObj = parseDateT00(dateStr);

    pendingDonationRequest = {
        dateStr,
        salidaId,
        targetCenterCode,
        maxPax
    };

    getEl('donation-title').textContent = `Solicitar a ${targetInfo.name}`;
    getEl('donation-subtitle').textContent = `Bajo de Fuera · ${formatDateShort(dObj)}`;
    getEl('donation-pax-info').textContent = `${targetInfo.name} tiene ${maxPax} plazas en esta salida.`;

    const paxInput = getEl('donation-pax');
    paxInput.value = Math.min(2, maxPax);
    paxInput.max = maxPax;

    getEl('donation-type-partial').checked = true;
    getEl('donation-pax-container').classList.remove('hidden');

    showEl('donation-request-modal');
}

function cancelDonationRequest() {
    hideEl('donation-request-modal');
    pendingDonationRequest = null;
}

function confirmDonationRequest() {
    if (!pendingDonationRequest) return;
    const isFull = getEl('donation-type-full').checked;
    const pax = parseInt(getEl('donation-pax').value, 10);
    const maxPax = pendingDonationRequest.maxPax;

    if (!isFull && (!pax || isNaN(pax) || pax <= 0 || pax > maxPax)) {
        showNotification('Error', `Introduce entre 1 y ${maxPax} plazas, o selecciona "Barco completo".`, true);
        return;
    }

    hideEl('donation-request-modal');

    const requestedPax = isFull ? maxPax : pax;
    const { dateStr, salidaId, targetCenterCode } = pendingDonationRequest;
    const targetInfo = CENTERS[targetCenterCode] || { name: targetCenterCode, emoji: '⛵' };
    const myCode = USER_CENTER_KEYS[currentUserKey];
    const myInfo = CENTERS[myCode] || { name: currentUserKey, emoji: '⛵' };
    const dObj = parseDateT00(dateStr);

    const msg = `🤖 *AVISO AUTOMÁTICO*\n🙏 *SOLICITUD DE PLAZAS* - ${myInfo.emoji} ${myInfo.name} a ${targetInfo.emoji} ${targetInfo.name}\nPara el ${dObj.getDate()} de ${MONTHS_ES[dObj.getMonth()].toUpperCase()}, solicita que le ceda ${isFull ? '*EL BARCO COMPLETO*' : `*${requestedPax} plazas*`} en *Bajo de Fuera*. Entrad al visor para acordarlo.`;

    triggerWhatsAppConfirm("Petición de Plazas", msg, async () => {
        try {
            await createBdfRequest({
                type: 'request',
                initiatorCenter: myCode,
                targetCenter: targetCenterCode,
                targetSalidaId: salidaId,
                date: dateStr,
                requestedPax: requestedPax,
                isFull: isFull
            });
            sendBdfWebhook(msg).catch(console.error);
            logBdfHistory('petition', {
                date: dateStr,
                fromCenter: myCode,
                toCenter: targetCenterCode,
                slots: requestedPax,
                isFull
            }).catch(console.error);
        } catch (err) {
            console.error("Error enviando petición:", err);
            showNotification('Error', err.message, true);
        }
        pendingDonationRequest = null;
    });
}

/* =========================================================================
   8. ARRASTRAR Y SOLTAR (Move & Swap entre Días)
   ========================================================================= */

document.addEventListener('dragstart', (e) => {
    if (isGuestMode) { e.preventDefault(); return; }
    const block = e.target.closest('.draggable-item');
    if (!block || block.getAttribute('draggable') !== 'true') return;

    draggedBoat = {
        id: block.dataset.dragId,
        dateStr: block.dataset.dragDate,
        centerCode: block.dataset.dragCenter,
        pax: parseInt(block.dataset.dragPax, 10)
    };

    try {
        e.dataTransfer.setData('text/plain', String(draggedBoat.id));
        e.dataTransfer.effectAllowed = 'move';
    } catch (err) { }

    setTimeout(() => block.classList.add('opacity-50'), 0);
});

document.addEventListener('dragend', (e) => {
    const block = e.target.closest('.draggable-item');
    if (block) block.classList.remove('opacity-50');
    draggedBoat = null;
    document.querySelectorAll('.dropzone').forEach(el => el.classList.remove('bg-blue-50', 'bg-purple-50'));
});

document.addEventListener('dragover', (e) => {
    if (isGuestMode || !draggedBoat) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';

    const dropzone = e.target.closest('.dropzone');
    document.querySelectorAll('.dropzone').forEach(el => {
        if (el !== dropzone) el.classList.remove('bg-blue-50', 'bg-purple-50');
    });

    if (!dropzone) return;
    const targetDate = dropzone.dataset.date;
    if (targetDate === draggedBoat.dateStr) return;

    const targetDayData = monthDaysCache[targetDate] || null;
    const targetSalidas = getDaySalidas(targetDayData, targetDate);
    const hasOtherCenters = targetSalidas.some(s => s.centerCode !== draggedBoat.centerCode);

    if (hasOtherCenters) {
        dropzone.classList.add('bg-purple-50'); // Posible intercambio (Scenario 4B)
    } else {
        dropzone.classList.add('bg-blue-50');   // Mover a hueco libre (Scenario 4A)
    }
});

document.addEventListener('dragleave', (e) => {
    const dropzone = e.target.closest('.dropzone');
    if (dropzone && !dropzone.contains(e.relatedTarget)) {
        dropzone.classList.remove('bg-blue-50', 'bg-purple-50');
    }
});

document.addEventListener('drop', (e) => {
    if (isGuestMode || !draggedBoat) return;
    e.preventDefault();
    document.querySelectorAll('.dropzone').forEach(el => el.classList.remove('bg-blue-50', 'bg-purple-50'));

    const dropzone = e.target.closest('.dropzone');
    if (!dropzone) return;

    const targetDate = dropzone.dataset.date;
    if (!targetDate || targetDate === draggedBoat.dateStr) return;

    // Regla Section 4: Comprobación de permisos y bloqueo
    const myCenterCode = USER_CENTER_KEYS[currentUserKey];
    if (currentUserKey !== 'admin') {
        if (draggedBoat.centerCode !== myCenterCode) {
            showNotification('Acción Bloqueada', 'Solo puedes mover tus propias salidas.', true);
            return;
        }
        const pendingReq = getPendingRequestForSalida(draggedBoat.id, draggedBoat.dateStr, draggedBoat.centerCode);
        if (pendingReq) {
            showNotification('Salida Bloqueada', 'Esta salida tiene una solicitud pendiente. No se puede mover.', true);
            return;
        }
    } else {
        // El admin puede arrastrar cualquier salida, incluidas las bloqueadas; al hacerlo cancela la solicitud automáticamente (Section 4)
        const pendingReq = getPendingRequestForSalida(draggedBoat.id, draggedBoat.dateStr, draggedBoat.centerCode);
        if (pendingReq) {
            cancelBdfRequest(pendingReq.id);
        }
    }

    const targetDayData = monthDaysCache[targetDate] || null;
    const targetSummary = getDaySummary(targetDayData, targetDate);
    const targetCap = getDayQuota(targetDate, targetDayData);
    const freeSpotsTarget = targetCap - targetSummary.totalOccupied;

    const targetSalidas = getDaySalidas(targetDayData, targetDate);
    const otherSchoolsSalidas = targetSalidas.filter(s => s.centerCode !== draggedBoat.centerCode);

    // =========================================================================
    // Scenario 4A: Target Day has NO other schools (empty or free capacity only)
    // =========================================================================
    if (otherSchoolsSalidas.length === 0) {
        initiateMoveToDate(draggedBoat, targetDate);
    }
    // =========================================================================
    // Scenario 4B: Target Day ALREADY HAS departures from other schools
    // =========================================================================
    else {
        showSwapChoiceModal(draggedBoat, targetDate, otherSchoolsSalidas, freeSpotsTarget);
    }
});

let pendingPartialSwap = null;
let pendingPartialMove = null;

/**
 * Modal de Advertencia (Ámbar): Límite de Cupo — Reducción Automática (Scenario 4A.2 / 4B.Option 1).
 */
function promptPartialMove(sourceBoat, targetDate, safeSpots) {
    const dObj = parseDateT00(targetDate);
    const dStr = formatDateShort(dObj);
    const origDStr = formatDateShort(parseDateT00(sourceBoat.dateStr));
    const retainedPax = sourceBoat.pax - safeSpots;

    pendingPartialMove = { sourceBoat, targetDate, safeSpots };
    const msg = `En el día de destino (${dStr}), solo quedan ${safeSpots} plazas libres.\n\nTu barco de ${sourceBoat.pax} plazas se dividirá:\n• ${safeSpots} plazas se añadirán al ${dStr}\n• ${retainedPax} plazas permanecerán en el día de origen (${origDStr})\n\n¿Aceptas continuar con este ajuste automático?`;

    getEl('partial-action-msg').innerText = msg;
    showEl('partial-action-modal');
}

function cancelPartialAction() {
    hideEl('partial-action-modal');
    pendingPartialSwap = null;
    pendingPartialMove = null;
    renderAll();
}

function confirmPartialAction() {
    hideEl('partial-action-modal');

    if (pendingPartialSwap) {
        const { dateA, salidaIdA, centerA, safeA, retainedA, dateB, salidaIdB, centerB, safeB, retainedB, spaceA, spaceB } = pendingPartialSwap;
        pendingPartialSwap = null;
        executeSwapWithAdminCheck(dateA, salidaIdA, centerA, safeA, retainedA, dateB, salidaIdB, centerB, safeB, retainedB, spaceA, spaceB);
    } else if (pendingPartialMove) {
        const { sourceBoat, targetDate, safeSpots } = pendingPartialMove;
        pendingPartialMove = null;
        executeMoveWithAdminCheck(sourceBoat.dateStr, targetDate, sourceBoat.id, sourceBoat.centerCode, safeSpots);
    }
}

/**
 * Muestra el selector modal: Ocupar Hueco Libre vs Intercambiar con otra escuela (Scenario 4B).
 * Section 4B Option 2:
 * - Muestra un botón por cada salida individual de otra escuela en el día destino.
 * - Si una escuela tiene dos salidas, se muestran dos botones separados con sus plazas respectivas.
 * - Las salidas bloqueadas se muestran deshabilitadas ("Solicitud pendiente").
 */
function showSwapChoiceModal(sourceBoat, targetDate, otherSchoolsSalidas, freeSpotsTarget) {
    pendingSwap = { sourceBoat, targetDate, otherSchoolsSalidas, freeSpotsTarget };

    const container = getEl('swap-choice-buttons');
    container.innerHTML = '';

    const canTakeHueco = freeSpotsTarget > 0;
    const canTakeFull = freeSpotsTarget >= sourceBoat.pax;

    getEl('swap-choice-title').textContent = "Elige una Acción";
    getEl('swap-choice-subtitle').textContent = "Hay barcos asignados en este día. Puedes ocupar plazas libres o intercambiar fechas con otra salida.";

    // Opción 1: Botón [Ocupar Hueco Libre (X plazas disponibles)] (solo si free_spots_target > 0)
    if (canTakeHueco) {
        const btnHueco = document.createElement('button');
        btnHueco.className = `w-full px-4 py-3 rounded-xl text-xs font-bold shadow-xs border-2 border-emerald-500 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 transition-all flex items-center justify-between cursor-pointer`;
        const actionLabel = canTakeFull ? 'Ocupar Hueco Libre' : `Ocupar Hueco Libre (${freeSpotsTarget} pl. disponibles)`;
        btnHueco.innerHTML = `<span><span class="text-sm mr-1.5">✅</span> ${actionLabel}</span> <span class="bg-emerald-200 px-2 py-0.5 rounded text-[10px] font-black">${freeSpotsTarget} pl. libres</span>`;
        btnHueco.onclick = () => selectTakeHueco();
        container.appendChild(btnHueco);
    }

    // Opción 2: Botones de Intercambio (uno por cada salida individual de otra escuela)
    otherSchoolsSalidas.forEach(targetSalida => {
        const cInfo = CENTERS[targetSalida.centerCode] || { name: targetSalida.centerCode, color: 'bg-slate-700', text: 'text-white' };
        const isTargetLocked = !!getPendingRequestForSalida(targetSalida.id, targetDate, targetSalida.centerCode);

        const btnSwap = document.createElement('button');
        if (isTargetLocked) {
            btnSwap.className = `w-full px-4 py-3 rounded-xl text-xs font-bold shadow-2xs border border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed opacity-75 flex items-center justify-between mt-2`;
            btnSwap.disabled = true;
            btnSwap.innerHTML = `<span><span class="text-sm mr-1.5">⏳</span> Intercambiar con ${cInfo.name} (${targetSalida.pax} pl.)</span> <span class="bg-amber-100 text-amber-800 px-2 py-0.5 rounded text-[10px] font-black">Solicitud pendiente</span>`;
        } else {
            btnSwap.className = `w-full px-4 py-3 rounded-xl text-xs font-bold shadow-xs border border-slate-200 hover:shadow-md transition-all flex items-center justify-between ${cInfo.color} ${cInfo.text} mt-2 cursor-pointer`;
            btnSwap.innerHTML = `<span><span class="text-sm mr-1.5">🔀</span> Intercambiar con ${cInfo.name}</span> <span class="bg-black/20 px-2 py-0.5 rounded text-[10px] font-black">${targetSalida.pax} Plazas</span>`;
            btnSwap.onclick = () => selectSwapWithSalida(targetSalida);
        }
        container.appendChild(btnSwap);
    });

    showEl('swap-choice-modal');
}

function cancelSwapChoice() {
    hideEl('swap-choice-modal');
    pendingSwap = null;
}

function selectTakeHueco() {
    if (!pendingSwap) return;
    const { sourceBoat, targetDate } = pendingSwap;
    hideEl('swap-choice-modal');
    pendingSwap = null;

    initiateMoveToDate(sourceBoat, targetDate);
}

/**
 * Procesa el intercambio entre la salida arrastrada y la salida seleccionada (Section 5).
 * @param {Object} targetSalida
 */
function selectSwapWithSalida(targetSalida) {
    if (!pendingSwap) return;
    const { sourceBoat, targetDate } = pendingSwap;
    hideEl('swap-choice-modal');
    pendingSwap = null;

    initiateSwap(sourceBoat, targetSalida);
}

/**
 * Cálculos bilaterales y validaciones de Swap (Section 5).
 */
async function initiateSwap(sourceBoat, targetSalida) {
    const dateA = sourceBoat.dateStr;
    const dateB = targetSalida.date;

    // Asegurar que ambas fechas están cargadas en caché aunque pertenezcan a meses distintos
    await Promise.all([ensureDayInCache(dateA), ensureDayInCache(dateB)]);

    const salidaIdA = sourceBoat.id;
    const centerA = normCenter(sourceBoat.centerCode);
    const paxA = Number(sourceBoat.totalPlazas !== undefined ? sourceBoat.totalPlazas : (sourceBoat.plazas !== undefined ? sourceBoat.plazas : sourceBoat.pax)) || 0;

    const salidaIdB = targetSalida.id;
    const centerB = normCenter(targetSalida.centerCode);
    const paxB = Number(targetSalida.totalPlazas !== undefined ? targetSalida.totalPlazas : (targetSalida.plazas !== undefined ? targetSalida.plazas : targetSalida.pax)) || 0;

    const dayDataA = monthDaysCache[dateA] || null;
    const summaryA = getDaySummary(dayDataA, dateA);
    const maxQuotaA = getDayQuota(dateA, dayDataA);

    const dayDataB = monthDaysCache[dateB] || null;
    const summaryB = getDaySummary(dayDataB, dateB);
    const maxQuotaB = getDayQuota(dateB, dayDataB);

    // Bug 5: Si algún día supera el cupo (admin redujo el cupo por debajo de lo reservado), bloquear con "Error de Cupo"
    if (summaryA.totalOccupied > maxQuotaA) {
        const dA = formatDateShort(parseDateT00(dateA));
        showNotification(
            'Error de Cupo',
            `No se puede realizar el intercambio: el día ${dA} supera el cupo máximo permitido (${summaryA.totalOccupied}/${maxQuotaA} plazas ocupadas).`,
            true
        );
        return;
    }
    if (summaryB.totalOccupied > maxQuotaB) {
        const dB = formatDateShort(parseDateT00(dateB));
        showNotification(
            'Error de Cupo',
            `No se puede realizar el intercambio: el día ${dB} supera el cupo máximo permitido (${summaryB.totalOccupied}/${maxQuotaB} plazas ocupadas).`,
            true
        );
        return;
    }

    const spaceA = maxQuotaA - (summaryA.totalOccupied - paxA);
    const spaceB = maxQuotaB - (summaryB.totalOccupied - paxB);

    // Case 1: When is a Swap Truly Impossible? (space_A <= 0 or space_B <= 0)
    if (spaceA <= 0 || spaceB <= 0) {
        const blockedDay = spaceA <= 0 ? formatDateShort(parseDateT00(dateA)) : formatDateShort(parseDateT00(dateB));
        showNotification(
            'Error de Cupo',
            `No se puede realizar el intercambio: el día ${blockedDay} tiene 0 plazas de capacidad disponible para recibir buceadores.`,
            true
        );
        return;
    }

    // Case 2: Asymmetrical Split Swap
    const safeA = Math.min(paxA, spaceB);
    const safeB = Math.min(paxB, spaceA);
    const retainedA = paxA - safeA;
    const retainedB = paxB - safeB;

    // Si alguno de los barcos se debe dividir por cupo
    if (paxA > spaceB || paxB > spaceA) {
        const cAInfo = CENTERS[centerA] || { name: centerA };
        const cBInfo = CENTERS[centerB] || { name: centerB };
        const dA = formatDateShort(parseDateT00(dateA));
        const dB = formatDateShort(parseDateT00(dateB));

        pendingPartialSwap = { dateA, salidaIdA, centerA, safeA, retainedA, dateB, salidaIdB, centerB, safeB, retainedB, spaceA, spaceB };

        let msg = `Para el intercambio entre ${cAInfo.name} (${dA}) y ${cBInfo.name} (${dB}):\n\n`;
        if (paxA > spaceB) {
            msg += `• ${cAInfo.name}: se trasladarán ${safeA} plazas al ${dB} y ${retainedA} plazas permanecerán en el ${dA}.\n`;
        }
        if (paxB > spaceA) {
            msg += `• ${cBInfo.name}: se trasladarán ${safeB} plazas al ${dA} y ${retainedB} plazas permanecerán en el ${dB}.\n`;
        }
        msg += `\n¿Aceptas continuar con este ajuste automático?`;

        getEl('partial-action-msg').innerText = msg;
        showEl('partial-action-modal');
        return;
    }

    // Intercambio limpio sin división
    executeSwapWithAdminCheck(dateA, salidaIdA, centerA, safeA, retainedA, dateB, salidaIdB, centerB, safeB, retainedB, spaceA, spaceB);
}

/**
 * Ejecuta el movimiento de salida con control de Admin y WhatsApp (Scenario 4A / 4B.Option 1).
 */
function executeMoveWithAdminCheck(sourceDate, targetDate, salidaId, centerCode, pax) {
    const normCode = normCenter(centerCode);
    const centerInfo = CENTERS[normCode] || { name: normCode, emoji: '⛵' };
    const d1 = formatDateShort(parseDateT00(sourceDate));
    const d2 = formatDateShort(parseDateT00(targetDate));

    // Admin: ejecución inmediata
    if (currentUserKey === 'admin') {
        executeMoveSalida(sourceDate, targetDate, salidaId, normCode, pax)
            .then(() => {
                showToast('Salida Movida', `Movidas ${pax} plazas al ${d2}.`);
            })
            .catch(err => {
                showNotification('Error', err.message, true);
                renderAll();
            });
        return;
    }

    const msg = `🤖 *AVISO AUTOMÁTICO*\n➡️ *CAMBIO DE FECHA* - ${centerInfo.emoji} ${centerInfo.name}\nMovió su salida de *Bajo de Fuera* del ${d1} al ${d2} (${pax} plazas).`;

    triggerWhatsAppConfirm("Cambio de Fecha", msg, async () => {
        try {
            await executeMoveSalida(sourceDate, targetDate, salidaId, normCode, pax);
            sendBdfWebhook(msg).catch(console.error);
            showToast('Salida Movida', `Movidas ${pax} plazas al ${d2}.`);
        } catch (err) {
            console.error("Error moviendo salida:", err);
            showNotification('Error', err.message, true);
            renderAll();
        }
    });
}

/**
 * Ejecuta el intercambio de fechas entre dos centros con control de Admin y WhatsApp (Section 5).
 */
function executeSwapWithAdminCheck(dateA, salidaIdA, centerA, safeA, retainedA, dateB, salidaIdB, centerB, safeB, retainedB, spaceA = null, spaceB = null) {
    const normA = normCenter(centerA);
    const normB = normCenter(centerB);
    const cAInfo = CENTERS[normA] || { name: normA, emoji: '⛵' };
    const cBInfo = CENTERS[normB] || { name: normB, emoji: '⛵' };
    const dA = formatDateShort(parseDateT00(dateA));
    const dB = formatDateShort(parseDateT00(dateB));

    // Admin: ejecución inmediata
    if (currentUserKey === 'admin') {
        executeSwapSalidas(dateA, salidaIdA, normA, safeA, retainedA, dateB, salidaIdB, normB, safeB, retainedB)
            .then(() => {
                showToast('Intercambio Completado', `Intercambio realizado entre ${cAInfo.name} (${dA}) y ${cBInfo.name} (${dB}).`);
            })
            .catch(err => {
                showNotification('Error', err.message, true);
                renderAll();
            });
        return;
    }

    const myCode = USER_CENTER_KEYS[currentUserKey];
    const targetCenter = (normA === normCenter(myCode)) ? normB : normA;
    const targetInfo = CENTERS[normCenter(targetCenter)] || { name: targetCenter };

    const msg = `🤖 *AVISO AUTOMÁTICO*\n🔀 *PROPUESTA DE INTERCAMBIO* - ${cAInfo.emoji} ${cAInfo.name} ↔️ ${cBInfo.emoji} ${cBInfo.name}\n${cAInfo.name} pasa del ${dA} al ${dB} (${safeA} plazas), y ${cBInfo.name} pasa al ${dA} (${safeB} plazas). Entrad al visor para acordarlo.`;

    triggerWhatsAppConfirm("Intercambio de Fechas", msg, async () => {
        try {
            await createBdfRequest({
                type: 'swap',
                initiatorCenter: myCode,
                targetCenter: targetCenter,
                dateA,
                salidaIdA,
                centerA: normA,
                paxA: safeA,
                retainedPaxA: retainedA,
                dateB,
                salidaIdB,
                centerB: normB,
                paxB: safeB,
                retainedPaxB: retainedB,
                spaceA,
                spaceB
            });
            sendBdfWebhook(msg).catch(console.error);
            showToast('Propuesta Enviada', `Propuesta enviada a ${targetInfo.name}.`);
            logBdfHistory('swap_request', {
                dateA, dateB, centerA: normA, centerB: normB, paxA: safeA, retainedPaxA: retainedA, paxB: safeB, retainedPaxB: retainedB,
                initiatorCenter: myCode, targetCenter
            }).catch(console.error);
        } catch (err) {
            console.error("Error enviando propuesta de intercambio:", err);
            showNotification('Error', err.message, true);
            renderAll();
        }
    });
}


/* =========================================================================
   7. CAMBIO DE CONTRASEÑA
   ========================================================================= */

function openChangePasswordModal() {
    getEl('new-password-input').value = '';
    showEl('change-password-modal');
}

async function executeChangePassword() {
    const newPwd = getEl('new-password-input').value;
    if (!newPwd || newPwd.length < 6) {
        showToast('Error', 'La contraseña debe tener al menos 6 caracteres.', true);
        return;
    }

    const user = auth.currentUser;
    if (user) {
        try {
            await user.updatePassword(newPwd);
            hideEl('change-password-modal');
            showToast('Contraseña Actualizada', 'Tu nueva contraseña ha sido guardada.');
        } catch (e) {
            showToast('Error', e.message, true);
        }
    }
}

/* =========================================================================
   8. IMPORTACIÓN DE CUADRANTE CSV (ADMIN DIRECTO & MODAL)
   ========================================================================= */

function triggerImport() {
    const input = getEl('csv-upload');
    if (input) input.click();
}

async function handleImport(e) {
    const f = e.target.files && e.target.files[0];
    if (!f) return;

    const btn = getEl('user-badge-button');
    const originalBtnHtml = btn ? btn.innerHTML : '';
    if (btn) {
        btn.innerHTML = `<svg class="animate-spin h-3.5 w-3.5 mr-1 text-blue-600 inline" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg><span class="tracking-wide text-[10px]">Cargando CSV...</span>`;
    }

    try {
        const text = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = ev => resolve(ev.target.result);
            reader.onerror = err => reject(err);
            reader.readAsText(f);
        });

        const parsed = parseCsvSchedule(text);
        if (!parsed || !parsed.totalEntries) {
            showToast('Error de Formato', 'No se encontraron filas válidas en el archivo CSV.', true);
            return;
        }

        await executeImportCsvSchedule(parsed.daysMap, true, parsed.salidasMap);
        showToast('Importación Exitosa', `Se han importado ${parsed.totalEntries} asignaciones (${Object.keys(parsed.daysMap).length} días) a Firestore.`);

        if (parsed.dateMin && parsed.dateMin !== '9999-99-99') {
            const firstDate = parseDateT00(parsed.dateMin);
            if (!isNaN(firstDate.getTime())) {
                selectMonth(firstDate.getMonth(), firstDate.getFullYear());
            }
        }
    } catch (err) {
        console.error("Error al importar CSV:", err);
        showToast('Error al Importar', err.message, true);
    } finally {
        if (btn && originalBtnHtml) btn.innerHTML = originalBtnHtml;
        e.target.value = '';
    }
}

function promptEmptyData() {
    try { backupAllToCSV(); } catch (e) { console.error("Error al generar backup previo a vaciado:", e); }
    setTimeout(() => showEl('empty-confirm-modal'), 800);
}

async function executeEmptyData() {
    const btnConfirm = getEl('btn-confirm-empty');
    const btnCancel = getEl('btn-cancel-empty');

    if (btnConfirm) { btnConfirm.textContent = "Borrando..."; btnConfirm.disabled = true; }
    if (btnCancel) btnCancel.disabled = true;

    try {
        const daysSnapshot = await db.collection(BDF_COLLECTIONS.DAYS).get();
        if (!daysSnapshot.empty) {
            await Promise.all(daysSnapshot.docs.map(doc => doc.ref.delete()));
        }

        const historySnapshot = await db.collection(BDF_COLLECTIONS.HISTORY).get();
        if (!historySnapshot.empty) {
            await Promise.all(historySnapshot.docs.map(doc => doc.ref.delete()));
        }

        const requestsSnapshot = await db.collection(BDF_COLLECTIONS.REQUESTS).get();
        if (!requestsSnapshot.empty) {
            await Promise.all(requestsSnapshot.docs.map(doc => doc.ref.delete()));
        }

        monthDaysCache = {};
        historyLogs = [];
        bdfRequests = [];

        hideEl('empty-confirm-modal');
        showToast('Base de Datos Vaciada', 'Se han eliminado permanentemente todos los datos y solicitudes de Bajo de Fuera en la nube.');
        renderAll();
    } catch (error) {
        console.error("Error al vaciar base de datos:", error);
        hideEl('empty-confirm-modal');
        showToast('Error', 'Hubo un problema al vaciar los datos.', true);
    } finally {
        if (btnConfirm) { btnConfirm.textContent = "Sí, vaciar"; btnConfirm.disabled = false; }
        if (btnCancel) btnCancel.disabled = false;
    }
}

let pendingCsvData = null;

function openImportCsvModal() {
    clearCsvInput();
    showEl('import-csv-modal');
}

function closeImportCsvModal() {
    hideEl('import-csv-modal');
    pendingCsvData = null;
}

function clearCsvInput() {
    const fileIn = getEl('csv-file-input');
    if (fileIn) fileIn.value = '';
    const textIn = getEl('csv-paste-textarea');
    if (textIn) textIn.value = '';
    hideEl('csv-preview-container');
    const btn = getEl('btn-do-import-csv');
    if (btn) btn.disabled = true;
    pendingCsvData = null;
}

function handleCsvFileSelect(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        const content = e.target.result;
        const textIn = getEl('csv-paste-textarea');
        if (textIn) textIn.value = content;
        processCsvText(content);
    };
    reader.readAsText(file, 'UTF-8');
}

function handleCsvTextInput(val) {
    if (!val || !val.trim()) {
        hideEl('csv-preview-container');
        const btn = getEl('btn-do-import-csv');
        if (btn) btn.disabled = true;
        pendingCsvData = null;
        return;
    }
    processCsvText(val);
}

async function loadDefault2026Csv() {
    try {
        const response = await fetch('bajo_de_fuera_2026_schedule.csv');
        if (!response.ok) throw new Error("No se pudo cargar el archivo predeterminado.");
        const text = await response.text();
        const textIn = getEl('csv-paste-textarea');
        if (textIn) textIn.value = text;
        processCsvText(text);
        showToast('Cuadrante 2026', 'Archivo predeterminado cargado en el visor previo.');
    } catch (e) {
        showToast('Error', e.message, true);
    }
}

function processCsvText(text) {
    try {
        const parsed = parseCsvSchedule(text);
        pendingCsvData = parsed;

        getEl('csv-preview-days').textContent = Object.keys(parsed.daysMap).length;
        getEl('csv-preview-salidas').textContent = parsed.totalEntries;

        const totalSpots = Object.values(parsed.centersCount).reduce((a, b) => a + b, 0);
        getEl('csv-preview-spots').textContent = totalSpots;

        const minFmt = formatDateShort(parseDateT00(parsed.dateMin));
        const maxFmt = formatDateShort(parseDateT00(parsed.dateMax));
        getEl('csv-preview-range').textContent = `Rango: ${minFmt} al ${maxFmt} (${parsed.ignoredRows} filas omitidas o inválidas)`;

        const centersDiv = getEl('csv-preview-centers');
        if (centersDiv) {
            centersDiv.innerHTML = Object.entries(parsed.centersCount).map(([code, count]) => {
                const c = CENTERS[code] || { name: code, color: 'bg-slate-700', text: 'text-white' };
                return `
                    <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold ${c.color} ${c.text} shadow-2xs">
                        <span>${c.name}:</span> <span>${count} pl.</span>
                    </span>
                `;
            }).join('');
        }

        showEl('csv-preview-container');
        const btn = getEl('btn-do-import-csv');
        if (btn) btn.disabled = false;
    } catch (e) {
        hideEl('csv-preview-container');
        const btn = getEl('btn-do-import-csv');
        if (btn) btn.disabled = true;
        pendingCsvData = null;
        showToast('Error en CSV', e.message, true);
    }
}

async function confirmImportCsv() {
    if (!pendingCsvData || !pendingCsvData.daysMap) return;

    const btn = getEl('btn-do-import-csv');
    const originalText = btn.innerHTML;
    const overwrite = getEl('csv-overwrite-check')?.checked ?? true;

    try {
        btn.disabled = true;
        btn.innerHTML = `<svg class="animate-spin h-4 w-4 mr-1 text-white inline" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Importando...`;

        await executeImportCsvSchedule(pendingCsvData.daysMap, overwrite, pendingCsvData.salidasMap);

        closeImportCsvModal();
        showToast('Importación Completada', `Se han importado ${pendingCsvData.totalEntries} salidas (${Object.keys(pendingCsvData.daysMap).length} días) a Firestore.`);

        if (pendingCsvData.dateMin && pendingCsvData.dateMin !== '9999-99-99') {
            const firstDate = parseDateT00(pendingCsvData.dateMin);
            if (!isNaN(firstDate.getTime())) {
                selectMonth(firstDate.getMonth(), firstDate.getFullYear());
            }
        }
    } catch (e) {
        showToast('Error al importar', e.message, true);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

// Cerrar menús al hacer clic fuera
document.addEventListener('click', function (e) {
    const userMenu = getEl('user-menu-wrapper');
    const userDropdown = getEl('user-dropdown');
    if (userMenu && userDropdown && !userMenu.contains(e.target)) {
        hideEl('user-dropdown');
    }

    const filterWrapper = getEl('center-filter-dropdown-wrapper');
    const filterPanel = getEl('filter-dropdown-panel');
    if (filterWrapper && filterPanel && !filterWrapper.contains(e.target)) {
        hideEl('filter-dropdown-panel');
    }
});

// Inicialización inmediata al cargar
refreshRangeListener();
listenHistoryLogs();
listenBdfRequests();
renderAll();
if (typeof scrubLegacyAutoNotes === 'function') {
    scrubLegacyAutoNotes();
}
