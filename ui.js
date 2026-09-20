/**
 * @file ui.js
 * @description Capa de renderizado e interfaz de usuario para Visor Bajo de Fuera.
 * Combina la vista mensual tipo cuadrante/hoja con las interacciones del Visor de Reserva.
 */

/**
 * Renderiza la aplicación completa según el estado actual.
 */
function renderAll() {
    renderHeader();
    renderToolbar();
    renderLeftNavigation();

    const container = getEl('main-view-container');
    if (!container) return;

    if (activeViewMode === 'mensual') {
        renderMonthlyCalendar();
    } else if (activeViewMode === 'estadisticas') {
        renderStats();
    } else if (activeViewMode === 'historial') {
        renderHistoryView();
    }
}

/**
 * Renderiza la cabecera, botones de login y dropdown de usuario.
 */
function renderHeader() {
    const isGuest = isGuestMode;
    const btnLoginHeader = getEl('btn-login-header');
    const userMenuWrapper = getEl('user-menu-wrapper');
    const userDropdown = getEl('user-dropdown');

    // Actualizar clases de las pestañas superiores
    const tabMensual = getEl('tab-mensual');
    const tabStats = getEl('tab-estadisticas');
    if (tabMensual) {
        tabMensual.className = activeViewMode === 'mensual' 
            ? "px-2.5 sm:px-3 md:px-4 py-1.5 tab-active flex items-center gap-1.5 transition-all whitespace-nowrap"
            : "px-2.5 sm:px-3 md:px-4 py-1.5 tab-inactive flex items-center gap-1.5 transition-all whitespace-nowrap";
    }
    if (tabStats) {
        tabStats.className = activeViewMode === 'estadisticas'
            ? "px-2.5 sm:px-3 md:px-4 py-1.5 tab-active flex items-center gap-1.5 transition-all whitespace-nowrap"
            : "px-2.5 sm:px-3 md:px-4 py-1.5 tab-inactive flex items-center gap-1.5 transition-all whitespace-nowrap";
    }

    if (btnLoginHeader) btnLoginHeader.classList.toggle('hidden', !isGuest);
    if (userMenuWrapper) userMenuWrapper.classList.toggle('hidden', isGuest);

    // Actualizar badge del usuario
    const badgeInfo = BADGE_INFO[currentUserKey] || BADGE_INFO['guest'];
    const badgeInitialEl = getEl('badge-initial');
    const badgeNameEl = getEl('badge-name');
    const userBadgeBtn = getEl('user-badge-button');

    if (badgeInitialEl) badgeInitialEl.innerText = badgeInfo.initial;
    if (badgeNameEl) badgeNameEl.innerText = badgeInfo.name;
    if (userBadgeBtn) {
        userBadgeBtn.className = `rounded-lg px-2 py-1 md:px-3 md:py-2 text-[9px] md:text-[10px] font-bold shadow-sm flex items-center gap-1.5 md:gap-2 hover:opacity-90 transition-opacity ${badgeInfo.color} ${badgeInfo.text}`;
    }

    // Actualizar notificaciones pendientes para el centro
    const myCode = USER_CENTER_KEYS[currentUserKey];
    const pendingForMe = (!isGuest && myCode)
        ? bdfRequests.filter(r => r.status === 'pending' && r.targetCenter === myCode)
        : [];
    const notifBubble = getEl('notif-bubble');
    const notifCount = getEl('notif-count');
    if (notifBubble && notifCount) {
        if (pendingForMe.length > 0 && !isGuest && currentUserKey !== 'admin') {
            notifCount.textContent = pendingForMe.length;
            notifBubble.classList.remove('hidden');
        } else {
            notifBubble.classList.add('hidden');
        }
    }

    // Menú desplegable del usuario (Idéntico a visor-reserva)
    if (userDropdown && !isGuest) {
        let html = '';
        if (pendingForMe.length > 0 && currentUserKey !== 'admin') {
            html += `<button onclick="openNotificationsModal(); toggleUserMenu();" class="text-left px-4 py-2.5 text-sm font-bold text-red-600 hover:bg-red-50 transition-colors flex items-center justify-between"><div class="flex items-center gap-2"><svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"></path></svg> Notificaciones</div> <span class="bg-red-600 text-white text-[10px] font-black px-2 py-0.5 rounded-full">${pendingForMe.length}</span></button><div class="h-px bg-slate-100 my-1"></div>`;
        }

        if (currentUserKey === 'admin') {
            html += `<button onclick="downloadJsonBackup(); toggleUserMenu();" class="text-left px-4 py-2.5 text-sm font-bold text-emerald-700 hover:bg-emerald-50 transition-colors flex items-center gap-2"><svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg> Descargar Copia JSON</button>`;
            html += `<button onclick="triggerImport(); toggleUserMenu();" class="text-left px-4 py-2.5 text-sm font-bold text-blue-700 hover:bg-blue-50 transition-colors flex items-center gap-2"><svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg> Importar CSV</button>`;
            html += `<button onclick="promptEmptyData(); toggleUserMenu();" class="text-left px-4 py-2.5 text-sm font-bold text-red-600 hover:bg-red-50 transition-colors flex items-center gap-2"><svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg> Vaciar Datos</button><div class="h-px bg-slate-100 my-1"></div>`;
        }

        html += `<button onclick="openChangePasswordModal(); toggleUserMenu();" class="text-left px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 transition-colors flex items-center gap-2"><svg class="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4v-3.252a1 1 0 01.293-.707l8.96-8.96A6 6 0 0115 7z"></path></svg> Cambiar contraseña</button>`;
        html += `<button onclick="logout(); toggleUserMenu();" class="text-left px-4 py-2.5 text-sm font-bold text-red-500 hover:bg-red-50 transition-colors flex items-center gap-2">Cerrar sesión</button>`;

        userDropdown.innerHTML = html;
    }

    // Botón volver al calendario si estamos en historial o estadísticas
    const btnBack = getEl('btn-back-to-calendar');
    if (btnBack) btnBack.classList.toggle('hidden', activeViewMode === 'mensual');
}

/**
 * Renderiza la barra lateral izquierda: Año 2026 (con acordeón de meses) y botón Este Mes.
 */
function renderLeftNavigation() {
    const list = getEl('year-months-list-2026');
    const chevron = getEl('year-chevron-2026');
    const yearBtn = getEl('year-btn-2026');
    if (!list) return;

    const isExpanded = expandedYears[2026] !== false;
    if (chevron) {
        chevron.style.transform = isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)';
    }

    if (!isExpanded) {
        list.classList.add('hidden');
        if (yearBtn) yearBtn.classList.remove('border-b');
        return;
    }
    list.classList.remove('hidden');
    if (yearBtn) yearBtn.classList.add('border-b');

    const today = new Date();
    const todayMonth = today.getMonth();
    const todayYear = today.getFullYear();

    let html = '';
    for (let m = 0; m < 12; m++) {
        const isSelected = (currentYear === 2026 && currentMonth === m);
        const isCurrentCalendarMonth = (todayYear === 2026 && todayMonth === m);

        let btnClass = '';
        if (isSelected) {
            btnClass = 'bg-blue-600 text-white font-black shadow-sm';
        } else {
            btnClass = 'text-slate-700 hover:bg-slate-100 font-bold';
        }

        html += `
            <button onclick="selectMonth(${m}, 2026)"
                class="w-full px-3 py-2 rounded-lg text-xs flex items-center justify-between transition-all ${btnClass} cursor-pointer">
                <span>${MONTHS_ES[m]}</span>
                ${isCurrentCalendarMonth ? `<span class="text-[9px] px-1.5 py-0.5 rounded font-black ${isSelected ? 'bg-white/20 text-white' : 'bg-blue-100 text-blue-700'}">HOY</span>` : ''}
            </button>
        `;
    }

    list.innerHTML = html;
}

/**
 * Renderiza la barra de herramientas: selector de filtros con checkboxes.
 */
