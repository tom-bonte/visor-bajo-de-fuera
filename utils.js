/**
 * @file utils.js
 * @description Funciones auxiliares puras para manipulación de DOM, fechas y sanitización.
 */

/** Shorthand document.getElementById */
const getEl = id => document.getElementById(id);

/** Conjunto de IDs de modales actualmente abiertos para control de scroll del fondo */
const activeOpenModals = new Set();

function lockBodyScroll(id) {
    if (id) activeOpenModals.add(id);
    if (activeOpenModals.size > 0) {
        document.body.classList.add('overflow-hidden');
    }
}

function unlockBodyScroll(id) {
    if (id) activeOpenModals.delete(id);
    if (activeOpenModals.size === 0) {
        document.body.classList.remove('overflow-hidden');
    }
}

/** Oculta un elemento añadiendo 'hidden' y forzando display none */
const hideEl = id => {
    const el = getEl(id);
    if (!el) return;
    el.classList.add('hidden');
    el.style.display = 'none';
    if (id && id.includes('modal')) {
        unlockBodyScroll(id);
    }
};

/** Muestra un elemento quitando 'hidden' y restaurando display */
const showEl = id => {
    const el = getEl(id);
    if (!el) return;
    el.classList.remove('hidden');
    if (el.classList.contains('flex')) {
        el.style.display = 'flex';
    } else {
        el.style.display = '';
    }
    if (id && id.includes('modal')) {
        lockBodyScroll(id);
    }
};

/** Alterna visibilidad sincronizada con showEl / hideEl */
const toggleVis = id => {
    const el = getEl(id);
    if (!el) return;
    const isHidden = el.classList.contains('hidden') || el.style.display === 'none';
    if (isHidden) {
        showEl(id);
    } else {
        hideEl(id);
    }
};

/**
 * Parsea una fecha YYYY-MM-DD en hora local (evita desfases UTC).
 * @param {string} dateStr
 * @returns {Date}
 */
const parseDateT00 = dateStr => new Date(dateStr + "T00:00:00");

/**
 * Convierte un objeto Date en formato estricto YYYY-MM-DD.
 * @param {Date} d
 * @returns {string}
 */
const getStrYMD = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Formatea una fecha en texto completo legible en español.
 * Ej: "Miércoles, 17 de Septiembre de 2026"
 */
function formatDateFull(date) {
    if (!(date instanceof Date) || isNaN(date.getTime())) return '';
    const dayName = DAYS_ES[date.getDay()];
    const dayNum = date.getDate();
    const monthName = MONTHS_ES[date.getMonth()];
    const year = date.getFullYear();
    // Capitalizar la primera letra del día y mes
    const capDay = dayName.charAt(0) + dayName.slice(1).toLowerCase();
    const capMonth = monthName.charAt(0) + monthName.slice(1).toLowerCase();
    return `${capDay}, ${dayNum} de ${capMonth} de ${year}`;
}

/**
 * Formatea una fecha en formato corto: "17 sep 2026"
 */
function formatDateShort(date) {
    if (!(date instanceof Date) || isNaN(date.getTime())) return '';
    return `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]} ${date.getFullYear()}`;
}

/**
 * Formatea un timestamp de Firestore en fecha/hora amigable.
 */
function formatTimestamp(ts) {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    if (isNaN(d.getTime())) return '';
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    return `${day}/${month} ${hours}:${mins}`;
}

/**
 * Escapa cadenas para prevenir inyección HTML en renderizados dinámicos.
 */
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Sanitiza y limita la longitud de una nota a un máximo estricto (por defecto 150 caracteres).
 * @param {string} str
 * @param {number} [maxLen=150]
 * @returns {string}
 */
function sanitizeNote(str, maxLen = 150) {
    if (str === null || str === undefined) return '';
    const trimmed = String(str).trim();
    return trimmed.length > maxLen ? trimmed.substring(0, maxLen) : trimmed;
}

