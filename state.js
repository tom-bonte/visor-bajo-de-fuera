/**
 * @file state.js
 * @description Gestor de estado global y cálculos de plazas para Visor Bajo de Fuera.
 */

/* =========================================================================
   ESTADO GLOBAL
   ========================================================================= */

/** Fecha seleccionada (por defecto, hoy). */
let currentDate = new Date();

/**
 * Año y mes visualizados en el calendario. Se parte SIEMPRE del año real del
 * sistema: la temporada no está fijada a ningún año concreto, de modo que el
 * visor sigue funcionando en 2027 y siguientes sin tocar el código.
 */
let currentYear = currentDate.getFullYear();
let currentMonth = currentDate.getMonth();

/** Estado de acordeones de años en la barra lateral (año => boolean). */
let expandedYears = { [currentYear]: true };

/** Modo de visualización activo: 'mensual' | 'estadisticas' | 'historial'. */
let activeViewMode = 'mensual';

/** Conjunto de códigos de centros activos en el filtro (por defecto todos). */
let activeCenterFilters = new Set(Object.keys(CENTERS));

/** Caché de datos de días cargados desde Firestore ('YYYY-MM-DD' => dayData). */
let monthDaysCache = {};

/** Lista de logs de auditoría cargados desde Firestore. */
let historyLogs = [];

/** Lista de solicitudes pendientes (intercambios y peticiones) en tiempo real. */
let bdfRequests = [];

/** Clave del usuario autenticado ('admin', 'mangamar', 'moondive', etc., o 'guest'). */
let currentUserKey = 'guest';

/** Indicador de modo consulta sin autenticar. */
let isGuestMode = true;


/** Paginación y filtros del Historial */
let historyCurrentPage = 1;
const historyItemsPerPage = 25;
let historyCenterFilter = 'all';

/* =========================================================================
   CÁLCULOS DE PLAZAS Y BALANCES
   ========================================================================= */

/**
 * Calcula el balance de plazas de un centro en una fecha determinada.
 * @param {string} centerCode
 * @param {Object} dayData
 */
function getCenterBalance(centerCode, dayData) {
    const normTarget = normCenter(centerCode);
    if (!dayData) {
        return {
            centerCode,
            initialSlots: 0,
            transferredOut: 0,
            transferredIn: 0,
            releasedToPool: 0,
            claimedFromPool: 0,
            effectiveSlots: 0
        };
    }

    // Si ya dispone del modelo consolidado de salidas (Section 0)
    if (Array.isArray(dayData.salidas)) {
        const salidas = getDaySalidas(dayData, dayData.date || '');
        const mySalida = salidas.find(s => normCenter(s.centerCode) === normTarget);
        const slots = mySalida ? (Number(mySalida.plazas !== undefined ? mySalida.plazas : mySalida.pax) || 0) : 0;
        return {
            centerCode,
            initialSlots: slots,
            transferredOut: 0,
            transferredIn: 0,
            releasedToPool: 0,
            claimedFromPool: 0,
            effectiveSlots: Math.max(0, slots)
        };
    }

    const allocations = dayData.allocations || {};
    let initialSlots = (allocations[centerCode] && allocations[centerCode].initialSlots) || 0;

    const isMatch = c => normCenter(c) === normTarget;

    const transfers = dayData.transfers || [];
    let transferredOut = 0;
    let transferredIn = 0;
    transfers.forEach(t => {
        const slots = Number(t.slots) || 0;
        if (isMatch(t.from)) transferredOut += slots;
        if (isMatch(t.to)) transferredIn += slots;
    });

    const releases = dayData.releases || [];
    let releasedToPool = 0;
    releases.forEach(r => {
        if (isMatch(r.from)) releasedToPool += (Number(r.slots) || 0);
    });

    const claims = dayData.claims || [];
    let claimedFromPool = 0;
    claims.forEach(c => {
        if (isMatch(c.by)) claimedFromPool += (Number(c.slots) || 0);
    });

    const effectiveSlots = initialSlots - transferredOut + transferredIn - releasedToPool + claimedFromPool;

    return {
        centerCode,
        initialSlots,
        transferredOut,
        transferredIn,
        releasedToPool,
        claimedFromPool,
        effectiveSlots: Math.max(0, effectiveSlots)
    };
}

/**
 * Sanitiza una nota de usuario eliminando textos automáticos del sistema.
 * @param {string} n
 * @returns {string}
 */
function sanitizeUserNote(n) {
    if (!n || typeof n !== 'string') return '';
    const trimmed = n.trim();
    if (trimmed === 'Importado' || 
        trimmed.startsWith('Intercambio con') || 
        trimmed.startsWith('Movida del') || 
        trimmed.startsWith('Cedidas por')) {
        return '';
    }
    return trimmed;
}

/**
 * Obtiene la lista de registros de plazas de un día (Section 0: máximo UN registro por escuela por día).
 * Si existen datos antiguos o múltiples filas, consolida y suma las plazas por centro.
 * @param {Object} dayData
 * @param {string} dateStr
 * @returns {Array<{id: string, date: string, centerCode: string, plazas: number, pax: number, note: string, updatedAt?: string}>}
 */