function renderToolbar() {
    // Checkboxes del filtro de centros
    const filterContainer = getEl('filter-checkboxes-container');
    if (filterContainer) {
        filterContainer.innerHTML = Object.keys(CENTERS).map(code => {
            const c = CENTERS[code];
            const isChecked = activeCenterFilters.has(code);
            return `
                <label class="flex items-center gap-2 px-2 py-1.5 hover:bg-slate-50 rounded cursor-pointer text-xs select-none">
                    <input type="checkbox" ${isChecked ? 'checked' : ''} onchange="toggleCenterFilter('${code}')" class="rounded text-blue-600 focus:ring-blue-500 w-3.5 h-3.5">
                    <span class="w-2.5 h-2.5 rounded-full ${c.color}"></span>
                    <span class="font-medium text-slate-700">${c.name}</span>
                </label>
            `;
        }).join('');
    }

    // Texto del botón del filtro
    const filterBtnText = getEl('filter-button-text');
    if (filterBtnText) {
        if (activeCenterFilters.size === Object.keys(CENTERS).length) {
            filterBtnText.innerText = 'TODOS LOS CENTROS';
        } else if (activeCenterFilters.size === 0) {
            filterBtnText.innerText = 'NINGÚN CENTRO';
        } else {
            filterBtnText.innerText = `${activeCenterFilters.size} CENTROS`;
        }
    }
}

/**
 * Genera el HTML del tooltip para una salida bloqueada por solicitud pendiente.
 * Explica brevemente qué hay en la sala de espera, quién lo pidió y a quién.
 * @param {Object} req
 * @param {string} dateStr
 * @param {string} centerCode
 * @returns {string}
 */
function formatPendingRequestTooltip(req, dateStr, centerCode) {
    if (!req) return '';
    const initInfo = safeCenter(req.initiatorCenter);
    const targetInfo = safeCenter(req.targetCenter);

    let detailsHtml = '';

    if (req.type === 'swap') {
        const cA = safeCenter(req.centerA);
        const cB = safeCenter(req.centerB);
        const paxA = escapeHtml(req.paxA !== undefined ? req.paxA : (req.salidaA?.pax || '?'));
        const paxB = escapeHtml(req.paxB !== undefined ? req.paxB : (req.salidaB?.pax || '?'));

        const dObjA = parseDateT00(req.dateA);
        const dObjB = parseDateT00(req.dateB);
        const dA = `${dObjA.getDate()} ${MONTHS_SHORT[dObjA.getMonth()]}`;
        const dB = `${dObjB.getDate()} ${MONTHS_SHORT[dObjB.getMonth()]}`;

        detailsHtml = `
            <div class="font-bold text-amber-300 text-xs mb-1">⏳ Propuesta de Intercambio</div>
            <div class="text-[11px] leading-snug">
                <span class="text-slate-300">Por ${initInfo.name}:</span><br>
                <div class="mt-1 bg-slate-900/60 rounded px-2 py-1 border border-slate-700 font-mono text-[10.5px]">
                    ${cA.name}: ${paxA} pl. (${dA})<br>
                    <span class="text-amber-400 font-bold">↕️</span> ${cB.name}: ${paxB} pl. (${dB})
                </div>
            </div>
        `;
    } else if (req.type === 'request') {
        const spots = req.isAll ? 'todas las plazas' : `${escapeHtml(req.requestedPax || '?')} pl.`;
        const dObj = parseDateT00(req.date);
        const dStr = `${dObj.getDate()} ${MONTHS_SHORT[dObj.getMonth()]}`;

        detailsHtml = `
            <div class="font-bold text-amber-300 text-xs mb-1">⏳ Petición de plazas</div>
            <div class="text-[11px] leading-snug">
                <b>${initInfo.name}</b> pide <b>${spots}</b> a <b>${targetInfo.name}</b> (${dStr})
            </div>
        `;
    } else if (req.type === 'donation') {
        const spots = req.isFull ? 'el barco completo' : `${escapeHtml(req.requestedPax || req.pax || '?')} pl.`;
        const dObj = parseDateT00(req.date);
        const dStr = `${dObj.getDate()} ${MONTHS_SHORT[dObj.getMonth()]}`;

        detailsHtml = `
            <div class="font-bold text-amber-300 text-xs mb-1">⏳ Cesión de plazas</div>
            <div class="text-[11px] leading-snug">
                <b>${initInfo.name}</b> cede <b>${spots}</b> a <b>${targetInfo.name}</b> (${dStr})
            </div>
        `;
    } else {
        detailsHtml = `<div class="text-[11px] text-slate-300">Solicitud pendiente.</div>`;
    }

    return `
        <div class="pending-section">
            ${detailsHtml}
        </div>
    `;
}

/**
 * Renderiza el Calendario Mensual interactivo (estilo Hoja Bajo de Fuera + Visor).
 */