/**
 * Actualiza dinámicamente el contador visual de caracteres de un input/textarea.
 * @param {string} inputId
 * @param {string} counterId
 * @param {number} [maxLen=150]
 */
function updateNoteCounter(inputId, counterId, maxLen = 150) {
    const input = getEl(inputId);
    const counter = getEl(counterId);
    if (!input || !counter) return;
    const len = input.value ? input.value.length : 0;
    counter.textContent = `${len} / ${maxLen}`;
    if (len >= maxLen) {
        counter.classList.add('text-red-500', 'font-bold');
        counter.classList.remove('text-slate-400');
    } else {
        counter.classList.remove('text-red-500', 'font-bold');
        counter.classList.add('text-slate-400');
    }
}

/**
 * Limita un número entre min y max.
 */
const clamp = (val, min, max) => Math.min(Math.max(val, min), max);

/**
 * Calcula y devuelve el lunes de la semana correspondiente a una fecha.
 * @param {Date|string|number} d
 * @returns {Date}
 */
function getMonday(d) {
    const date = new Date(d);
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(date.setDate(diff));
    monday.setHours(0, 0, 0, 0);
    return monday;
}

/**
 * Calcula el número de semana ISO-8601 para una fecha.
 * @param {Date} d
 * @returns {number}
 */
function getWeekNumber(d) {
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}

/**
 * Normaliza nombres o códigos de centros a la clave oficial ('MD', 'H', 'M', 'N', 'P', 'D', 'C', 'X').
 * Soporta 'Moondive' -> 'MD', 'Divers' -> 'D', etc.
 */
function normalizeCenterCode(val) {
    if (!val) return null;
    const str = String(val).trim().toUpperCase();
    if (CENTERS[str]) return str;

    const clean = str.toLowerCase().replace(/[\-_]/g, ' ');
    if (clean === 'md' || clean.includes('moondive')) return 'MD';
    if (clean === 'h' || clean.includes('hormiga')) return 'H';
    if (clean === 'm' || clean.includes('mangamar')) return 'M';
    if (clean === 'n' || clean.includes('naranjito')) return 'N';
    if (clean === 'p' || clean.includes('planeta')) return 'P';
    if (clean === 'd' || clean.includes('diver')) return 'D';
    if (clean === 'c' || clean.includes('club')) return 'C';
    if (clean === 'x' || clean.includes('la manga') || clean === 'xlm') return 'X';

    return null;
}

/**
 * Normaliza y devuelve el código de centro estandarizado.
 * @param {string} code
 * @returns {string}
 */
function normCenter(code) {
    if (!code) return '';
    return String(code).trim().toUpperCase();
}


/**
 * Normaliza cualquier formato de fecha legible (D/M/YY, D/M/YYYY, YYYY-MM-DD, D-M-YYYY)
 * al formato estricto ISO 'YYYY-MM-DD'.
 * @param {string} rawDate
 * @returns {string|null}
 */
