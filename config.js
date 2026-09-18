/**
 * @file config.js
 * @description Configuración central y constantes para Visor Bajo de Fuera.
 * Define centros participantes, colores, límites operativos, credenciales Firebase
 * y endpoints de notificación (Make.com / WhatsApp).
 */

/** @constant {number} Cupo estándar diario para el Bajo de Fuera. */
const DEFAULT_DAILY_CAP = 30;

/**
 * REGLA OFICIAL DE CUPOS DIARIOS PARA BAJO DE FUERA (Fuente única de la verdad):
 * - 1 de Junio al 30 de Septiembre: 30 plazas todos los días.
 * - 1 de Octubre al 15 de Octubre: 30 plazas solo sábados y domingos (viernes quedan en 13).
 * - Resto de días del año: 13 plazas.
 * - Festivos y puentes NO alteran la regla.
 * - El 15 de Octubre es corte estricto (si el 15 es sábado, el domingo 16 es 13).
 * - Sobreescritura opcional de administrador por fecha (ej. cierre total = 0).
 *
 * @param {Date|string} date - Objeto Date o cadena 'YYYY-MM-DD'
 * @param {Object} [dayData] - Datos opcionales del día en Firestore
 * @returns {number}
 */
function getDayQuota(date, dayData = null) {
    // 1. Prioridad: Sobreescritura manual de administrador si existe para este día
    if (dayData) {
        if (typeof dayData.totalQuotaOverride === 'number') return dayData.totalQuotaOverride;
        if (dayData.totalQuota === 0) return 0; // Cierre oficial
    } else if (typeof monthDaysCache !== 'undefined') {
        const dateStr = typeof date === 'string' ? date : (date instanceof Date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` : '');
        if (dateStr && monthDaysCache[dateStr]) {
            if (typeof monthDaysCache[dateStr].totalQuotaOverride === 'number') return monthDaysCache[dateStr].totalQuotaOverride;
            if (monthDaysCache[dateStr].totalQuota === 0) return 0;
        }
    }

    // 2. Parsear fecha
    let dObj = date;
    if (typeof date === 'string') {
        const parts = date.split('-');
        if (parts.length >= 3) {
            dObj = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
        } else {
            dObj = new Date(date);
        }
    }
    if (!dObj || isNaN(dObj.getTime())) return 13;

    const m = dObj.getMonth();      // 0 = Ene, 5 = Jun, 8 = Sep, 9 = Oct
    const d = dObj.getDate();
    const wd = dObj.getDay();       // 0 = Dom, 6 = Sáb
    const weekend = (wd === 0 || wd === 6);

    if (m >= 5 && m <= 8) return 30;               // Jun–Sep: 30 plazas cada día
    if (m === 9 && d <= 15 && weekend) return 30;  // 1–15 Oct: 30 plazas fines de semana
    return 13;                                     // Todo el resto del año: 13 plazas
}

// Alias de retrocompatibilidad
const getOfficialDailyCapacity = getDayQuota;

/**
 * Devuelve el texto descriptivo del cupo para el mes visible.
 * @param {number} month - 0 a 11
 * @returns {string}
 */
function getMonthQuotaLabel(month) {
    if (month >= 5 && month <= 8) {
        return "Cupo: 30 plazas/día · Máx 12/barco";
    }
    if (month === 9) {
        return "Cupo: 13 plazas/día · 30 fines de semana hasta el 15/10 · Máx 12/barco";
    }
    return "Cupo: 13 plazas/día · Máx 12/barco";
}

/** @constant {number} Capacidad máxima recomendada de buceadores por barco en boya. */
const MAX_BOAT_CAP = 12;

/**
 * @constant {Object}
 * Diccionario de centros participantes con identificador, nombre, emoji y estilos CSS/Tailwind.
 */
const CENTERS = {
    'MD': { key: 'moondive', name: 'Moondive', emoji: '🔴', color: 'bg-[#ef4444]', text: 'text-white', hex: '#ef4444', pastelBg: 'bg-red-50/95', pastelBorder: 'border-red-200/90' },
    'H': { key: 'hormigas', name: 'Islas Hormigas', emoji: '⚫', color: 'bg-[#0f172a]', text: 'text-white', hex: '#0f172a', pastelBg: 'bg-slate-100/95', pastelBorder: 'border-slate-300' },
    'M': { key: 'mangamar', name: 'Mangamar', emoji: '🟢', color: 'bg-[#22c55e]', text: 'text-white', hex: '#22c55e', pastelBg: 'bg-emerald-50/95', pastelBorder: 'border-emerald-200/90' },
    'N': { key: 'naranjito', name: 'Naranjito', emoji: '🟠', color: 'bg-[#fbbf24]', text: 'text-slate-900', hex: '#fbbf24', pastelBg: 'bg-amber-50/95', pastelBorder: 'border-amber-200/90' },
    'P': { key: 'planeta', name: 'Planeta Azul', emoji: '🔵', color: 'bg-[#3b82f6]', text: 'text-white', hex: '#3b82f6', pastelBg: 'bg-blue-50/95', pastelBorder: 'border-blue-200/90' },
    'D': { key: 'divers', name: 'Divers', emoji: '🟣', color: 'bg-[#6d28d9]', text: 'text-white', hex: '#6d28d9', pastelBg: 'bg-purple-50/95', pastelBorder: 'border-purple-200/90' },
    'C': { key: 'club', name: 'CLUB', emoji: '🔘', color: 'bg-[#64748b]', text: 'text-white', hex: '#64748b', pastelBg: 'bg-slate-100/90', pastelBorder: 'border-slate-300' },
    'X': { key: 'xlm', name: 'X La Manga', emoji: '⚪', color: 'bg-[#cbd5e1]', text: 'text-slate-800', hex: '#cbd5e1', pastelBg: 'bg-slate-50', pastelBorder: 'border-slate-200' }
};

// Aliasing retrocompatible para 'B' sin duplicarlo en iteraciones de centros
Object.defineProperty(CENTERS, 'B', {
    value: CENTERS['MD'],
    enumerable: false,
    configurable: true,
    writable: true
});

/**
 * Mapeo entre usuarios de autenticación y correos pseudo-locales de Firebase Auth.
 */
const EMAIL_MAP = {
    'admin': 'admin@visor.local',
    'mangamar': 'mangamar@visor.local',
    'moondive': 'moondive@visor.local',
    'balky': 'moondive@visor.local',
    'hormigas': 'hormigas@visor.local',
    'naranjito': 'naranjito@visor.local',
    'planeta': 'planeta@visor.local',
    'divers': 'divers@visor.local',
    'club': 'club@visor.local',
    'xlm': 'xlm@visor.local'
};

/**
 * Traducción de clave de usuario a código de centro.
 */
const USER_CENTER_KEYS = {
    'moondive': 'MD',
    'balky': 'MD',
    'hormigas': 'H',
    'mangamar': 'M',
    'naranjito': 'N',
    'planeta': 'P',
    'divers': 'D',
    'club': 'C',
    'xlm': 'X'
};

/**
 * Mapeo inverso de código de centro a clave de usuario.
 */
const CENTER_TO_USER_KEY = {
    'MD': 'moondive',
    'B': 'moondive',
    'H': 'hormigas',
    'M': 'mangamar',
    'N': 'naranjito',
    'P': 'planeta',
    'D': 'divers',
    'C': 'club',
    'X': 'xlm'
};

/**
 * Información del badge para el usuario activo en la cabecera.
 */
const BADGE_INFO = {
    'admin': { name: 'Admin Root', color: 'bg-slate-800', text: 'text-white', initial: 'A' },
    'mangamar': { name: 'Mangamar', color: 'bg-[#22c55e]', text: 'text-white', initial: 'M' },
    'moondive': { name: 'Moondive', color: 'bg-[#ef4444]', text: 'text-white', initial: 'MD' },
    'balky': { name: 'Moondive', color: 'bg-[#ef4444]', text: 'text-white', initial: 'MD' },
    'hormigas': { name: 'Islas Hormigas', color: 'bg-[#0f172a]', text: 'text-white', initial: 'H' },
    'naranjito': { name: 'Naranjito', color: 'bg-[#fbbf24]', text: 'text-slate-900', initial: 'N' },
    'planeta': { name: 'Planeta Azul', color: 'bg-[#3b82f6]', text: 'text-white', initial: 'P' },
    'divers': { name: 'Divers', color: 'bg-[#6d28d9]', text: 'text-white', initial: 'D' },
    'club': { name: 'CLUB', color: 'bg-[#64748b]', text: 'text-white', initial: 'C' },
    'xlm': { name: 'X La Manga', color: 'bg-[#cbd5e1]', text: 'text-slate-800', initial: 'X' },
    'guest': { name: 'Modo Consulta', color: 'bg-slate-200', text: 'text-slate-700', initial: '👁️' }
};

/** Días de la semana en español. */
const DAYS_ES = ['DOMINGO', 'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO'];

/** Meses del año en español. */
const MONTHS_ES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/**
 * Endpoint de webhook para notificaciones WhatsApp a través de Make.com
 * IMPORTANTE: Desactivado (null) para evitar envíos al grupo de aguas interiores.
 * Se configurará un webhook nuevo cuando se cree el grupo específico de Bajo de Fuera.
 */
const WHATSAPP_WEBHOOK_URL = null;

/**
 * Configuración de Firebase para reserva-marina-cdp.
 * Las colecciones utilizadas por Bajo de Fuera están estrictamente aisladas con el prefijo "bdf_".
 */
const firebaseConfig = {
    apiKey: "AIzaSyBe7X5AUC-PpcJSCYgMzyyUMJMPqxtTdiw",
    authDomain: "reserva-marina-cdp.firebaseapp.com",
    projectId: "reserva-marina-cdp",
    storageBucket: "reserva-marina-cdp.appspot.com",
    messagingSenderId: "242126338137",
    appId: "1:242126338137:web:c32d20d4697545a172d948"
};

/** Colecciones Firestore de Bajo de Fuera (completamente independientes) */
const BDF_COLLECTIONS = {
    DAYS: "bdf_days",
    HISTORY: "bdf_history_logs",
    REQUESTS: "bdf_requests"
};