function renderMonthlyCalendar() {
    const container = getEl('main-view-container');
    if (!container) return;

    const firstDay = new Date(currentYear, currentMonth, 1);
    const lastDay = new Date(currentYear, currentMonth + 1, 0);

    // Ajuste de inicio: Lunes = 0, Domingo = 6
    let startDayOfWeek = firstDay.getDay() - 1;
    if (startDayOfWeek === -1) startDayOfWeek = 6;

    const daysInMonth = lastDay.getDate();
    const todayStr = getStrYMD(new Date());

    let myCenterCode = null;
    if (!isGuestMode && currentUserKey !== 'admin') {
        myCenterCode = USER_CENTER_KEYS[currentUserKey] || null;
    }

    const today = new Date();
    const isCurrentCalendarMonth = (today.getFullYear() === currentYear && today.getMonth() === currentMonth);

    let html = `
    <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-8">
        
        <!-- Barra de Navegación Móvil (Solo en Móvil) -->
        <div class="md:hidden p-2 bg-slate-50 border-b border-slate-200">
            <div class="flex items-center justify-between gap-2 mb-2">
                <div class="flex items-center gap-1.5">
                    <button onclick="changeMonth(-1)" title="Mes anterior" class="w-8 h-8 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 active:bg-slate-200 text-slate-700 flex items-center justify-center font-bold text-sm transition-colors cursor-pointer shadow-2xs">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M15 19l-7-7 7-7"></path></svg>
                    </button>
                    <span class="text-xs font-black text-slate-800 uppercase tracking-tight px-1">
                        ${MONTHS_ES[currentMonth]} ${currentYear}
                    </span>
                    <button onclick="changeMonth(1)" title="Mes siguiente" class="w-8 h-8 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 active:bg-slate-200 text-slate-700 flex items-center justify-center font-bold text-sm transition-colors cursor-pointer shadow-2xs">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 5l7 7-7 7"></path></svg>
                    </button>
                </div>
                <button onclick="goToCurrentMonth()" title="Ir a hoy" class="text-[10px] font-black px-2.5 py-1.5 rounded-lg ${isCurrentCalendarMonth ? 'bg-blue-50 text-blue-600 border border-blue-200' : 'bg-blue-600 text-white shadow-xs'} transition-all flex items-center gap-1 cursor-pointer shrink-0">
                    <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                    <span>Hoy</span>
                </button>
            </div>
            
            <!-- Matriz fija de Meses (2 filas de 6) sin desplazamientos ni fallos -->
            <div class="grid grid-cols-6 gap-1 w-full">
                ${MONTHS_SHORT.map((mShort, idx) => {
                    const isSel = idx === currentMonth;
                    const isTodayMonth = (today.getFullYear() === currentYear && today.getMonth() === idx);
                    const btnClass = isSel
                        ? 'bg-blue-600 text-white font-black shadow-xs ring-1 ring-blue-600'
                        : 'bg-white hover:bg-slate-100 text-slate-700 font-bold border border-slate-200';
                    return `
                        <button onclick="selectMonth(${idx}, ${currentYear})"
                            class="w-full py-1 text-center rounded-md text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center gap-0.5 ${btnClass}">
                            <span>${mShort}</span>
                            ${isTodayMonth && !isSel ? '<span class="w-1 h-1 rounded-full bg-blue-500"></span>' : ''}
                        </button>
                    `;
                }).join('')}
            </div>
        </div>

        <!-- Cabecera del Mes en el Calendario (Solo en Escritorio) -->
        <div class="hidden md:flex px-4 py-3 bg-slate-50 border-b border-slate-200 items-center justify-between">
            <div class="flex items-center gap-2">
                <button onclick="changeMonth(-1)" title="Mes anterior (← Flecha Izquierda)" class="p-1 rounded-lg hover:bg-slate-200 text-slate-500 hover:text-slate-800 transition-colors cursor-pointer flex items-center justify-center">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M15 19l-7-7 7-7"></path></svg>
                </button>
                <h2 class="text-base md:text-lg font-black text-slate-800 uppercase tracking-tight">
                    ${MONTHS_ES[currentMonth]} ${currentYear}
                </h2>
                <button onclick="changeMonth(1)" title="Mes siguiente (→ Flecha Derecha)" class="p-1 rounded-lg hover:bg-slate-200 text-slate-500 hover:text-slate-800 transition-colors cursor-pointer flex items-center justify-center">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 5l7 7-7 7"></path></svg>
                </button>
                <button onclick="goToCurrentMonth()" title="Ir al día de hoy" class="ml-1 text-xs font-black px-2.5 py-1 rounded-lg ${isCurrentCalendarMonth ? 'bg-blue-50 text-blue-600 border border-blue-200' : 'bg-blue-600 hover:bg-blue-700 text-white shadow-xs'} transition-all flex items-center gap-1 cursor-pointer">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                    <span>Hoy</span>
                </button>
            </div>
        </div>

        <!-- Días de la semana -->
        <div class="grid grid-cols-7 border-b border-slate-200 bg-slate-100/70 text-center py-2 md:py-2.5 text-[10px] md:text-xs font-black text-slate-500 uppercase tracking-wider">
            <div>Lun</div>
            <div>Mar</div>
            <div>Mié</div>
            <div>Jue</div>
            <div>Vie</div>
            <div class="text-blue-600">Sáb</div>
            <div class="text-blue-600">Dom</div>
        </div>

        <!-- Matriz de Días del Mes -->
        <div class="grid grid-cols-7 gap-[1px] bg-slate-200">
    `;

    const totalRendered = startDayOfWeek + daysInMonth;
    const remainingSlots = (7 - (totalRendered % 7)) % 7;
    const totalCells = totalRendered + remainingSlots;
    const firstVisibleDate = new Date(currentYear, currentMonth, 1 - startDayOfWeek);

    // Celdas de cada día visible en la cuadrícula (incluyendo días limítrofes del mes anterior y posterior)
    for (let i = 0; i < totalCells; i++) {
        const cellDate = new Date(firstVisibleDate.getFullYear(), firstVisibleDate.getMonth(), firstVisibleDate.getDate() + i);
        const dateStr = getStrYMD(cellDate);
        const isCurrentMonth = cellDate.getMonth() === currentMonth;
        const d = cellDate.getDate();
        const dayData = monthDaysCache[dateStr] || null;
        const summary = getDaySummary(dayData, dateStr);
        const isToday = dateStr === todayStr;

        // Salidas independientes del día (Section 0)
        const daySalidas = getDaySalidas(dayData, dateStr);
        const visibleSalidas = daySalidas.filter(s => {
            return activeCenterFilters.has(normCenter(s.centerCode));
        });

        // Ordenar las salidas: las del usuario logueado primero, luego por plazas descendente
        visibleSalidas.sort((a, b) => {
            const isMyA = a.centerCode === myCenterCode;
            const isMyB = b.centerCode === myCenterCode;
            if (isMyA && !isMyB) return -1;
            if (!isMyA && isMyB) return 1;
            return (b.plazas || b.pax) - (a.plazas || a.pax);
        });

        // Expandir a cajas de visualización (1 caja unificada por centro)
        const displayBoxes = [];
        visibleSalidas.forEach(s => {
            const boxes = getSchoolDisplayBoxes(s);
            displayBoxes.push(...boxes);
        });

        const cellBgClass = isCurrentMonth
            ? 'bg-white hover:bg-slate-50/80'
            : 'bg-slate-100/70 hover:bg-slate-100/90 opacity-60 hover:opacity-100';

        const dayNumberClass = isToday
            ? 'w-5 h-5 md:w-6 md:h-6 rounded-full bg-blue-600 text-white flex items-center justify-center shadow-sm text-[11px] md:text-xs font-black'
            : (isCurrentMonth ? 'text-xs font-black text-slate-700' : 'text-xs font-bold text-slate-400');

        html += `
        <div ondblclick="handleDayDoubleClick('${dateStr}')" data-date="${dateStr}" class="dropzone ${cellBgClass} min-h-[70px] md:min-h-[125px] p-1 md:p-2 flex flex-col justify-start transition-all group relative border-t border-transparent cursor-pointer">
            
            <!-- Cabecera de Celda: Número de Día + Plazas Disponibles -->
            <div class="flex items-center justify-between mb-1 md:mb-1.5 pointer-events-none">
                <span class="${dayNumberClass}">
                    ${d}
                </span>

                <div class="flex items-center gap-1 md:gap-1.5">
                    ${summary.poolAvailable > 0 ? `
                        <span title="${summary.poolAvailable} plazas disponibles hoy" class="text-[8px] md:text-[9px] font-bold px-1 py-0.2 md:px-1.5 md:py-0.5 rounded bg-emerald-100 text-emerald-800 flex items-center gap-0.5 md:gap-1">
                            <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                            <span>${summary.poolAvailable}</span><span class="hidden md:inline">&nbsp;lib.</span>
                        </span>
                    ` : ''}
                    <span class="hidden md:inline text-[9.5px] md:text-[10px] font-bold ${summary.totalOccupied >= summary.totalQuota ? 'text-slate-500' : 'text-slate-400'}">
                        ${summary.totalOccupied > 0 || isCurrentMonth ? `${summary.totalOccupied}/${summary.totalQuota} pl.` : ''}
                    </span>
                </div>
            </div>

            <!-- Lista de Plazas por Centro (En móvil: tags compactos sin caja) -->
            <div class="flex-1 flex flex-wrap md:flex-col gap-1 pt-0.5 content-start">
                ${displayBoxes.length > 0 ? displayBoxes.map(box => {
                    const cInfo = safeCenter(box.centerCode);
                    const isMy = !isGuestMode && normCenter(box.centerCode) === normCenter(myCenterCode);
                    const pendingReq = getPendingRequestForSalida(box.id, dateStr, box.centerCode);
                    const isLocked = !!pendingReq;

                    // Regla Section 4: Centros no pueden arrastrar salidas bloqueadas. Admin puede arrastrar cualquier salida.
                    const canDrag = !isGuestMode && (currentUserKey === 'admin' || (isMy && !isLocked));
                    const dragAttrs = canDrag 
                        ? `draggable="true" data-drag-id="${box.id}" data-drag-date="${dateStr}" data-drag-center="${box.centerCode}" data-drag-pax="${box.totalPlazas}"` 
                        : '';
                    const cursorClass = canDrag ? 'draggable-item cursor-grab active:cursor-grabbing' : (isLocked ? 'cursor-not-allowed opacity-90' : 'cursor-pointer');

                    const pBg = cInfo.pastelBg || 'bg-slate-50';
                    const pBorder = cInfo.pastelBorder || 'border-slate-200';
                    const dotColor = cInfo.hex || '#64748b';
                    const boxLabel = box.isMultiBox ? `${cInfo.name} [${box.boxIndex + 1}/${box.totalBoxes}]` : cInfo.name;

                    const hasNote = box.note && box.note.trim() !== '';
                    const safeNote = hasNote ? escapeHtml(box.note) : '';

                    const noteIndicator = hasNote 
                        ? `<span class="absolute -top-1 -right-1 flex h-2.5 w-2.5 z-20 pointer-events-none"><span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75"></span><span class="relative inline-flex rounded-full h-2.5 w-2.5 bg-yellow-500 border border-white shadow-xs"></span></span>` 
                        : '';

                    const pendingTooltipHtml = isLocked ? formatPendingRequestTooltip(pendingReq, dateStr, box.centerCode) : '';

                    let customTooltip = '';
                    if (hasNote || pendingTooltipHtml) {
                        let tooltipContent = '';
                        if (hasNote) {
                            tooltipContent += `
                                <div class="note-title">Nota adjunta</div>
                                <div class="note-body">${safeNote}</div>
                            `;
                        }
                        if (pendingTooltipHtml) {
                            if (hasNote) tooltipContent += `<div class="my-2 border-t border-slate-700"></div>`;
                            tooltipContent += pendingTooltipHtml;
                        }
                        customTooltip = `<div class="custom-tooltip note-tooltip">${tooltipContent}</div>`;
                    }

                    const mySalidaClass = isMy ? 'my-salida' : '';
                    const mySalidaStyle = isMy ? `style="--my-center-color: ${dotColor};"` : '';
                    const pendingAttr = pendingReq ? `data-pending-request-id="${pendingReq.id}"` : '';

                    return `
                    <div ${dragAttrs} ${pendingAttr}
                         onclick="handleBoatClick(event, '${dateStr}', '${box.id}', '${box.centerCode}')"
                         ondblclick="handleBoatDoubleClick(event, '${dateStr}', '${box.id}', '${box.centerCode}')" 
                         ${mySalidaStyle}
                         class="boat-block select-none w-auto md:w-full h-auto md:h-[28px] rounded md:rounded-lg p-0 md:px-2 md:py-0.5 flex justify-start md:justify-between items-center gap-1 md:gap-1.5 bg-transparent md:${pBg} border-0 md:border md:${pBorder} shadow-none md:shadow-xs hover:brightness-95 ${cursorClass} transition-all ${mySalidaClass}">
                        ${customTooltip}
                        ${noteIndicator}
                        <div class="truncate flex items-center gap-1 pointer-events-none min-w-0">
                            <span class="school-tag min-w-[17px] h-[17px] md:min-w-[18px] md:h-4 px-1 rounded flex items-center justify-center font-black text-[8px] text-white shrink-0 shadow-2xs" style="background-color: ${dotColor}">
                                ${normCenter(box.centerCode)}
                            </span>
                            <span class="hidden md:inline truncate font-bold text-[10.5px] md:text-[11px] text-slate-900 tracking-tight">${boxLabel}</span>
                        </div>
                        <div class="flex items-center gap-0.5 md:gap-1 shrink-0 pointer-events-none pr-0.5">
                            ${isLocked ? `<span class="text-[8px] md:text-[9px] font-bold text-amber-700 bg-amber-100/90 px-0.5 rounded flex items-center" title="Plazas Bloqueadas: Solicitud pendiente">⏳</span>` : ''}
                            <span class="font-black text-[9.5px] md:text-xs text-slate-800 md:text-slate-900">${box.boxPax}</span>
                        </div>
                    </div>
                    `;
                }).join('') : `
                    <div class="h-full flex items-center justify-center text-[9px] md:text-[10px] text-slate-300 italic pointer-events-none select-none py-1 md:py-2">
                        <span class="hidden md:inline">+ Doble clic para añadir</span>
                        <span class="md:hidden text-slate-300 font-bold text-xs">+</span>
                    </div>
                `}
            </div>

        </div>
        `;
    }

    html += `
        </div>
    </div>
    `;

    container.innerHTML = html;
}

/**
 * Renderiza la Vista de Historial de Auditoría.
 */
function renderHistoryView() {
    const container = getEl('main-view-container');
    if (!container) return;

    // Excluir acciones del Administrador para que el historial refleje solo la actividad de los centros
    let filtered = historyLogs.filter(l => l.centerKey !== 'admin' && l.actionType !== 'admin_quota' && l.actionType !== 'import_csv');
    if (historyCenterFilter !== 'all') {
        filtered = filtered.filter(l => {
            const d = l.details || {};
            const k = l.centerKey;
            const c = d.center;
            const uKey = USER_CENTER_KEYS[historyCenterFilter] || historyCenterFilter;
            return k === historyCenterFilter || k === uKey ||
                   c === historyCenterFilter || c === uKey ||
                   d.centerA === historyCenterFilter || d.centerA === uKey ||
                   d.centerB === historyCenterFilter || d.centerB === uKey ||
                   d.fromCenter === historyCenterFilter || d.fromCenter === uKey ||
                   d.toCenter === historyCenterFilter || d.toCenter === uKey ||
                   d.from === historyCenterFilter || d.from === uKey ||
                   d.to === historyCenterFilter || d.to === uKey;
        });
    }

    let html = `
    <div class="max-w-4xl mx-auto w-full flex flex-col gap-4 pb-12">
        <div class="flex items-center justify-between bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <div>
                <h2 class="text-base font-black text-slate-800">Historial de Operaciones</h2>
                <p class="text-xs text-slate-500">Registro cronológico de asignaciones, cesiones y modificaciones en Bajo de Fuera.</p>
            </div>

            <div class="flex items-center gap-2">
                <label class="text-xs font-bold text-slate-600">Centro:</label>
                <select onchange="onHistoryFilterChange(this.value)" class="text-xs font-bold bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1.5 text-slate-700">
                    <option value="all" ${historyCenterFilter === 'all' ? 'selected' : ''}>Todos</option>
                    ${Object.keys(CENTERS).map(c => `
                        <option value="${c}" ${historyCenterFilter === c ? 'selected' : ''}>${CENTERS[c].name}</option>
                    `).join('')}
                </select>
            </div>
        </div>

        <div class="bg-white rounded-xl border border-slate-200 shadow-sm divide-y divide-slate-100 overflow-hidden">
            ${filtered.length === 0 ? `
                <div class="p-8 text-center text-slate-400 text-xs">No hay operaciones registradas todavía con los filtros seleccionados.</div>
            ` : filtered.map(log => {
                const type = log.actionType;
                const d = log.details || {};
                const tsFormatted = formatTimestamp(log.timestamp);

                // Resolver nombre de centro principal
                const centerKey = d.center || d.fromCenter || log.centerKey;
                const cCode = USER_CENTER_KEYS[centerKey] || centerKey;
                const cInfo = safeCenter(cCode);
                const cName = cInfo.name;

                let title = 'Operación';
                let icon = '⚡';
                let desc = '';
                let badgeClass = 'bg-slate-100 text-slate-700';
                let headerPills = `<span class="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${cInfo.color} ${cInfo.text}">${cName}</span>`;

                if (type === 'add_salida' || type === 'add') {
                    title = 'Nueva Salida';
                    icon = '➕';
                    desc = `<b>${cName}</b> añadió una salida a Bajo de Fuera para el <b>${escapeHtml(d.date)}</b> (<b>${escapeHtml(d.slots || d.pax || '—')} plazas</b>).`;
                    badgeClass = 'bg-emerald-100 text-emerald-800';
                } else if (type === 'edit_salida' || type === 'edit') {
                    title = 'Modificar Salida';
                    icon = '✏️';
                    desc = `<b>${cName}</b> modificó su salida en Bajo de Fuera para el <b>${escapeHtml(d.date)}</b> a <b>${escapeHtml(d.slots || d.newPax || '—')} plazas</b>.`;
                    badgeClass = 'bg-blue-100 text-blue-800';
                    if (d.note) desc += `<br><span class="text-slate-400 italic">"${escapeHtml(d.note)}"</span>`;
                } else if (type === 'delete_salida' || type === 'delete') {
                    title = 'Eliminar Salida';
                    icon = '🗑️';
                    desc = `<b>${cName}</b> eliminó su salida de Bajo de Fuera para el <b>${escapeHtml(d.date)}</b>.`;
                    badgeClass = 'bg-rose-100 text-rose-800';
                } else if (type === 'move_salida' || type === 'move') {
                    title = 'Mover Salida';
                    icon = '➡️';
                    desc = `<b>${cName}</b> movió su salida de <b>${escapeHtml(d.slots || '—')} plazas</b> del día <b>${escapeHtml(d.from || d.oldDate)}</b> al <b>${escapeHtml(d.to || d.newDate)}</b>.`;
                    badgeClass = 'bg-indigo-100 text-indigo-800';
                } else if (type === 'swap_salidas' || type === 'swap') {
                    title = 'Intercambio';
                    icon = '🔀';
                    const cACode = USER_CENTER_KEYS[d.centerA] || d.centerA;
                    const cBCode = USER_CENTER_KEYS[d.centerB] || d.centerB;
                    const cAInfo = safeCenter(cACode);
                    const cBInfo = safeCenter(cBCode);
                    headerPills = `<span class="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${cAInfo.color} ${cAInfo.text}">${cAInfo.name}</span><span class="text-slate-400 text-xs mx-1">↔️</span><span class="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${cBInfo.color} ${cBInfo.text}">${cBInfo.name}</span>`;
                    desc = `<b>${cAInfo.name}</b> (${escapeHtml(d.paxA || '—')} pl. el ${escapeHtml(d.dateA)}) permutó su fecha con <b>${cBInfo.name}</b> (${escapeHtml(d.paxB || '—')} pl. el ${escapeHtml(d.dateB)}).`;
                    badgeClass = 'bg-amber-100 text-amber-800';
                } else if (type === 'petition') {
                    title = 'Petición de Plazas';
                    icon = '🤲';
                    const fromCode = USER_CENTER_KEYS[d.fromCenter] || d.fromCenter || log.centerKey;
                    const toCode = USER_CENTER_KEYS[d.toCenter] || d.toCenter;
                    const fromInfo = safeCenter(fromCode);
                    const toInfo = safeCenter(toCode);
                    headerPills = `<span class="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${fromInfo.color} ${fromInfo.text}">${fromInfo.name}</span><span class="text-slate-400 text-xs mx-1">➡️</span><span class="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${toInfo.color} ${toInfo.text}">${toInfo.name}</span>`;
                    const spotsText = d.isFull ? 'el barco completo' : `${escapeHtml(d.slots)} plazas`;
                    desc = `<b>${fromInfo.name}</b> solicitó <b>${spotsText}</b> a <b>${toInfo.name}</b> para el <b>${escapeHtml(d.date)}</b>.`;
                    badgeClass = 'bg-blue-100 text-blue-800';
                    if (d.note) desc += `<br><span class="text-slate-400 italic">"${escapeHtml(d.note)}"</span>`;
                } else if (type === 'transfer_proposal') {
                    title = 'Propuesta de Cesión';
                    icon = '🎁';
                    const fromCode = USER_CENTER_KEYS[d.fromCenter] || d.fromCenter || log.centerKey;
                    const toCode = USER_CENTER_KEYS[d.toCenter] || d.toCenter;
                    const fromInfo = safeCenter(fromCode);
                    const toInfo = safeCenter(toCode);
                    headerPills = `<span class="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${fromInfo.color} ${fromInfo.text}">${fromInfo.name}</span><span class="text-slate-400 text-xs mx-1">➡️</span><span class="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${toInfo.color} ${toInfo.text}">${toInfo.name}</span>`;
                    const spotsText = d.isFull ? 'el barco completo' : `${escapeHtml(d.slots)} plazas`;
                    desc = `<b>${fromInfo.name}</b> ofreció ceder <b>${spotsText}</b> a <b>${toInfo.name}</b> para el <b>${escapeHtml(d.date)}</b>.`;
                    badgeClass = 'bg-amber-100 text-amber-800';
                    if (d.note) desc += `<br><span class="text-slate-400 italic">"${escapeHtml(d.note)}"</span>`;
                } else if (type === 'transfer_salida' || type === 'transfer' || type === 'donation') {
                    title = 'Cesión de Plazas';
                    icon = '🤝';
                    const fromCode = USER_CENTER_KEYS[d.from || d.fromCenter] || d.from || d.fromCenter || log.centerKey;
                    const toCode = USER_CENTER_KEYS[d.to || d.toCenter] || d.to || d.toCenter;
                    const fromInfo = safeCenter(fromCode);
                    const toInfo = safeCenter(toCode);
                    headerPills = `<span class="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${fromInfo.color} ${fromInfo.text}">${fromInfo.name}</span><span class="text-slate-400 text-xs mx-1">➡️</span><span class="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${toInfo.color} ${toInfo.text}">${toInfo.name}</span>`;
                    desc = `<b>${fromInfo.name}</b> transfirió <b>${escapeHtml(d.slots || d.pax)} plazas</b> a <b>${toInfo.name}</b> para el <b>${escapeHtml(d.date)}</b>.`;
                    badgeClass = 'bg-emerald-100 text-emerald-800';
                    if (d.note) desc += `<br><span class="text-slate-400 italic">"${escapeHtml(d.note)}"</span>`;
                } else if (type === 'swap_request') {
                    title = 'Propuesta de Intercambio';
                    icon = '🔀';
                    const cACode = USER_CENTER_KEYS[d.centerA] || d.centerA;
                    const cBCode = USER_CENTER_KEYS[d.centerB] || d.centerB;
                    const cAInfo = safeCenter(cACode);
                    const cBInfo = safeCenter(cBCode);
                    headerPills = `<span class="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${cAInfo.color} ${cAInfo.text}">${cAInfo.name}</span><span class="text-slate-400 text-xs mx-1">↔️</span><span class="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${cBInfo.color} ${cBInfo.text}">${cBInfo.name}</span>`;
                    desc = `<b>${cAInfo.name}</b> (${escapeHtml(d.paxA || '—')} pl. el ${escapeHtml(d.dateA)}) propuso permuta de fechas con <b>${cBInfo.name}</b> (${escapeHtml(d.paxB || '—')} pl. el ${escapeHtml(d.dateB)}).`;
                    badgeClass = 'bg-purple-100 text-purple-800';
                } else if (type === 'release') {
                    title = 'Liberación al Pool';
                    icon = '🔓';
                    desc = `<b>${cName}</b> liberó <b>${escapeHtml(d.slots)} plazas</b> al fondo común (${escapeHtml(d.date)}).`;
                    badgeClass = 'bg-rose-100 text-rose-800';
                    if (d.note) desc += `<br><span class="text-slate-400 italic">"${escapeHtml(d.note)}"</span>`;
                } else if (type === 'claim') {
                    title = 'Plazas del Pool';
                    icon = '📥';
                    desc = `<b>${cName}</b> tomó <b>${escapeHtml(d.slots)} plazas</b> del fondo común (${escapeHtml(d.date)}). Total centro: ${escapeHtml(d.totalEffective || '—')} plazas.`;
                    badgeClass = 'bg-emerald-100 text-emerald-800';
                } else if (type === 'admin_quota') {
                    title = 'Ajuste de Cupo';
                    icon = '⚙️';
                    headerPills = `<span class="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-slate-800 text-white">ADMIN</span>`;
                    desc = `El Administrador modificó el cupo del día <b>${escapeHtml(d.date)}</b> a <b>${escapeHtml(d.newQuota)} plazas</b>.`;
                    badgeClass = 'bg-slate-100 text-slate-800';
                } else if (type === 'import_csv') {
                    title = 'Importación CSV';
                    icon = '📄';
                    headerPills = `<span class="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-slate-800 text-white">ADMIN</span>`;
                    desc = `El Administrador importó el cuadrante oficial (<b>${escapeHtml(d.totalEntries)} asignaciones</b> en <b>${escapeHtml(d.daysCount)} días</b>).`;
                    badgeClass = 'bg-teal-100 text-teal-800';
                } else {
                    title = 'Operación';
                    icon = 'ℹ️';
                    desc = `Acción registrada por <b>${cName}</b>${d.date ? ` para el ${escapeHtml(d.date)}` : ''}.`;
                    badgeClass = 'bg-slate-100 text-slate-700';
                }

                return `
                <div class="p-4 flex items-start gap-3.5 hover:bg-slate-50/80 transition-colors text-xs">
                    <div class="w-9 h-9 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center text-base shrink-0 shadow-2xs">
                        ${icon}
                    </div>
                    <div class="flex-1 min-w-0">
                        <div class="flex flex-wrap items-center gap-2 mb-1">
                            ${headerPills}
                            <span class="px-2 py-0.5 rounded text-[10px] font-bold ${badgeClass}">${title}</span>
                        </div>
                        <p class="text-slate-700 text-[12px] leading-relaxed">${desc}</p>
                    </div>
                    <span class="text-[10px] font-bold text-slate-400 bg-slate-50 px-2 py-1 rounded border border-slate-100 shrink-0">
                        ${tsFormatted}
                    </span>
                </div>
                `;
            }).join('')}
        </div>
    </div>
    `;

    container.innerHTML = html;
}

/**
 * Notificación modal centrada (estilo visor-reserva, sin popups en esquinas).
 */
function showNotification(title, message, isError = false) {
    const modal = getEl('notification-modal');
    if (!modal) return;
    const iconEl = getEl('notification-icon');
    const titleEl = getEl('notification-title');
    const msgEl = getEl('notification-message');

    if (isError) {
        iconEl.className = 'mx-auto w-14 h-14 rounded-full mb-4 flex items-center justify-center bg-red-100 text-red-600';
        iconEl.innerHTML = `<svg class="w-7 h-7" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"></path></svg>`;
        titleEl.className = 'text-xl font-black mb-2 text-red-600';
    } else {
        iconEl.className = 'mx-auto w-14 h-14 rounded-full mb-4 flex items-center justify-center bg-emerald-100 text-emerald-600';
        iconEl.innerHTML = `<svg class="w-7 h-7" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"></path></svg>`;
        titleEl.className = 'text-xl font-black mb-2 text-emerald-600';
    }
    titleEl.textContent = title;
    msgEl.textContent = message;
    showEl('notification-modal');
}

