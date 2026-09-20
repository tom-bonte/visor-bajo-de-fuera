/**
 * Tests del cuadrante en PDF (export.js).
 *
 * Un calendario es el sitio clásico donde se cuela un error de un día: la
 * semana que empieza en domingo en vez de en lunes, el mes que empieza en la
 * casilla equivocada, febrero de un año bisiesto. Aquí no se comprueba que el
 * PDF sea bonito —eso se mira con los ojos— sino que cada día caiga en su
 * columna y lleve lo suyo dentro.
 *
 * Se le pasa a la función un documento de mentira que apunta todo lo que se le
 * manda dibujar, en vez de jsPDF.
 */
const { loadApp } = require('./load-app.js');
const { section, check, ok, report } = require('./assert.js');

const app = loadApp();
const { drawMonthGrid } = app;

const L = {
    pageWidth: 841.89, pageHeight: 595.28, marginX: 28,
    contentWidth: 841.89 - 56, gridTop: 74, gridBottom: 595.28 - 30, headerRowH: 16
};

/** Documento que no dibuja nada: sólo toma nota. */
function docDeMentira() {
    const textos = [];
    const rects = [];
    let colorTexto = '#000000';
    let colorRelleno = '#000000';
    return {
        textos, rects,
        setFont: () => {}, setFontSize: () => {},
        setTextColor: (c) => { colorTexto = c; },
        setFillColor: (c) => { colorRelleno = c; },
        setDrawColor: () => {}, setLineWidth: () => {},
        rect: (x, y, w, h) => rects.push({ x, y, w, h, color: colorRelleno }),
        roundedRect: (x, y, w, h) => rects.push({ x, y, w, h, color: colorRelleno, redondeado: true }),
        text: (t, x, y, o) => textos.push({ t: String(t), x, y, color: colorTexto, align: (o || {}).align }),
        splitTextToSize: (t) => [t]
    };
}

/** Día del mes -> { columna (0 = lunes), fila } según dónde se ha dibujado. */
function posicionDe(doc, numero) {
    const anchoCol = L.contentWidth / 7;
    // El número del día se dibuja alineado a la izquierda; las plazas de cada
    // escuela van alineadas a la derecha, así que no se confunden.
    const celda = doc.textos.find(t => t.t === String(numero) && !t.align);
    if (!celda) return null;
    return { columna: Math.round((celda.x - 5 - L.marginX) / anchoCol), y: celda.y };
}

const dia = (fecha, salidas) => ({ date: fecha, salidas });

// -------------------------------------------------------------------------
section('Cada día cae en su columna');

// Diciembre de 2026: el 1 es MARTES, el 31 es JUEVES.
let doc = docDeMentira();
drawMonthGrid(doc, 2026, 11, {}, 'all', L);

check('la cabecera empieza en LUNES', doc.textos[0].t, 'LUNES');
check('y termina en DOMINGO', doc.textos[6].t, 'DOMINGO');
check('el 1 de diciembre de 2026 cae en martes (columna 1)', posicionDe(doc, 1).columna, 1);
check('el 6, domingo (columna 6)', posicionDe(doc, 6).columna, 6);
check('el 7, lunes otra vez (columna 0)', posicionDe(doc, 7).columna, 0);
check('el 31, jueves (columna 3)', posicionDe(doc, 31).columna, 3);
ok('no se dibuja ningún día 32', !posicionDe(doc, 32));

// Un mes que empieza en lunes: junio de 2026.
doc = docDeMentira();
drawMonthGrid(doc, 2026, 5, {}, 'all', L);
check('el 1 de junio de 2026 cae en lunes (columna 0)', posicionDe(doc, 1).columna, 0);
check('junio tiene 30 días', !!posicionDe(doc, 30) && !posicionDe(doc, 31), true);

// Un mes que empieza en domingo: febrero de 2026.
doc = docDeMentira();
drawMonthGrid(doc, 2026, 1, {}, 'all', L);
check('el 1 de febrero de 2026 cae en domingo (columna 6)', posicionDe(doc, 1).columna, 6);
check('febrero de 2026 tiene 28 días', !!posicionDe(doc, 28) && !posicionDe(doc, 29), true);

// Año bisiesto.
doc = docDeMentira();
drawMonthGrid(doc, 2028, 1, {}, 'all', L);
ok('febrero de 2028 sí tiene 29', !!posicionDe(doc, 29));
ok('pero no 30', !posicionDe(doc, 30));

// -------------------------------------------------------------------------
section('Lo que lleva dentro cada día');