function normalizeDateStr(rawDate) {
    if (!rawDate) return null;
    let s = String(rawDate).trim().replace(/^["']|["']$/g, '');
    if (!s) return null;

    // Si ya es estrictamente YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

    // Homogeneizar separadores: '/' o '.' -> '-'
    s = s.replace(/[\/\.]/g, '-');
    const parts = s.split('-');
    if (parts.length !== 3) return null;

    let year, month, day;
    if (parts[0].length === 4) {
        // YYYY-MM-DD o YYYY-M-D
        year = parts[0];
        month = parts[1].padStart(2, '0');
        day = parts[2].padStart(2, '0');
    } else {
        // D-M-Y o DD-MM-YYYY o D-M-YY
        day = parts[0].padStart(2, '0');
        month = parts[1].padStart(2, '0');
        let rawYear = parts[2];
        if (rawYear.length === 2) {
            year = Number(rawYear) < 70 ? `20${rawYear}` : `19${rawYear}`;
        } else if (rawYear.length === 4) {
            year = rawYear;
        } else {
            return null;
        }
    }

    const yNum = Number(year);
    const mNum = Number(month);
    const dNum = Number(day);
    if (isNaN(yNum) || isNaN(mNum) || isNaN(dNum)) return null;
    if (mNum < 1 || mNum > 12 || dNum < 1 || dNum > 31) return null;

    return `${year}-${month}-${day}`;
}

/**
 * Parsea el contenido CSV con 3 columnas (date, dive_center, spots).
 * @param {string} text
 * @returns {{ daysMap: Object, salidasMap: Object, totalEntries: number, ignoredRows: number, dateMin: string, dateMax: string, centersCount: Object }}
 */
function parseCsvSchedule(text) {
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) throw new Error("El archivo CSV debe tener al menos una cabecera y una fila de datos.");

    const firstLine = lines[0];
    const delimiter = firstLine.includes(';') ? ';' : (firstLine.includes('\t') ? '\t' : ',');
    const header = lines[0].split(delimiter).map(h => h.trim().toLowerCase().replace(/['"]/g, ''));

    let dateIdx = header.findIndex(h => h === 'date' || h === 'fecha' || h === 'dia');
    let centerIdx = header.findIndex(h => h.includes('center') || h.includes('centro') || h.includes('escuela') || h.includes('club'));
    let spotsIdx = header.findIndex(h => h.includes('spot') || h.includes('plaza') || h.includes('slot') || h.includes('pax') || h.includes('cupo'));

    if (dateIdx === -1) dateIdx = 0;
    if (centerIdx === -1) centerIdx = 1;
    if (spotsIdx === -1) spotsIdx = 2;

    const daysMap = {};
    const salidasMap = {};
    const centersCount = {};
    let totalEntries = 0;
    let ignoredRows = 0;
    let dateMin = '9999-99-99';
    let dateMax = '0000-00-00';

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const parts = line.split(delimiter).map(p => p.trim().replace(/^["']|["']$/g, ''));
        if (parts.length <= Math.max(dateIdx, centerIdx, spotsIdx)) {
            ignoredRows++;
            continue;
        }

        const dateStr = normalizeDateStr(parts[dateIdx]);
        const centerCode = normalizeCenterCode(parts[centerIdx]);
        const spots = parseInt(parts[spotsIdx], 10);

        if (!dateStr || !centerCode || isNaN(spots) || spots <= 0) {
            ignoredRows++;
            continue;
        }

        if (!daysMap[dateStr]) daysMap[dateStr] = {};
        daysMap[dateStr][centerCode] = {
            initialSlots: (daysMap[dateStr][centerCode]?.initialSlots || 0) + spots,
            importedAt: new Date().toISOString()
        };

        if (!salidasMap[dateStr]) salidasMap[dateStr] = {};
        if (!salidasMap[dateStr][centerCode]) {
            salidasMap[dateStr][centerCode] = {
                id: `plazas_${dateStr}_${centerCode}`,
                date: dateStr,
                centerCode: centerCode,
                plazas: 0,
                pax: 0,
                note: '',
                createdAt: new Date().toISOString()
            };
        }
        salidasMap[dateStr][centerCode].plazas += spots;
        salidasMap[dateStr][centerCode].pax += spots;

        centersCount[centerCode] = (centersCount[centerCode] || 0) + spots;
        totalEntries++;

        if (dateStr < dateMin) dateMin = dateStr;
        if (dateStr > dateMax) dateMax = dateStr;
    }

    // Convertir salidasMap en array consolidado (máximo 1 registro por escuela por día)
    const consolidatedSalidasMap = {};
    Object.keys(salidasMap).forEach(d => {
        consolidatedSalidasMap[d] = Object.values(salidasMap[d]);
    });

    return { daysMap, salidasMap: consolidatedSalidasMap, totalEntries, ignoredRows, dateMin, dateMax, centersCount };
}