/**
 * Shorthand unificado: Todas las notificaciones y confirmaciones usan exclusivamente
 * el modal centrado de visor-reserva. Se eliminan los popups en la esquina inferior derecha.
 */
function showToast(title, message, isError = false) {
    if (isError || title === 'Cupo Lleno' || title === 'Cupo Excedido' || title === 'Error de Cupo' || title === 'Acción Bloqueada' || title === 'Límite excedido' || title === 'Error') {
        showNotification(title, message, true);
    } else if (title === 'Importación Exitosa' || title === 'Importación Completada' || title === 'Base de Datos Vaciada' || title === 'Contraseña Actualizada') {
        showNotification(title, message, false);
    } else {
        // Quiet background notices (e.g., export in progress, session changes) logged cleanly without popup
        console.log(`[BDF] ${title}: ${message}`);
    }
}

function closeNotification() {
    hideEl('notification-modal');
}

/**
 * Renderiza la Vista de Estadísticas (Idéntica a Visor Reserva).
 */
function renderStats() {
    const container = getEl('main-view-container');
    if (!container) return;

    // Calcular estadísticas por centro a partir de los datos en caché
    const cStats = {};
    let gTotPlazas = 0;
    let gTotBarcos = 0;

    Object.keys(CENTERS).forEach(k => {
        cStats[k] = { plazas: 0, barcos: 0 };
    });

    Object.keys(monthDaysCache).forEach(dateStr => {
        const d = parseDateT00(dateStr);
        if (d.getFullYear() === currentYear && d.getMonth() === currentMonth) {
            const dayData = monthDaysCache[dateStr];
            const salidas = getDaySalidas(dayData, dateStr);
            salidas.forEach(s => {
                const code = normCenter(s.centerCode);
                if (!activeCenterFilters.has(code)) return;
                const p = Number(s.plazas !== undefined ? s.plazas : s.pax) || 0;
                if (p > 0) {
                    if (cStats[code]) {
                        cStats[code].plazas += p;
                        cStats[code].barcos += 1;
                    }
                    gTotPlazas += p;
                    gTotBarcos += 1;
                }
            });
        }
    });

    let gTotMonthQuota = 0;
    const daysInMonthStats = new Date(currentYear, currentMonth + 1, 0).getDate();
    for (let d = 1; d <= daysInMonthStats; d++) {
        const dStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        gTotMonthQuota += getDayQuota(dStr, monthDaysCache[dStr]);
    }

    let html = `
    <div class="max-w-5xl mx-auto w-full flex flex-col gap-3 md:gap-6 pb-6 md:pb-12">
        
        <!-- Cabecera de Estadísticas -->
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 md:gap-4 bg-white p-3 md:p-5 rounded-xl md:rounded-2xl border border-slate-200 shadow-sm">
            <div>
                <h2 class="text-sm md:text-lg font-black text-slate-900 tracking-tight uppercase">Estadísticas Mensuales · Bajo de Fuera</h2>
                <p class="text-[10.5px] md:text-xs text-slate-500 font-medium leading-relaxed">${MONTHS_ES[currentMonth]} ${currentYear} · ${gTotPlazas} plazas asignadas de ${gTotMonthQuota} plazas totales del mes (${gTotMonthQuota > 0 ? ((gTotPlazas / gTotMonthQuota) * 100).toFixed(1) : '0.0'}% ocupación)</p>
            </div>
        </div>

        <!-- Tabla de Estadísticas Global (Adaptada para Móvil y Escritorio) -->
        <div class="w-full overflow-x-auto rounded-xl border border-slate-200 shadow-sm bg-white">
            <table class="w-full text-left min-w-[380px] md:min-w-[700px]">
                <thead>
                    <tr class="border-b border-slate-200 bg-slate-50 md:bg-white text-[9px] md:text-[10px] font-black uppercase tracking-wider text-slate-500">
                        <th class="px-2.5 md:px-5 py-2.5 md:py-4 w-32 md:w-64 border-r border-slate-100">Centro</th>
                        <th class="px-2 md:px-4 py-2.5 md:py-4 text-center border-r border-slate-100">
                            <span class="md:hidden">Barcos</span>
                            <span class="hidden md:inline">Salidas / Barcos</span>
                        </th>
                        <th class="px-2 md:px-4 py-2.5 md:py-4 text-center border-r border-slate-100">
                            <span class="md:hidden">Plazas</span>
                            <span class="hidden md:inline">Plazas Asignadas</span>
                        </th>
                        <th class="px-2 md:px-4 py-2.5 md:py-4 text-center text-blue-600 md:text-blue-500 border-r border-slate-100">
                            <span class="md:hidden">% Total</span>
                            <span class="hidden md:inline">% del Total</span>
                        </th>
                        <th class="px-2 md:px-5 py-2.5 md:py-4 text-center text-slate-500 md:text-slate-600">
                            <span class="md:hidden">Promedio</span>
                            <span class="hidden md:inline">Promedio Pax/Barco</span>
                        </th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                    ${Object.keys(CENTERS).map(k => {
                        const c = CENTERS[k];
                        const s = cStats[k];
                        const pct = gTotPlazas > 0 ? ((s.plazas / gTotPlazas) * 100).toFixed(1) : '0.0';
                        const avg = s.barcos > 0 ? (s.plazas / s.barcos).toFixed(1) : '—';

                        return `
                        <tr class="hover:bg-slate-50 transition-colors bg-white">
                            <td class="px-2.5 md:px-5 py-2 md:py-3.5 border-r border-slate-100">
                                <div class="flex items-center gap-1.5 md:gap-3">
                                    <span class="w-5 h-5 md:w-6 md:h-6 rounded ${c.color} ${c.text} flex items-center justify-center text-[9px] md:text-[10px] font-black shadow-xs shrink-0">${k}</span>
                                    <span class="font-bold text-slate-800 text-[11px] md:text-xs truncate max-w-[95px] md:max-w-none">${c.name}</span>
                                </div>
                            </td>
                            <td class="py-2 md:py-3.5 px-2 md:px-4 text-center text-slate-700 font-semibold text-[11px] md:text-xs border-r border-slate-100">
                                ${s.barcos} <span class="hidden md:inline text-[11px] font-normal text-slate-400">${s.barcos === 1 ? 'barco' : 'barcos'}</span>
                            </td>
                            <td class="py-2 md:py-3.5 px-2 md:px-4 text-center font-bold text-slate-900 text-xs md:text-sm border-r border-slate-100">
                                ${s.plazas}
                            </td>
                            <td class="py-2 md:py-3.5 px-2 md:px-4 text-center text-blue-600 font-bold text-[11px] md:text-xs border-r border-slate-100">
                                ${pct}%
                            </td>
                            <td class="py-2 md:py-3.5 px-2 md:px-4 text-center text-slate-500 font-semibold text-[11px] md:text-xs">
                                ${avg}
                            </td>
                        </tr>
                        `;
                    }).join('')}
                </tbody>
                <tfoot>
                    <tr class="border-t border-slate-200">
                        <td class="px-2.5 md:px-5 py-2.5 md:py-4 text-[9px] md:text-[10px] font-black uppercase tracking-widest bg-[#1f2937] text-white border-r border-slate-700">
                            TOTAL
                        </td>
                        <td class="py-2.5 md:py-4 px-2 md:px-4 text-center bg-[#111827] border-r border-slate-700 font-bold text-slate-200 text-[11px] md:text-xs">
                            ${gTotBarcos} <span class="hidden md:inline font-normal text-slate-400">barcos</span>
                        </td>
                        <td class="py-2.5 md:py-4 px-2 md:px-4 text-center bg-[#3b82f6] text-white font-black text-xs md:text-sm tracking-wide border-r border-slate-700">
                            ${gTotPlazas} <span class="hidden md:inline font-normal text-blue-100">pl.</span>
                        </td>
                        <td class="py-2.5 md:py-4 px-2 md:px-4 text-center bg-[#111827] border-r border-slate-700 font-bold text-blue-400 text-[11px] md:text-xs">
                            100%
                        </td>
                        <td class="py-2.5 md:py-4 px-2 md:px-4 text-center bg-[#111827] text-slate-400 font-medium text-[10px] md:text-xs">
                            ${gTotBarcos > 0 ? (gTotPlazas / gTotBarcos).toFixed(1) : '—'} <span class="hidden md:inline">buzos/barco</span>
                        </td>
                    </tr>
                </tfoot>
            </table>
        </div>

    </div>
    `;

    container.innerHTML = html;
}