const datos = {
    '2026-12-01': dia('2026-12-01', [
        { id: 'a', centerCode: 'M', plazas: 8, pax: 8 },
        { id: 'b', centerCode: 'MD', plazas: 5, pax: 5 }
    ]),
    '2026-12-02': dia('2026-12-02', [{ id: 'c', centerCode: 'H', plazas: 3, pax: 3 }])
};

doc = docDeMentira();
drawMonthGrid(doc, 2026, 11, datos, 'all', L);

ok('aparece Mangamar', doc.textos.some(t => t.t === 'Mangamar'));
ok('aparece Moondive', doc.textos.some(t => t.t === 'Moondive'));
ok('aparece Islas Hormigas', doc.textos.some(t => t.t === 'Islas Hormigas'));
ok('con sus plazas alineadas a la derecha',
    doc.textos.some(t => t.t === '8' && t.align === 'right'));
ok('el día lleno se marca en rojo',
    doc.textos.some(t => t.t === '13/13 pl.' && t.color === '#dc2626'));
ok('y un día con sitio, en gris',
    doc.textos.some(t => t.t === '3/13 pl.' && t.color === '#64748b'));

// -------------------------------------------------------------------------
section('El papel de una sola escuela');

doc = docDeMentira();
drawMonthGrid(doc, 2026, 11, datos, 'M', L);

ok('sale Mangamar', doc.textos.some(t => t.t === 'Mangamar'));
check('y NO las demás escuelas', doc.textos.some(t => t.t === 'Moondive' || t.t === 'Islas Hormigas'), false);
ok('pero la ocupación del día sigue siendo la real, no la suya',
    doc.textos.some(t => t.t === '13/13 pl.'));

// -------------------------------------------------------------------------
section('Un día con las ocho escuelas');

const lleno = {};
['MD', 'H', 'M', 'N', 'P', 'D', 'C', 'X'].forEach((c, i) => {
    lleno['2026-07-01'] = lleno['2026-07-01'] || dia('2026-07-01', []);
    lleno['2026-07-01'].salidas.push({ id: 's' + i, centerCode: c, plazas: 3, pax: 3 });
});

doc = docDeMentira();
drawMonthGrid(doc, 2026, 6, lleno, 'all', L);

const nombres = ['Moondive', 'Islas Hormigas', 'Mangamar', 'Naranjito', 'Planeta Azul', 'Divers', 'CLUB', 'X La Manga'];
const dibujados = nombres.filter(n => doc.textos.some(t => t.t === n));
const avisoDeMas = doc.textos.find(t => /^\+\d+ más$/.test(t.t));
ok('o caben las ocho, o se dice cuántas faltan',
    dibujados.length === 8 || (!!avisoDeMas && dibujados.length + Number(avisoDeMas.t.match(/\d+/)[0]) === 8));

// -------------------------------------------------------------------------
section('El documento es horizontal y un mes por página');

const fs = require('fs');
const path = require('path');
const exportSrc = fs.readFileSync(path.join(__dirname, '..', 'export.js'), 'utf8');

ok('se crea en horizontal', /new jsPDF\('l', 'pt', 'a4'\)/.test(exportSrc));
ok('cada mes añade su página', /doc\.addPage\('a4', 'l'\)/.test(exportSrc));
ok('con el nombre del mes en la cabecera', /MONTHS_ES\[month\]\.toUpperCase\(\)/.test(exportSrc));
ok('y el fichero se llama Cuadrante', /Cuadrante_BajoDeFuera_/.test(exportSrc));

// -------------------------------------------------------------------------
section('Lo pesado no se descarga hasta que hace falta');

const indexSrc = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
check('jsPDF ya no se carga al abrir la app', /<script src="https:\/\/cdnjs[^"]*jspdf/.test(indexSrc), false);
ok('se pide cuando se va a exportar', /await ensureJsPDF\(\)/.test(exportSrc));
ok('y si no se puede cargar, se avisa en castellano', /No se ha podido cargar el generador de PDF/.test(exportSrc));
ok('el ayudante de arrastre se sirve desde el propio sitio', /src="DragDropTouch\.js/.test(indexSrc));
check('y ya no desde la web personal de un tercero', /bernardo-castilho\.github\.io/.test(indexSrc), false);

const servicioSrc = fs.readFileSync(path.join(__dirname, '..', 'firebase-service.js'), 'utf8');
ok('Firestore detecta las redes que cortan el streaming',
    /experimentalAutoDetectLongPolling: true/.test(servicioSrc));
ok('y se configura antes de usar la base de datos',
    servicioSrc.indexOf('db.settings(') < servicioSrc.indexOf('enablePersistence'));

process.exit(report('CUADRANTE EN PDF'));
