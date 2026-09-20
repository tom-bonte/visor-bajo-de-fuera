/**
 * @file bdf-logic.js
 * @description Aritmética de plazas de Bajo de Fuera: añadir, quitar, ceder e
 * intercambiar. Son funciones PURAS sobre listas de salidas; no tocan Firestore
 * ni la pantalla.
 *
 * Vive en su propio fichero porque lo usan DOS sitios: el navegador (como hasta
 * ahora) y la función del servidor que a partir de ahora hace las escrituras.
 * Si cada lado tuviera su copia, tarde o temprano una de las dos se quedaría
 * atrás y el servidor aceptaría un reparto que la app considera imposible.
 *
 * En el navegador se carga como un script normal y sus funciones quedan
 * disponibles globalmente; en Node se carga con require().
 */

// normCenter vive en utils.js, que también se carga en los dos entornos.
if (typeof normCenter === 'undefined' && typeof require !== 'undefined') {
    var { normCenter } = require('./utils.js');
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
function buildDayDocPayload(dateStr, cap, salidas, updatedAt) {
    return {
        date: dateStr,
        totalQuota: cap,
        salidas: salidas,
        allocations: syncAllocationsFromSalidas(salidas),
        updatedAt: updatedAt
    };
}

// En Node (la función del servidor y los tests) se exporta; en el navegador
// esta línea no hace nada y las funciones siguen siendo globales.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        generateSalidaId, syncAllocationsFromSalidas, removeSalidaFromList,
        sumSalidasPlazas, addPlazasToSalidas, applySwapToSalidas,
        applyTransferToSalidas, buildDayDocPayload
    };
}