/* =========================================================================
   CENTRO DE NOTIFICACIONES Y PETICIONES PENDIENTES
   ========================================================================= */

function updateNotificationsUI() {
    renderHeader();
    const modal = getEl('notifications-modal');
    if (modal && !modal.classList.contains('hidden')) {
        renderNotificationsList();
    }
}

let currentNotificationsTab = 'received';

function switchNotificationsTab(tab) {
    currentNotificationsTab = tab;
    const tabRec = getEl('notif-tab-received');
    const tabSent = getEl('notif-tab-sent');
    if (tabRec && tabSent) {
        if (tab === 'received') {
            tabRec.className = "flex-1 py-2 text-xs font-black text-blue-600 border-b-2 border-blue-600 transition-colors flex items-center justify-center gap-1.5 cursor-pointer";
            tabSent.className = "flex-1 py-2 text-xs font-bold text-slate-500 hover:text-slate-700 transition-colors flex items-center justify-center gap-1.5 cursor-pointer";
        } else {
            tabSent.className = "flex-1 py-2 text-xs font-black text-blue-600 border-b-2 border-blue-600 transition-colors flex items-center justify-center gap-1.5 cursor-pointer";
            tabRec.className = "flex-1 py-2 text-xs font-bold text-slate-500 hover:text-slate-700 transition-colors flex items-center justify-center gap-1.5 cursor-pointer";
        }
    }
    renderNotificationsList();
}

