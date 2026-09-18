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
    } else if (activeViewMode === 'semanal') {
        renderWeeklyCalendar();
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
    const btnLoginMobile = getEl('btn-login-mobile');
    const userMenuWrapper = getEl('user-menu-wrapper');
    const userDropdown = getEl('user-dropdown');

    // Actualizar clases de las pestañas superiores
    const tabMensual = getEl('tab-mensual');
    const tabSemanal = getEl('tab-semanal');
    const tabStats = getEl('tab-estadisticas');
    if (tabMensual) {
        tabMensual.className = activeViewMode === 'mensual' 
            ? "px-3 md:px-5 py-1.5 md:py-2 tab-active flex items-center gap-1.5 transition-all whitespace-nowrap"
            : "px-3 md:px-5 py-1.5 md:py-2 tab-inactive flex items-center gap-1.5 transition-all whitespace-nowrap";
    }
    if (tabSemanal) {
        tabSemanal.className = activeViewMode === 'semanal'
            ? "px-3 md:px-5 py-1.5 md:py-2 tab-active flex items-center gap-1.5 transition-all whitespace-nowrap"
            : "px-3 md:px-5 py-1.5 md:py-2 tab-inactive flex items-center gap-1.5 transition-all whitespace-nowrap";
    }
    if (tabStats) {
        tabStats.className = activeViewMode === 'estadisticas'
            ? "px-3 md:px-5 py-1.5 md:py-2 tab-active flex items-center gap-1.5 transition-all whitespace-nowrap"
            : "px-3 md:px-5 py-1.5 md:py-2 tab-inactive flex items-center gap-1.5 transition-all whitespace-nowrap";
    }

    if (btnLoginHeader) btnLoginHeader.classList.toggle('hidden', !isGuest);
    if (btnLoginMobile) btnLoginMobile.classList.toggle('hidden', !isGuest);
    if (userMenuWrapper) userMenuWrapper.classList.toggle('hidden', isGuest);

    // Actualizar badge del usuario
    const badgeInfo = BADGE_INFO[currentUserKey] || BADGE_INFO['guest'];
    const badgeInitialEl = getEl('badge-initial');
    const badgeNameEl = getEl('badge-name');
    const userBadgeBtn = getEl('user-badge-button');

    if (badgeInitialEl) badgeInitialEl.innerText = badgeInfo.initial;
    if (badgeNameEl) badgeNameEl.innerText = badgeInfo.name;
    if (userBadgeBtn) {
        userBadgeBtn.className = `rounded-[4px] px-2 py-1 md:px-3 md:py-2 text-[9px] md:text-[10px] font-bold shadow-sm flex items-center gap-1.5 md:gap-2 hover:opacity-90 transition-opacity ${badgeInfo.color} ${badgeInfo.text}`;
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
            html += `<button onclick="triggerImport(); toggleUserMenu();" class="text-left px-4 py-2.5 text-sm font-bold text-blue-700 hover:bg-blue-50 transition-colors flex items-center gap-2"><svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg> Importar CSV</button>`;
            html += `<button onclick="promptEmptyData(); toggleUserMenu();" class="text-left px-4 py-2.5 text-sm font-bold text-red-600 hover:bg-red-50 transition-colors flex items-center gap-2"><svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg> Vaciar Datos</button><div class="h-px bg-slate-100 my-1"></div>`;
        }

        html += `<button onclick="openChangePasswordModal(); toggleUserMenu();" class="text-left px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 transition-colors flex items-center gap-2"><svg class="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4v-3.252a1 1 0 01.293-.707l8.96-8.96A6 6 0 0115 7z"></path></svg> Cambiar contraseña</button>`;
        html += `<button onclick="logout(); toggleUserMenu();" class="text-left px-4 py-2.5 text-sm font-bold text-red-500 hover:bg-red-50 transition-colors flex items-center gap-2">Cerrar sesión</button>`;

        userDropdown.innerHTML = html;
    }

    // Botón volver al calendario si estamos en historial o estadísticas
    const btnBack = getEl('btn-back-to-calendar');
    if (btnBack) btnBack.classList.toggle('hidden', activeViewMode === 'mensual' || activeViewMode === 'semanal');
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
    const initInfo = CENTERS[req.initiatorCenter] || { name: req.initiatorCenter || 'Centro' };
    const targetInfo = CENTERS[req.targetCenter] || { name: req.targetCenter || 'Centro' };

    let detailsHtml = '';

    if (req.type === 'swap') {
        const cA = CENTERS[req.centerA] || { name: req.centerA || 'Centro A' };
        const cB = CENTERS[req.centerB] || { name: req.centerB || 'Centro B' };
        const paxA = req.paxA !== undefined ? req.paxA : (req.salidaA?.pax || '?');
        const paxB = req.paxB !== undefined ? req.paxB : (req.salidaB?.pax || '?');

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
        const spots = req.isAll ? 'todas las plazas' : `${req.requestedPax || '?'} pl.`;
        const dObj = parseDateT00(req.date);
        const dStr = `${dObj.getDate()} ${MONTHS_SHORT[dObj.getMonth()]}`;

        detailsHtml = `
            <div class="font-bold text-amber-300 text-xs mb-1">⏳ Petición de plazas</div>
            <div class="text-[11px] leading-snug">
                <b>${initInfo.name}</b> pide <b>${spots}</b> a <b>${targetInfo.name}</b> (${dStr})
            </div>
        `;
    } else if (req.type === 'donation') {
        const spots = req.isFull ? 'el barco completo' : `${req.requestedPax || req.pax || '?'} pl.`;
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

    let html = `
    <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-8">
        
        <!-- Cabecera del Mes en el Calendario -->
        <div class="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <div class="flex items-center gap-2">
                <h2 class="text-base md:text-lg font-black text-slate-800 uppercase tracking-tight">
                    ${MONTHS_ES[currentMonth]} ${currentYear}
                </h2>
                <span class="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-100 text-blue-700 uppercase tracking-wider">
                    Bajo de Fuera
                </span>
            </div>
        </div>

        <!-- Días de la semana -->
        <div class="grid grid-cols-7 border-b border-slate-200 bg-slate-100/70 text-center py-2.5 text-[11px] md:text-xs font-black text-slate-500 uppercase tracking-wider">
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

    // Celdas vacías del principio de mes
    for (let i = 0; i < startDayOfWeek; i++) {
        html += `<div class="bg-slate-50/40 min-h-[110px] md:min-h-[130px] p-1.5"></div>`;
    }

    // Celdas de cada día del mes
    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const dayData = monthDaysCache[dateStr] || null;
        const summary = getDaySummary(dayData, dateStr);
        const isToday = dateStr === todayStr;

        // Salidas independientes del día (Section 0)
        const daySalidas = getDaySalidas(dayData, dateStr);
        const visibleSalidas = daySalidas.filter(s => {
            return activeCenterFilters.has(s.centerCode) || (s.centerCode === 'MD' && activeCenterFilters.has('B'));
        });

        // Ordenar las salidas: las del usuario logueado primero, luego por plazas descendente
        visibleSalidas.sort((a, b) => {
            const isMyA = a.centerCode === myCenterCode;
            const isMyB = b.centerCode === myCenterCode;
            if (isMyA && !isMyB) return -1;
            if (!isMyA && isMyB) return 1;
            return (b.plazas || b.pax) - (a.plazas || a.pax);
        });

        // Expandir a cajas de visualización de máximo 12 plazas (Section 0)
        const displayBoxes = [];
        visibleSalidas.forEach(s => {
            const boxes = getSchoolDisplayBoxes(s);
            displayBoxes.push(...boxes);
        });

        html += `
        <div ondblclick="handleDayDoubleClick('${dateStr}')" data-date="${dateStr}" class="dropzone bg-white min-h-[105px] md:min-h-[125px] p-1.5 md:p-2 flex flex-col justify-start hover:bg-slate-50/80 transition-colors group relative border-t border-transparent cursor-pointer">
            
            <!-- Cabecera de Celda: Número de Día + Plazas Ocupadas / Cupo -->
            <div class="flex items-center justify-between mb-1.5 pointer-events-none">
                <span class="text-xs font-black ${isToday ? 'w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center shadow-sm' : 'text-slate-700'}">
                    ${d}
                </span>

                <div class="flex items-center gap-1.5">
                    ${summary.totalOccupied > 0 && summary.poolAvailable > 0 ? `
                        <span title="${summary.poolAvailable} plazas disponibles hoy" class="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 flex items-center gap-1">
                            <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                            ${summary.poolAvailable} lib.
                        </span>
                    ` : ''}
                    <span class="text-[9.5px] md:text-[10px] font-bold ${summary.totalOccupied >= summary.totalQuota ? 'text-slate-500' : 'text-slate-400'}">
                        ${summary.totalOccupied}/${summary.totalQuota} pl.
                    </span>
                </div>
            </div>

            <!-- Lista de Cajas de Plazas (Máximo 12 plazas por caja - Section 0) -->
            <div class="flex-1 flex flex-col gap-1 pt-0.5">
                ${displayBoxes.length > 0 ? displayBoxes.map(box => {
                    const isMy = box.centerCode === myCenterCode;
                    const cInfo = CENTERS[box.centerCode] || { name: box.centerCode, emoji: '⛵' };
                    const pendingReq = getPendingRequestForSalida(box.id, dateStr, box.centerCode);
                    const isLocked = !!pendingReq;

                    // Regla Section 4: Centros no pueden arrastrar salidas bloqueadas. Admin puede arrastrar cualquier salida.
                    const canDrag = !isGuestMode && (currentUserKey === 'admin' || (isMy && !isLocked));
                    const dragAttrs = canDrag 
                        ? `draggable="true" data-drag-id="${box.id}" data-drag-date="${dateStr}" data-drag-center="${box.centerCode}" data-drag-pax="${box.totalPlazas}"` 
                        : '';
                    const cursorClass = canDrag ? 'draggable-item cursor-grab active:cursor-grabbing' : (isLocked ? 'cursor-not-allowed opacity-90' : 'cursor-pointer');
                    const actionTip = isLocked 
                        ? 'Plazas bloqueadas por solicitud pendiente.' 
                        : ((currentUserKey === 'admin' || isMy) ? 'Doble clic para editar o ceder.' : 'Doble clic para pedir plazas.');

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
                         class="boat-block select-none w-full h-[25px] md:h-[28px] rounded-lg px-1.5 md:px-2 py-0.5 flex justify-between items-center ${pBg} border ${pBorder} shadow-xs hover:brightness-95 ${cursorClass} transition-all ${mySalidaClass}">
                        ${customTooltip}
                        ${noteIndicator}
                        <div class="truncate flex items-center gap-1.5 pointer-events-none min-w-0">
                            <span class="min-w-[18px] px-1 h-4 rounded-md flex items-center justify-center font-black text-[8px] text-white shrink-0 shadow-2xs" style="background-color: ${dotColor}">
                                ${box.centerCode === 'B' ? 'MD' : box.centerCode}
                            </span>
                            <span class="truncate font-bold text-[10.5px] md:text-[11px] text-slate-900 tracking-tight">${boxLabel}</span>
                        </div>
                        <div class="flex items-center gap-1 shrink-0 pointer-events-none pr-0.5">
                            ${isLocked ? `<span class="text-[9px] font-bold text-amber-700 bg-amber-100/90 px-1 rounded flex items-center gap-0.5" title="Plazas Bloqueadas: Solicitud pendiente">⏳</span>` : ''}
                            <span class="font-black text-[11px] md:text-xs text-slate-900">${box.boxPax}</span>
                        </div>
                    </div>
                    `;
                }).join('') : `
                    <div class="h-full flex items-center justify-center text-[10px] text-slate-300 italic pointer-events-none select-none py-2">
                        + Doble clic para añadir
                    </div>
                `}
            </div>

        </div>
        `;
    }

    // Celdas vacías al final si hicieran falta
    const totalRendered = startDayOfWeek + daysInMonth;
    const remainingSlots = (7 - (totalRendered % 7)) % 7;
    for (let i = 0; i < remainingSlots; i++) {
        html += `<div class="bg-slate-50/40 min-h-[110px] md:min-h-[130px] p-1.5"></div>`;
    }

    html += `
        </div>
    </div>
    `;

    container.innerHTML = html;
}

/**
 * Renderiza el Calendario Semanal interactivo (Vista espaciosa de 7 días, ideal para pantallas menos saturadas).
 */
function renderWeeklyCalendar() {
    const container = getEl('main-view-container');
    if (!container) return;

    if (!currentDate || isNaN(currentDate.getTime())) {
        currentDate = new Date(currentYear, currentMonth, 14);
    }

    const monday = getMonday(currentDate);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    const weekNum = getWeekNumber(monday);
    const todayStr = getStrYMD(new Date());

    let myCenterCode = null;
    if (!isGuestMode && currentUserKey !== 'admin') {
        myCenterCode = USER_CENTER_KEYS[currentUserKey] || null;
    }

    // Texto de rango de fechas de la semana
    const mMonthStr = MONTHS_SHORT[monday.getMonth()].toUpperCase();
    const sMonthStr = MONTHS_SHORT[sunday.getMonth()].toUpperCase();
    const rangeText = (monday.getMonth() === sunday.getMonth())
        ? `${monday.getDate()} al ${sunday.getDate()} de ${MONTHS_ES[monday.getMonth()]} ${monday.getFullYear()}`
        : `${monday.getDate()} ${mMonthStr} al ${sunday.getDate()} ${sMonthStr} ${sunday.getFullYear()}`;

    // Calcular estadísticas de la semana completa
    let weekTotalOccupied = 0;
    let weekTotalQuota = 0;

    const daysData = [];
    for (let i = 0; i < 7; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        const dStr = getStrYMD(d);
        const dayData = monthDaysCache[dStr] || null;
        const summary = getDaySummary(dayData, dStr);
        weekTotalOccupied += summary.totalOccupied;
        weekTotalQuota += summary.totalQuota;
        daysData.push({ d, dStr, dayData, summary });
    }

    let html = `
    <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-8">
        
        <!-- Cabecera de la Semana: Navegación + Título + Estadísticas -->
        <div class="px-4 py-3 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div class="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-start">
                <div class="flex items-center gap-1.5">
                    <button onclick="changeWeek(-1)" class="p-1.5 md:px-2.5 md:py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold transition-all flex items-center gap-1 shadow-2xs cursor-pointer" title="Semana anterior">
                        <svg class="w-4 h-4 text-slate-600" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/></svg>
                        <span class="hidden md:inline">Anterior</span>
                    </button>
                    <button onclick="goToCurrentWeek()" class="px-2.5 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 text-xs font-bold transition-all shadow-2xs cursor-pointer">
                        Hoy
                    </button>
                    <button onclick="changeWeek(1)" class="p-1.5 md:px-2.5 md:py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold transition-all flex items-center gap-1 shadow-2xs cursor-pointer" title="Semana siguiente">
                        <span class="hidden md:inline">Siguiente</span>
                        <svg class="w-4 h-4 text-slate-600" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>
                    </button>
                </div>

                <span class="text-[10px] font-black px-2 py-1 rounded bg-blue-100 text-blue-800 uppercase tracking-wider shrink-0">
                    Semana ${weekNum}
                </span>
            </div>

            <div class="text-center sm:text-left">
                <h2 class="text-sm md:text-base font-black text-slate-800 uppercase tracking-tight">
                    ${rangeText}
                </h2>
            </div>

            <div class="flex items-center gap-2 shrink-0">
                <span class="text-xs font-bold text-slate-600 bg-white border border-slate-200 px-3 py-1 rounded-lg shadow-2xs">
                    Total Semana: <b class="text-blue-600 font-black">${weekTotalOccupied}</b> / ${weekTotalQuota} pl.
                </span>
            </div>
        </div>

        <!-- Matriz Semanal de 7 Columnas -->
        <div class="grid grid-cols-1 md:grid-cols-7 gap-[1px] bg-slate-200">
    `;

    daysData.forEach(({ d, dStr, dayData, summary }) => {
        const isToday = dStr === todayStr;
        const dayOfWeekIndex = d.getDay(); // 0 is Sunday, 1 is Monday...
        const dayName = DAYS_ES[dayOfWeekIndex];
        const isWeekend = (dayOfWeekIndex === 0 || dayOfWeekIndex === 6);

        // Salidas / Plazas independientes del día
        const daySalidas = getDaySalidas(dayData, dStr);
        const visibleSalidas = daySalidas.filter(s => {
            return activeCenterFilters.has(s.centerCode) || (s.centerCode === 'MD' && activeCenterFilters.has('B'));
        });

        // Ordenar: usuario logueado primero, luego por plazas descendente
        visibleSalidas.sort((a, b) => {
            const isMyA = a.centerCode === myCenterCode;
            const isMyB = b.centerCode === myCenterCode;
            if (isMyA && !isMyB) return -1;
            if (!isMyA && isMyB) return 1;
            return (b.plazas || b.pax) - (a.plazas || a.pax);
        });

        // Expandir a cajas de visualización de máximo 12 plazas (Section 0)
        const displayBoxes = [];
        visibleSalidas.forEach(s => {
            const boxes = getSchoolDisplayBoxes(s);
            displayBoxes.push(...boxes);
        });

        const occupancyPct = summary.totalQuota > 0 ? Math.min(100, Math.round((summary.totalOccupied / summary.totalQuota) * 100)) : 0;
        let progressBg = 'bg-blue-600';
        if (occupancyPct >= 100) progressBg = 'bg-slate-700';
        else if (occupancyPct >= 80) progressBg = 'bg-emerald-500';

        html += `
        <div ondblclick="handleDayDoubleClick('${dStr}')" data-date="${dStr}" 
             class="dropzone bg-white min-h-[260px] md:min-h-[440px] p-2.5 md:p-3 flex flex-col justify-start hover:bg-slate-50/80 transition-colors group relative cursor-pointer">
            
            <!-- Cabecera de la Columna Diaria -->
            <div class="border-b border-slate-100 pb-2.5 mb-2.5 pointer-events-none">
                <div class="flex items-center justify-between">
                    <div>
                        <span class="text-[10px] font-black uppercase tracking-wider ${isWeekend ? 'text-blue-600' : 'text-slate-400'}">
                            ${dayName}
                        </span>
                        <div class="flex items-baseline gap-1.5">
                            <span class="text-lg md:text-xl font-black ${isToday ? 'text-blue-600' : 'text-slate-800'}">
                                ${d.getDate()}
                            </span>
                            <span class="text-xs font-bold text-slate-500 uppercase">
                                ${MONTHS_SHORT[d.getMonth()]}
                            </span>
                        </div>
                    </div>

                    ${isToday ? `
                        <span class="px-2 py-0.5 rounded-full text-[9px] font-black bg-blue-600 text-white shadow-xs">
                            HOY
                        </span>
                    ` : ''}
                </div>

                <!-- Barra de Cupo y Capacidad Disponible -->
                <div class="mt-2">
                    <div class="flex items-center justify-between text-[10px] font-bold text-slate-500 mb-1">
                        <span>${summary.totalOccupied} / ${summary.totalQuota} pl.</span>
                        ${summary.poolAvailable > 0 ? `
                            <span class="text-[9px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.2 rounded border border-emerald-200">
                                ${summary.poolAvailable} libres
                            </span>
                        ` : ''}
                    </div>
                    <div class="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                        <div class="${progressBg} h-full transition-all duration-300 rounded-full" style="width: ${occupancyPct}%"></div>
                    </div>
                </div>
            </div>

            <!-- Lista de Plazas Asignadas (Cajas de visualización máx 12 - Section 0) -->
            <div class="flex-1 flex flex-col gap-1.5 pt-0.5">
                ${displayBoxes.length > 0 ? displayBoxes.map(box => {
                    const isMy = box.centerCode === myCenterCode;
                    const cInfo = CENTERS[box.centerCode] || { name: box.centerCode, emoji: '⛵' };
                    const pendingReq = getPendingRequestForSalida(box.id, dStr, box.centerCode);
                    const isLocked = !!pendingReq;

                    const canDrag = !isGuestMode && (currentUserKey === 'admin' || (isMy && !isLocked));
                    const dragAttrs = canDrag 
                        ? `draggable="true" data-drag-id="${box.id}" data-drag-date="${dStr}" data-drag-center="${box.centerCode}" data-drag-pax="${box.totalPlazas}"` 
                        : '';
                    const cursorClass = canDrag ? 'draggable-item cursor-grab active:cursor-grabbing' : (isLocked ? 'cursor-not-allowed opacity-90' : 'cursor-pointer');
                    const actionTip = isLocked 
                        ? 'Plazas bloqueadas por solicitud pendiente.' 
                        : ((currentUserKey === 'admin' || isMy) ? 'Doble clic para editar o ceder.' : 'Doble clic para pedir plazas.');

                    const pBg = cInfo.pastelBg || 'bg-slate-50';
                    const pBorder = cInfo.pastelBorder || 'border-slate-200';
                    const dotColor = cInfo.hex || '#64748b';
                    const boxLabel = box.isMultiBox ? `${cInfo.name} [${box.boxIndex + 1}/${box.totalBoxes}]` : cInfo.name;

                    const hasNote = box.note && box.note.trim() !== '';
                    const safeNote = hasNote ? escapeHtml(box.note) : '';

                    const noteIndicator = hasNote 
                        ? `<span class="absolute -top-1 -right-1 flex h-2.5 w-2.5 z-20 pointer-events-none"><span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75"></span><span class="relative inline-flex rounded-full h-2.5 w-2.5 bg-yellow-500 border border-white shadow-xs"></span></span>` 
                        : '';

                    const pendingTooltipHtml = isLocked ? formatPendingRequestTooltip(pendingReq, dStr, box.centerCode) : '';

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
                         onclick="handleBoatClick(event, '${dStr}', '${box.id}', '${box.centerCode}')"
                         ondblclick="handleBoatDoubleClick(event, '${dStr}', '${box.id}', '${box.centerCode}')" 
                         ${mySalidaStyle}
                         class="boat-block select-none w-full rounded-xl p-2 flex items-center justify-between ${pBg} border ${pBorder} shadow-xs hover:shadow-sm hover:brightness-98 ${cursorClass} transition-all ${mySalidaClass}">
                        ${customTooltip}
                        ${noteIndicator}
                        <div class="flex items-center gap-2 pointer-events-none min-w-0 pr-1">
                            <span class="w-6 h-6 rounded-lg flex items-center justify-center font-black text-[10px] text-white shrink-0 shadow-2xs" style="background-color: ${dotColor}">
                                ${box.centerCode === 'B' ? 'MD' : box.centerCode}
                            </span>
                            <div class="truncate">
                                <span class="font-black text-xs text-slate-900 tracking-tight block leading-tight truncate">${boxLabel}</span>
                            </div>
                        </div>
                        <div class="flex items-center gap-1.5 shrink-0 pointer-events-none">
                            ${isLocked ? `<span class="text-xs font-bold text-amber-700 bg-amber-100/90 px-1 py-0.5 rounded" title="Plazas bloqueadas">⏳</span>` : ''}
                            <span class="font-black text-xs px-2 py-0.5 bg-white rounded-md border border-slate-200/80 text-slate-800 shadow-2xs">
                                ${box.boxPax} <span class="text-[9px] font-bold text-slate-400">pl.</span>
                            </span>
                        </div>
                    </div>
                    `;
                }).join('') : `
                    <div class="h-full flex flex-col items-center justify-center text-center p-4 text-slate-300 hover:text-slate-400 text-xs italic pointer-events-none select-none transition-colors">
                        <svg class="w-6 h-6 mb-1.5 opacity-30" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg>
                        <span>+ Doble clic para añadir</span>
                    </div>
                `}
            </div>

        </div>
        `;
    });

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
                const cInfo = CENTERS[cCode] || CENTERS[centerKey] || { name: centerKey || 'Centro', color: 'bg-slate-600', text: 'text-white' };
                const cName = cInfo.name;

                let title = 'Operación';
                let icon = '⚡';
                let desc = '';
                let badgeClass = 'bg-slate-100 text-slate-700';
                let headerPills = `<span class="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${cInfo.color} ${cInfo.text}">${cName}</span>`;

                if (type === 'add_salida' || type === 'add') {
                    title = 'Nueva Salida';
                    icon = '➕';
                    desc = `<b>${cName}</b> añadió una salida a Bajo de Fuera para el <b>${d.date}</b> (<b>${d.slots || d.pax || '—'} plazas</b>).`;
                    badgeClass = 'bg-emerald-100 text-emerald-800';
                } else if (type === 'edit_salida' || type === 'edit') {
                    title = 'Modificar Salida';
                    icon = '✏️';
                    desc = `<b>${cName}</b> modificó su salida en Bajo de Fuera para el <b>${d.date}</b> a <b>${d.slots || d.newPax || '—'} plazas</b>.`;
                    badgeClass = 'bg-blue-100 text-blue-800';
                    if (d.note) desc += `<br><span class="text-slate-400 italic">"${escapeHtml(d.note)}"</span>`;
                } else if (type === 'delete_salida' || type === 'delete') {
                    title = 'Eliminar Salida';
                    icon = '🗑️';
                    desc = `<b>${cName}</b> eliminó su salida de Bajo de Fuera para el <b>${d.date}</b>.`;
                    badgeClass = 'bg-rose-100 text-rose-800';
                } else if (type === 'move_salida' || type === 'move') {
                    title = 'Mover Salida';
                    icon = '➡️';
                    desc = `<b>${cName}</b> movió su salida de <b>${d.slots || '—'} plazas</b> del día <b>${d.from || d.oldDate}</b> al <b>${d.to || d.newDate}</b>.`;
                    badgeClass = 'bg-indigo-100 text-indigo-800';
                } else if (type === 'swap_salidas' || type === 'swap') {
                    title = 'Intercambio';
                    icon = '🔀';
                    const cACode = USER_CENTER_KEYS[d.centerA] || d.centerA;
                    const cBCode = USER_CENTER_KEYS[d.centerB] || d.centerB;
                    const cAInfo = CENTERS[cACode] || { name: d.centerA, color: 'bg-slate-600', text: 'text-white' };
                    const cBInfo = CENTERS[cBCode] || { name: d.centerB, color: 'bg-slate-600', text: 'text-white' };
                    headerPills = `<span class="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${cAInfo.color} ${cAInfo.text}">${cAInfo.name}</span><span class="text-slate-400 text-xs mx-1">↔️</span><span class="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${cBInfo.color} ${cBInfo.text}">${cBInfo.name}</span>`;
                    desc = `<b>${cAInfo.name}</b> (${d.paxA || '—'} pl. el ${d.dateA}) permutó su fecha con <b>${cBInfo.name}</b> (${d.paxB || '—'} pl. el ${d.dateB}).`;
                    badgeClass = 'bg-amber-100 text-amber-800';
                } else if (type === 'petition') {
                    title = 'Petición de Plazas';
                    icon = '🤲';
                    const fromCode = USER_CENTER_KEYS[d.fromCenter] || d.fromCenter || log.centerKey;
                    const toCode = USER_CENTER_KEYS[d.toCenter] || d.toCenter;
                    const fromInfo = CENTERS[fromCode] || { name: fromCode, color: 'bg-slate-600', text: 'text-white' };
                    const toInfo = CENTERS[toCode] || { name: toCode, color: 'bg-slate-600', text: 'text-white' };
                    headerPills = `<span class="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${fromInfo.color} ${fromInfo.text}">${fromInfo.name}</span><span class="text-slate-400 text-xs mx-1">➡️</span><span class="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${toInfo.color} ${toInfo.text}">${toInfo.name}</span>`;
                    const spotsText = d.isFull ? 'el barco completo' : `${d.slots} plazas`;
                    desc = `<b>${fromInfo.name}</b> solicitó <b>${spotsText}</b> a <b>${toInfo.name}</b> para el <b>${d.date}</b>.`;
                    badgeClass = 'bg-blue-100 text-blue-800';
                    if (d.note) desc += `<br><span class="text-slate-400 italic">"${escapeHtml(d.note)}"</span>`;
                } else if (type === 'transfer_proposal') {
                    title = 'Propuesta de Cesión';
                    icon = '🎁';
                    const fromCode = USER_CENTER_KEYS[d.fromCenter] || d.fromCenter || log.centerKey;
                    const toCode = USER_CENTER_KEYS[d.toCenter] || d.toCenter;
                    const fromInfo = CENTERS[fromCode] || { name: fromCode, color: 'bg-slate-600', text: 'text-white' };
                    const toInfo = CENTERS[toCode] || { name: toCode, color: 'bg-slate-600', text: 'text-white' };
                    headerPills = `<span class="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${fromInfo.color} ${fromInfo.text}">${fromInfo.name}</span><span class="text-slate-400 text-xs mx-1">➡️</span><span class="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${toInfo.color} ${toInfo.text}">${toInfo.name}</span>`;
                    const spotsText = d.isFull ? 'el barco completo' : `${d.slots} plazas`;
                    desc = `<b>${fromInfo.name}</b> ofreció ceder <b>${spotsText}</b> a <b>${toInfo.name}</b> para el <b>${d.date}</b>.`;
                    badgeClass = 'bg-amber-100 text-amber-800';
                    if (d.note) desc += `<br><span class="text-slate-400 italic">"${escapeHtml(d.note)}"</span>`;
                } else if (type === 'transfer_salida' || type === 'transfer' || type === 'donation') {
                    title = 'Cesión de Plazas';
                    icon = '🤝';
                    const fromCode = USER_CENTER_KEYS[d.from || d.fromCenter] || d.from || d.fromCenter || log.centerKey;
                    const toCode = USER_CENTER_KEYS[d.to || d.toCenter] || d.to || d.toCenter;
                    const fromInfo = CENTERS[fromCode] || { name: fromCode, color: 'bg-slate-600', text: 'text-white' };
                    const toInfo = CENTERS[toCode] || { name: toCode, color: 'bg-slate-600', text: 'text-white' };
                    headerPills = `<span class="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${fromInfo.color} ${fromInfo.text}">${fromInfo.name}</span><span class="text-slate-400 text-xs mx-1">➡️</span><span class="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${toInfo.color} ${toInfo.text}">${toInfo.name}</span>`;
                    desc = `<b>${fromInfo.name}</b> transfirió <b>${d.slots || d.pax} plazas</b> a <b>${toInfo.name}</b> para el <b>${d.date}</b>.`;
                    badgeClass = 'bg-emerald-100 text-emerald-800';
                    if (d.note) desc += `<br><span class="text-slate-400 italic">"${escapeHtml(d.note)}"</span>`;
                } else if (type === 'swap_request') {
                    title = 'Propuesta de Intercambio';
                    icon = '🔀';
                    const cACode = USER_CENTER_KEYS[d.centerA] || d.centerA;
                    const cBCode = USER_CENTER_KEYS[d.centerB] || d.centerB;
                    const cAInfo = CENTERS[cACode] || { name: d.centerA, color: 'bg-slate-600', text: 'text-white' };
                    const cBInfo = CENTERS[cBCode] || { name: d.centerB, color: 'bg-slate-600', text: 'text-white' };
                    headerPills = `<span class="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${cAInfo.color} ${cAInfo.text}">${cAInfo.name}</span><span class="text-slate-400 text-xs mx-1">↔️</span><span class="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${cBInfo.color} ${cBInfo.text}">${cBInfo.name}</span>`;
                    desc = `<b>${cAInfo.name}</b> (${d.paxA || '—'} pl. el ${d.dateA}) propuso permuta de fechas con <b>${cBInfo.name}</b> (${d.paxB || '—'} pl. el ${d.dateB}).`;
                    badgeClass = 'bg-purple-100 text-purple-800';
                } else if (type === 'release') {
                    title = 'Liberación al Pool';
                    icon = '🔓';
                    desc = `<b>${cName}</b> liberó <b>${d.slots} plazas</b> al fondo común (${d.date}).`;
                    badgeClass = 'bg-rose-100 text-rose-800';
                    if (d.note) desc += `<br><span class="text-slate-400 italic">"${escapeHtml(d.note)}"</span>`;
                } else if (type === 'claim') {
                    title = 'Plazas del Pool';
                    icon = '📥';
                    desc = `<b>${cName}</b> tomó <b>${d.slots} plazas</b> del fondo común (${d.date}). Barco: ${d.totalEffective || '—'}/12 plazas.`;
                    badgeClass = 'bg-emerald-100 text-emerald-800';
                } else if (type === 'admin_quota') {
                    title = 'Ajuste de Cupo';
                    icon = '⚙️';
                    headerPills = `<span class="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-slate-800 text-white">ADMIN</span>`;
                    desc = `El Administrador modificó el cupo del día <b>${d.date}</b> a <b>${d.newQuota} plazas</b>.`;
                    badgeClass = 'bg-slate-100 text-slate-800';
                } else if (type === 'import_csv') {
                    title = 'Importación CSV';
                    icon = '📄';
                    headerPills = `<span class="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-slate-800 text-white">ADMIN</span>`;
                    desc = `El Administrador importó el cuadrante oficial (<b>${d.totalEntries} asignaciones</b> en <b>${d.daysCount} días</b>).`;
                    badgeClass = 'bg-teal-100 text-teal-800';
                } else {
                    title = 'Operación';
                    icon = 'ℹ️';
                    desc = `Acción registrada por <b>${cName}</b>${d.date ? ` para el ${d.date}` : ''}.`;
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
            Object.keys(CENTERS).forEach(k => {
                if (!activeCenterFilters.has(k)) return;
                const bal = getCenterBalance(k, dayData);
                if (bal.effectiveSlots > 0) {
                    cStats[k].plazas += bal.effectiveSlots;
                    cStats[k].barcos += 1;
                    gTotPlazas += bal.effectiveSlots;
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
    <div class="max-w-5xl mx-auto w-full flex flex-col gap-6 pb-12">
        
        <!-- Cabecera de Estadísticas -->
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
            <div>
                <h2 class="text-lg font-black text-slate-900 tracking-tight uppercase">Estadísticas Mensuales · Bajo de Fuera</h2>
                <p class="text-xs text-slate-500 font-medium">${MONTHS_ES[currentMonth]} ${currentYear} · ${gTotPlazas} plazas asignadas de ${gTotMonthQuota} plazas totales del mes (${gTotMonthQuota > 0 ? ((gTotPlazas / gTotMonthQuota) * 100).toFixed(1) : '0.0'}% ocupación)</p>
            </div>

            <!-- Selector de Mes de Estadísticas -->
            <div class="flex items-center gap-2">
                <label class="text-xs font-bold text-slate-600">Mes:</label>
                <select onchange="onMonthDropdownChange(this.value); renderStats();" class="text-xs font-bold bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-slate-800 cursor-pointer">
                    ${MONTHS_ES.map((name, idx) => `
                        <option value="${idx}" ${idx === currentMonth ? 'selected' : ''}>${name} ${currentYear}</option>
                    `).join('')}
                </select>
            </div>
        </div>

        <!-- Tabla de Estadísticas Global (Estilo Visor Reserva) -->
        <div class="w-full overflow-x-auto rounded-xl border border-slate-200 shadow-sm bg-white">
            <table class="w-full text-left min-w-[700px]">
                <thead>
                    <tr class="border-b border-slate-200 bg-white">
                        <th class="px-5 py-4 text-[10px] font-black uppercase tracking-widest text-slate-500 w-64 border-r border-slate-100">Centro</th>
                        <th class="px-4 py-4 text-center text-[10px] font-black uppercase tracking-widest text-slate-600 border-r border-slate-100">Salidas / Barcos</th>
                        <th class="px-4 py-4 text-center text-[10px] font-black uppercase tracking-widest text-slate-600 border-r border-slate-100">Plazas Asignadas</th>
                        <th class="px-4 py-4 text-center text-[10px] font-black uppercase tracking-widest text-blue-500 border-r border-slate-100">% del Total</th>
                        <th class="px-5 py-4 text-center text-[10px] font-black uppercase tracking-widest text-slate-600">Promedio Pax/Barco</th>
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
                            <td class="px-5 py-3.5 border-r border-slate-100">
                                <div class="flex items-center gap-3">
                                    <span class="w-6 h-6 rounded ${c.color} ${c.text} flex items-center justify-center text-[10px] font-black shadow-xs shrink-0">${k}</span>
                                    <span class="font-bold text-slate-800 text-xs whitespace-nowrap">${c.name}</span>
                                </div>
                            </td>
                            <td class="py-3.5 px-4 text-center text-slate-700 font-semibold text-xs border-r border-slate-100">
                                ${s.barcos} ${s.barcos === 1 ? 'barco' : 'barcos'}
                            </td>
                            <td class="py-3.5 px-4 text-center font-bold text-slate-900 text-sm border-r border-slate-100">
                                ${s.plazas}
                            </td>
                            <td class="py-3.5 px-4 text-center text-blue-600 font-bold text-xs border-r border-slate-100">
                                ${pct}%
                            </td>
                            <td class="py-3.5 px-4 text-center text-slate-500 font-semibold text-xs">
                                ${avg}
                            </td>
                        </tr>
                        `;
                    }).join('')}
                </tbody>
                <tfoot>
                    <tr class="border-t border-slate-200">
                        <td class="px-5 py-4 text-[10px] font-black uppercase tracking-widest bg-[#1f2937] text-white border-r border-slate-700">
                            TOTALES MES
                        </td>
                        <td class="py-4 px-4 text-center bg-[#111827] border-r border-slate-700 font-bold text-slate-200 text-xs">
                            ${gTotBarcos} barcos
                        </td>
                        <td class="py-4 px-4 text-center bg-[#3b82f6] text-white font-black text-sm tracking-wide border-r border-slate-700">
                            ${gTotPlazas} plazas
                        </td>
                        <td class="py-4 px-4 text-center bg-[#111827] border-r border-slate-700 font-bold text-blue-400 text-xs">
                            100%
                        </td>
                        <td class="py-4 px-4 text-center bg-[#111827] text-slate-400 font-medium text-xs">
                            ${gTotBarcos > 0 ? (gTotPlazas / gTotBarcos).toFixed(1) : '—'} buzos/barco
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
            const cA = CENTERS[req.centerA] || { name: req.centerA };
            const cB = CENTERS[req.centerB] || { name: req.centerB };
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
                            <b>${cA.name}</b> pasa al <b>${dB}</b> (${req.paxA} pl.)${req.retainedPaxA > 0 ? ` [mantiene ${req.retainedPaxA} pl. el ${dA}]` : ''} ↔️ <b>${cB.name}</b> pasa al <b>${dA}</b> (${req.paxB} pl.)${req.retainedPaxB > 0 ? ` [mantiene ${req.retainedPaxB} pl. el ${dB}]` : ''}.
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
                        <button onclick="acceptBdfRequest('${req.id}')"
                            class="flex-1 px-3 py-2 bg-[#25D366] hover:bg-[#1ebd5a] text-white text-xs font-bold rounded-lg transition-colors shadow-sm cursor-pointer">
                            Aceptar Cambio
                        </button>
                    `}
                </div>
            </div>
            `;
        } else if (req.type === 'donation' || req.type === 'request') {
            const isDonation = req.type === 'donation';
            const initC = CENTERS[req.initiatorCenter] || { name: req.initiatorCenter };
            const targetC = CENTERS[req.targetCenter] || { name: req.targetCenter };
            const dFormatted = formatDateShort(parseDateT00(req.date));
            const spotsText = req.isFull ? 'el barco completo' : `${req.requestedPax || req.pax} plazas`;

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
                        <button onclick="acceptBdfRequest('${req.id}')"
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