function getDaySalidas(dayData, dateStr = '') {
    if (!dayData) return [];
    const targetDate = dayData.date || dateStr;
    const byCenter = {};

    // 1. Si ya tiene el array `salidas`
    if (Array.isArray(dayData.salidas)) {
        dayData.salidas.forEach(s => {
            const rawCode = s.centerCode || s.center;
            const normCode = normCenter(rawCode);
            if (!normCode) return;
            const p = Number(s.plazas !== undefined ? s.plazas : s.pax) || 0;
            if (p <= 0) return;

            const cleanNote = sanitizeUserNote(s.note);
            if (!byCenter[normCode]) {
                byCenter[normCode] = {
                    id: s.id || `plazas_${targetDate}_${normCode}`,
                    date: targetDate,
                    centerCode: normCode,
                    plazas: 0,
                    pax: 0,
                    note: cleanNote,
                    updatedAt: s.updatedAt || s.createdAt || ''
                };
            }
            byCenter[normCode].plazas += p;
            byCenter[normCode].pax += p;
            if (cleanNote && !byCenter[normCode].note) byCenter[normCode].note = cleanNote;
        });
    } else if (dayData.allocations) {
        // Compatibilidad hacia atrás con el modelo previo de allocations
        Object.keys(dayData.allocations).forEach(code => {
            const item = dayData.allocations[code];
            const p = Number(item?.initialSlots) || 0;
            if (p > 0) {
                const normCode = normCenter(code);
                const cleanNote = sanitizeUserNote(item.note);
                if (!byCenter[normCode]) {
                    byCenter[normCode] = {
                        id: `plazas_${targetDate}_${normCode}`,
                        date: targetDate,
                        centerCode: normCode,
                        plazas: 0,
                        pax: 0,
                        note: cleanNote,
                        updatedAt: item.addedAt || ''
                    };
                }
                byCenter[normCode].plazas += p;
                byCenter[normCode].pax += p;
            }
        });
    }

    return Object.values(byCenter);
}

/**
 * Genera las cajas visuales para el calendario (1 caja única por centro con el total de sus plazas).
 * Un centro puede tener tantas plazas como cupo disponible haya (hasta 13 o 30).
 * @param {Object} schoolRecord - { date, centerCode, plazas, pax, ... }
 * @returns {Array<Object>} Lista de cajas de visualización con { boxPax, totalPlazas, boxIndex, totalBoxes, isMultiBox }
 */
function getSchoolDisplayBoxes(schoolRecord) {
    const total = Number(schoolRecord.plazas !== undefined ? schoolRecord.plazas : schoolRecord.pax) || 0;
    if (total <= 0) return [];

    return [{
        ...schoolRecord,
        boxPax: total,
        totalPlazas: total,
        boxIndex: 0,
        totalBoxes: 1,
        isMultiBox: false
    }];
}

/**
 * Comprueba si una salida está bloqueada por una solicitud o intercambio pendiente.
 * @param {string} salidaId
 * @param {string} dateStr
 * @param {string} centerCode
 * @returns {Object|null} El objeto de la solicitud pendiente si está bloqueada, o null.
 */
function getPendingRequestForSalida(salidaId, dateStr = '', centerCode = '') {
    if (!bdfRequests || bdfRequests.length === 0) return null;
    const todayStr = getStrYMD(new Date());
    if (dateStr && dateStr < todayStr) return null;
    const normCode = normCenter(centerCode);
    
    return bdfRequests.find(r => {
        if (r.status !== 'pending') return false;
        
        // Tipo swap
        if (r.type === 'swap') {
            if (r.salidaIdA && r.salidaIdA === salidaId) return true;
            if (r.salidaIdB && r.salidaIdB === salidaId) return true;
            if (r.salidaA?.id && r.salidaA.id === salidaId) return true;
            if (r.salidaB?.id && r.salidaB.id === salidaId) return true;
            if (r.dateA === dateStr && (r.centerA === normCode || r.centerA === centerCode)) return true;
            if (r.dateB === dateStr && (r.centerB === normCode || r.centerB === centerCode)) return true;
        }
        
        // Tipo petición de plazas a otra escuela (request)
        if (r.type === 'request') {
            if (r.targetSalidaId && r.targetSalidaId === salidaId) return true;
            if (r.date === dateStr && (r.targetCenter === normCode || r.targetCenter === centerCode)) return true;
        }

        // Tipo cesión directa (donation)
        if (r.type === 'donation') {
            if (r.givingSalidaId && r.givingSalidaId === salidaId) return true;
            if (r.targetSalidaId && r.targetSalidaId === salidaId) return true;
            if (r.date === dateStr && (r.initiatorCenter === normCode || r.initiatorCenter === centerCode)) return true;
        }

        return false;
    }) || null;
}

/**
 * Calcula el resumen general de un día (total asignado, libres en pool, etc.).
 * @param {Object} dayData
 * @param {string} dateStr
 */
function getDaySummary(dayData, dateStr = '') {
    const targetDate = dayData?.date || dateStr;
    const totalQuota = getDayQuota(targetDate, dayData);

    if (!dayData) {
        return {
            totalQuota,
            totalInitial: 0,
            poolAvailable: totalQuota,
            totalOccupied: 0,
            boatsCount: 0
        };
    }

    const salidas = getDaySalidas(dayData, targetDate);
    const totalOccupied = salidas.reduce((sum, s) => sum + (Number(s.pax) || 0), 0);
    const boatsCount = salidas.length;
    const poolAvailable = Math.max(0, totalQuota - totalOccupied);

    return {
        totalQuota,
        totalInitial: totalOccupied,
        poolAvailable,
        totalOccupied,
        boatsCount
    };
}