function openNotificationsModal() {
    showEl('notifications-modal');
    switchNotificationsTab(currentNotificationsTab || 'received');
}

function closeNotificationsModal() {
    hideEl('notifications-modal');
}

function renderNotificationsList() {
    const listEl = getEl('notifications-list');
    if (!listEl) return;

    const myCode = USER_CENTER_KEYS[currentUserKey];
    const isAdmin = currentUserKey === 'admin';

    // Solicitudes recibidas
    const receivedRequests = isAdmin
        ? bdfRequests.filter(r => r.status === 'pending')
        : bdfRequests.filter(r => r.status === 'pending' && (r.targetCenter === myCode || (r.type === 'swap' && r.centerB === myCode)));

    // Solicitudes enviadas (Section 6)
    const sentRequests = isAdmin
        ? []
        : bdfRequests.filter(r => r.status === 'pending' && (r.initiatorCenter === myCode || (r.type === 'swap' && r.centerA === myCode)));

    // Actualizar contadores en pestañas
    const countRecEl = getEl('notif-count-received');
    const countSentEl = getEl('notif-count-sent');
    if (countRecEl) {
        countRecEl.textContent = receivedRequests.length;
        countRecEl.classList.toggle('hidden', receivedRequests.length === 0);
    }
    if (countSentEl) {
        countSentEl.textContent = sentRequests.length;
        countSentEl.classList.toggle('hidden', sentRequests.length === 0);
    }

    const activeList = currentNotificationsTab === 'received' ? receivedRequests : sentRequests;

    if (activeList.length === 0) {
        listEl.innerHTML = `
        <div class="text-center py-10 text-slate-400 font-medium">
            <div class="text-3xl mb-2">${currentNotificationsTab === 'received' ? '📭' : '📤'}</div>
            <p class="text-sm font-bold text-slate-600">No hay solicitudes ${currentNotificationsTab === 'received' ? 'recibidas' : 'enviadas'}</p>
            <p class="text-xs text-slate-400 mt-1 max-w-xs mx-auto">${currentNotificationsTab === 'received' 
                ? 'Cuando otra escuela te proponga un intercambio o te solicite plazas, podrás aceptarlo o rechazarlo aquí.' 
                : 'Aquí verás las solicitudes que has enviado a otras escuelas y podrás cancelarlas en cualquier momento.'}
            </p>
        </div>
        `;
        return;
    }

    let html = '';
    activeList.forEach(req => {
        const isSent = currentNotificationsTab === 'sent';

        if (req.type === 'swap') {
            const cA = safeCenter(req.centerA);
            const cB = safeCenter(req.centerB);
            const dA = formatDateShort(parseDateT00(req.dateA));
            const dB = formatDateShort(parseDateT00(req.dateB));

            html += `
            <div class="bg-slate-50 border border-slate-200 rounded-xl p-4 shadow-sm">
                <div class="flex gap-3 mb-3">
                    <span class="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold shrink-0 text-xs">🔄</span>
                    <div class="flex-1 min-w-0">
                        <p class="text-sm font-bold text-slate-800">
                            ${isSent
                                ? `Has propuesto un intercambio a <span class="text-blue-600">${cB.name}</span>:`
                                : `<span class="text-blue-600">${cA.name}</span> te propone un cambio:`
                            }
                        </p>
                        <p class="text-xs text-slate-600 mt-1 leading-relaxed">
                            <b>${cA.name}</b> pasa al <b>${dB}</b> (${escapeHtml(req.paxA)} pl.)${req.retainedPaxA > 0 ? ` [mantiene ${escapeHtml(req.retainedPaxA)} pl. el ${dA}]` : ''} ↔️ <b>${cB.name}</b> pasa al <b>${dA}</b> (${escapeHtml(req.paxB)} pl.)${req.retainedPaxB > 0 ? ` [mantiene ${escapeHtml(req.retainedPaxB)} pl. el ${dB}]` : ''}.
                        </p>
                    </div>
                </div>
                <div class="flex gap-2 mt-3">
                    ${isSent ? `
                        <button onclick="cancelBdfRequest('${req.id}')"
                            class="w-full px-3 py-2 bg-white border border-slate-200 hover:bg-red-50 text-red-600 text-xs font-bold rounded-lg transition-colors cursor-pointer">
                            Cancelar Propuesta
                        </button>
                    ` : `
                        <button onclick="rejectBdfRequest('${req.id}')"
                            class="flex-1 px-3 py-2 bg-white border border-slate-200 hover:bg-red-50 text-red-600 text-xs font-bold rounded-lg transition-colors cursor-pointer">
                            Rechazar
                        </button>
                        <button onclick="acceptBdfRequest('${req.id}', this)"
                            class="flex-1 px-3 py-2 bg-[#25D366] hover:bg-[#1ebd5a] text-white text-xs font-bold rounded-lg transition-colors shadow-sm cursor-pointer">
                            Aceptar Cambio
                        </button>
                    `}
                </div>
            </div>
            `;
        } else if (req.type === 'donation' || req.type === 'request') {
            const isDonation = req.type === 'donation';
            const initC = safeCenter(req.initiatorCenter);
            const targetC = safeCenter(req.targetCenter);
            const dFormatted = formatDateShort(parseDateT00(req.date));
            const spotsText = req.isFull ? 'el barco completo' : `${escapeHtml(req.requestedPax || req.pax)} plazas`;

            const icon = isDonation ? '🎁' : '🤲';
            const iconBg = isDonation ? 'bg-amber-100 text-amber-600' : 'bg-emerald-100 text-emerald-600';

            let titleHtml = '';
            let detailHtml = '';
            if (isSent) {
                titleHtml = isDonation
                    ? `Has ofrecido ceder plazas a <span class="text-amber-600 font-bold">${targetC.name}</span> para el <span class="uppercase border-b border-slate-300 pb-0.5 font-bold">${dFormatted}</span>:`
                    : `Has solicitado plazas a <span class="text-blue-600 font-bold">${targetC.name}</span> para el <span class="uppercase border-b border-slate-300 pb-0.5 font-bold">${dFormatted}</span>:`;
                detailHtml = `${isDonation ? 'Oferta' : 'Petición'}: <b>${spotsText}</b> en <b>Bajo de Fuera</b>.`;
            } else {
                titleHtml = isDonation
                    ? `<span class="text-amber-600 font-bold">${initC.name}</span> te ofrece ceder plazas para el <span class="uppercase border-b border-slate-300 pb-0.5 font-bold">${dFormatted}</span>:`
                    : `<span class="text-emerald-600 font-bold">${initC.name}</span> te pide una donación para el <span class="uppercase border-b border-slate-300 pb-0.5 font-bold">${dFormatted}</span>:`;
                detailHtml = `Petición: <b>${spotsText}</b> de tu salida en <b>Bajo de Fuera</b>.`;
            }

            html += `
            <div class="bg-slate-50 border border-slate-200 rounded-xl p-4 shadow-sm">
                <div class="flex gap-3 mb-3">
                    <span class="w-8 h-8 rounded-full ${iconBg} flex items-center justify-center font-bold shrink-0 text-xs">${icon}</span>
                    <div class="flex-1 min-w-0">
                        <p class="text-sm font-bold text-slate-800 leading-snug">${titleHtml}</p>
                        <p class="text-xs text-slate-600 mt-1">${detailHtml}</p>
                        ${req.note ? `<p class="mt-1 text-xs text-slate-500 italic bg-white p-2 rounded border border-slate-200">"${escapeHtml(req.note)}"</p>` : ''}
                    </div>
                </div>
                <div class="flex gap-2 mt-3">
                    ${isSent ? `
                        <button onclick="cancelBdfRequest('${req.id}')"
                            class="w-full px-3 py-2 bg-white border border-slate-200 hover:bg-red-50 text-red-600 text-xs font-bold rounded-lg transition-colors cursor-pointer">
                            Cancelar ${isDonation ? 'Cesión' : 'Petición'}
                        </button>
                    ` : `
                        <button onclick="rejectBdfRequest('${req.id}')"
                            class="flex-1 px-3 py-2 bg-white border border-slate-200 hover:bg-red-50 text-red-600 text-xs font-bold rounded-lg transition-colors cursor-pointer">
                            ${isDonation ? 'Rechazar' : 'Denegar'}
                        </button>
                        <button onclick="acceptBdfRequest('${req.id}', this)"
                            class="flex-1 px-3 py-2 bg-[#25D366] hover:bg-[#1ebd5a] text-white text-xs font-bold rounded-lg transition-colors shadow-sm cursor-pointer">
                            ${isDonation ? 'Aceptar Plazas' : 'Ceder Plazas'}
                        </button>
                    `}
                </div>
            </div>
            `;
        }
    });

    listEl.innerHTML = html;
}

