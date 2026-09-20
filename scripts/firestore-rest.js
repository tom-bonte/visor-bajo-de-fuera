/**
 * @file scripts/firestore-rest.js
 * @description Traducción entre el JSON "tipado" de la API REST de Firestore y
 * objetos JavaScript normales. Sin dependencias y sin red: son funciones puras,
 * para que los tests puedan comprobar el viaje de ida y vuelta.
 *
 * Firestore no guarda `3`, guarda `{ integerValue: "3" }`. Si una copia de
 * seguridad no distingue enteros de decimales ni marcas de tiempo, al restaurar
 * se corrompen las plazas y el historial. De ahí este fichero.
 */

/** Marca con la que representamos una fecha de Firestore en el JSON de backup. */
const TIMESTAMP_KEY = '__timestamp';

function decodeValue(value) {
    if (value === null || typeof value !== 'object') return value;

    if ('nullValue' in value) return null;
    if ('booleanValue' in value) return value.booleanValue;
    if ('integerValue' in value) return Number(value.integerValue);
    if ('doubleValue' in value) return Number(value.doubleValue);
    if ('stringValue' in value) return value.stringValue;
    if ('timestampValue' in value) return { [TIMESTAMP_KEY]: value.timestampValue };
    if ('arrayValue' in value) return (value.arrayValue.values || []).map(decodeValue);
    if ('mapValue' in value) return decodeFields(value.mapValue.fields || {});

    throw new Error(`Tipo de Firestore no soportado en la copia: ${Object.keys(value).join(', ')}`);
}

function decodeFields(fields) {
    const out = {};
    Object.keys(fields || {}).forEach(k => { out[k] = decodeValue(fields[k]); });
    return out;
}

function encodeValue(value) {
    if (value === null || value === undefined) return { nullValue: null };
    if (typeof value === 'boolean') return { booleanValue: value };
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new Error(`Número no representable: ${value}`);
        return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
    }
    if (typeof value === 'string') return { stringValue: value };
    if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } };
    if (typeof value === 'object') {
        if (TIMESTAMP_KEY in value) return { timestampValue: value[TIMESTAMP_KEY] };
        return { mapValue: { fields: encodeFields(value) } };
    }
    throw new Error(`Tipo JavaScript no soportado en la restauración: ${typeof value}`);
}

function encodeFields(obj) {
    const out = {};
    Object.keys(obj || {}).forEach(k => { out[k] = encodeValue(obj[k]); });
    return out;
}

/** 'projects/x/databases/(default)/documents/bdf_days/2026-07-01' -> '2026-07-01' */
function docIdFromName(name) {
    if (typeof name !== 'string' || name === '') throw new Error('Documento sin nombre en la respuesta de Firestore');
    return name.substring(name.lastIndexOf('/') + 1);
}

/** Lee apiKey y projectId del config.js público: una sola fuente de la verdad. */
function readFirebaseConfig(configSource) {
    const apiKey = /apiKey:\s*"([^"]+)"/.exec(configSource);
    const projectId = /projectId:\s*"([^"]+)"/.exec(configSource);
    if (!apiKey || !projectId) throw new Error('No se han encontrado apiKey/projectId en config.js');
    return { apiKey: apiKey[1], projectId: projectId[1] };
}


/**
 * JSON con las claves ordenadas. Firestore devuelve los campos en un orden
 * arbitrario: sin esto, dos documentos idénticos parecen distintos y una
 * restauración sobrescribiría datos buenos sin necesidad.
 */
function stableStringify(value) {
    if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
    if (value !== null && typeof value === 'object') {
        return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
    }
    return JSON.stringify(value === undefined ? null : value);
}

/** Mismo orden de claves, pero devolviendo un objeto (para guardarlo legible). */
function sortKeysDeep(value) {
    if (Array.isArray(value)) return value.map(sortKeysDeep);
    if (value !== null && typeof value === 'object') {
        const out = {};
        Object.keys(value).sort().forEach(k => { out[k] = sortKeysDeep(value[k]); });
        return out;
    }
    return value;
}

module.exports = { TIMESTAMP_KEY, stableStringify, sortKeysDeep, decodeValue, decodeFields, encodeValue, encodeFields, docIdFromName, readFirebaseConfig };