// Iluminación sincronizada de ambas salidas implicadas en una propuesta al hacer hover
document.addEventListener('mouseover', (e) => {
    const boat = e.target.closest('.boat-block[data-pending-request-id]');
    const currentHoveredReqId = boat ? boat.getAttribute('data-pending-request-id') : null;

    document.querySelectorAll('.pending-pair-glow').forEach(el => {
        if (!currentHoveredReqId || el.getAttribute('data-pending-request-id') !== currentHoveredReqId) {
            el.classList.remove('pending-pair-glow');
        }
    });

    if (currentHoveredReqId) {
        document.querySelectorAll(`.boat-block[data-pending-request-id="${currentHoveredReqId}"]`).forEach(el => {
            el.classList.add('pending-pair-glow');
        });
    }
});

document.addEventListener('mouseleave', () => {
    document.querySelectorAll('.pending-pair-glow').forEach(el => {
        el.classList.remove('pending-pair-glow');
    });
});

/* =========================================================================
   MODAL DE AYUDA (3 PESTAÑAS: SALIDAS, TRUEQUES Y UTILIDADES)
   ========================================================================= */

let helpActiveTab = 'salidas';

function setHelpTab(tabKey) {
    helpActiveTab = tabKey;
    renderHelpModalContent();
}

function renderHelpModalContent() {
    const tabs = ['salidas', 'colaboracion', 'utilidades'];
    tabs.forEach(t => {
        const el = getEl(`help-tab-${t}`);
        if (el) {
            if (t === helpActiveTab) {
                el.className = "py-2 px-2 text-center rounded-lg text-xs font-black bg-white text-blue-700 shadow-xs border border-slate-200 cursor-pointer transition-all";
            } else {
                el.className = "py-2 px-2 text-center rounded-lg text-xs font-bold text-slate-500 hover:text-slate-800 cursor-pointer transition-all";
            }
        }
    });

    const container = getEl('help-tab-content-container');
    if (!container) return;

    let html = '';

    if (helpActiveTab === 'salidas') {
        html = `
            <div class="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2.5">
                <div class="flex items-center gap-2 text-slate-900 font-black text-xs">
                    <span class="w-2.5 h-2.5 rounded-full bg-blue-600"></span>
                    <span>Gestión de Salidas</span>
                </div>

                <div class="space-y-2 text-slate-600">
                    <div class="p-2.5 bg-white rounded-lg border border-slate-200">
                        <span class="font-black text-slate-800 block text-xs mb-1">
                            ✏️ Modificar Plazas o Nota
                        </span>
                        <p class="text-[11.5px] leading-relaxed">
                            Haz <b>clic</b> sobre la tarjeta de tu centro en el calendario. Podrás modificar las plazas asignadas (de 1 a 15) o añadir una nota informativa opcional (hasta 150 caracteres).
                        </p>
                    </div>

                    <div class="p-2.5 bg-white rounded-lg border border-slate-200">
                        <span class="font-black text-slate-800 block text-xs mb-1">
                            ➕ Añadir Nueva Salida
                        </span>
                        <p class="text-[11.5px] leading-relaxed">
                            Haz <b>doble clic</b> en la celda de cualquier día autorizado en el calendario. Si hay cupo libre y menos de 2 barcos, podrás inscribir tu salida al instante.
                        </p>
                    </div>

                    <div class="p-2.5 bg-white rounded-lg border border-slate-200">
                        <span class="font-black text-slate-800 block text-xs mb-1">
                            🗑️ Eliminar Salida
                        </span>
                        <p class="text-[11.5px] leading-relaxed">
                            Abre el menú de tu salida haciendo <b>clic</b> en ella y selecciona <i>"Eliminar Salida Completamente"</i> para liberar tus plazas al cupo disponible.
                        </p>
                    </div>
                </div>
            </div>
        `;
    } else if (helpActiveTab === 'colaboracion') {
        html = `
            <div class="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2.5">
                <div class="flex items-center gap-2 text-slate-900 font-black text-xs">
                    <span class="w-2.5 h-2.5 rounded-full bg-purple-600"></span>
                    <span>Cesiones y Trueques entre Centros</span>
                </div>

                <div class="p-2.5 bg-white rounded-lg border border-slate-200 space-y-1">
                    <span class="font-black text-amber-800 flex items-center gap-1 text-xs">
                        <span>🎁 Ceder Plazas (Traspaso Directo)</span>
                    </span>
                    <p class="text-slate-600 text-[11.5px] leading-relaxed">
                        Haz <b>clic</b> en tu salida y selecciona <i>"🎁 Ceder Plazas"</i>. Indica cuántas plazas deseas transferir y a qué centro colaborador. El traspaso se realiza en 1 solo paso sin intercambio de fechas.
                    </p>
                </div>

                <div class="p-2.5 bg-white rounded-lg border border-slate-200 space-y-1">
                    <span class="font-black text-purple-800 flex items-center gap-1 text-xs">
                        <span>🔄 Intercambio de Salidas (Trueque entre fechas)</span>
                    </span>
                    <p class="text-slate-600 text-[11.5px] leading-relaxed">
                        <b>Arrastra con el ratón</b> (Drag & Drop) la tarjeta de tu salida y suéltala sobre otra fecha en el calendario, o haz <b>clic</b> en <i>"🔄 Proponer Intercambio"</i> dentro de su menú.
                    </p>
                </div>

                <div class="p-2.5 bg-white rounded-lg border border-slate-200 space-y-1">
                    <span class="font-black text-slate-800 flex items-center gap-1 text-xs">
                        <span>🔔 Notificaciones WhatsApp y Sala de Espera</span>
                    </span>
                    <p class="text-slate-600 text-[11.5px] leading-relaxed">
                        Al enviar la propuesta, se envía un mensaje automático al grupo de WhatsApp. La salida queda bloqueada con un reloj de arena <span class="font-mono font-bold text-amber-600">⏳</span>. El centro receptor verá la campana roja <span class="font-mono font-bold text-red-600">🔔</span> en la cabecera para <b>Aceptar</b> o <b>Rechazar</b>.
                    </p>
                </div>
            </div>
        `;
    } else if (helpActiveTab === 'utilidades') {
        html = `
            <div class="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2.5">
                <div class="flex items-center gap-2 text-slate-900 font-black text-xs">
                    <span class="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
                    <span>Navegación, PWA e Informes</span>
                </div>

                <div class="p-2.5 bg-white rounded-lg border border-slate-200 space-y-1">
                    <span class="font-black text-slate-800 block text-xs">
                        📅 Botón "Hoy"
                    </span>
                    <p class="text-slate-600 text-[11.5px] leading-relaxed">
                        Haz <b>clic</b> en el botón <b>"Hoy"</b> situado junto a las flechas del mes para regresar instantáneamente a la fecha actual con un resaltado visual animado en la cuadrícula.
                    </p>
                </div>

                <div class="p-2.5 bg-white rounded-lg border border-slate-200 space-y-1">
                    <span class="font-black text-slate-800 block text-xs">
                        🖨️ Descargar Informes (PDF y CSV)
                    </span>
                    <p class="text-slate-600 text-[11.5px] leading-relaxed">
                        Haz <b>clic</b> en el icono de impresora en la cabecera para generar un documento PDF vectorial listo para imprimir o descargar un archivo CSV con las asignaciones.
                    </p>
                </div>

                <div class="p-2.5 bg-white rounded-lg border border-slate-200 space-y-1">
                    <span class="font-black text-slate-800 block text-xs">
                        ⚡ Modo Fuera de Línea (PWA)
                    </span>
                    <p class="text-slate-600 text-[11.5px] leading-relaxed">
                        La aplicación funciona sin conexión gracias al Service Worker y a la persistencia local de Firestore. Si pierdes la cobertura, verás el aviso de <i>Modo lectura</i> y podrás seguir consultando el calendario. Al reconectarte, los datos se sincronizarán solos.
                    </p>
                </div>
            </div>
        `;
    }

    container.innerHTML = html;
}
