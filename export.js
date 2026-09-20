/**
 * @file export.js
 * @description Módulo de exportación de datos para el Visor Bajo de Fuera.
 * Proporciona descarga directa en formato CSV e informe en PDF vectorial de alta
 * fidelidad utilizando la librería jsPDF.
 */

/**
 * Estilos y colores para renderizar badges y bloques de centros en el PDF vectorial.
 */
const PDF_CENTER_STYLES = {
    'MD': { bg: '#ef4444', text: '#ffffff' },
    'H': { bg: '#0f172a', text: '#ffffff' },
    'M': { bg: '#16a34a', text: '#ffffff' },
    'N': { bg: '#fbbf24', text: '#0f172a' },
    'P': { bg: '#2563eb', text: '#ffffff' },
    'D': { bg: '#7c3aed', text: '#ffffff' },
    'C': { bg: '#64748b', text: '#ffffff' },
    'X': { bg: '#cbd5e1', text: '#0f172a' }
};

/**
 * Alterna el estilo visual del formato seleccionado en el modal (PDF vs CSV).
 * @param {'pdf'|'csv'} format
 */
function selectExportFormat(format) {
    const input = getEl('export-format');
    if (input) input.value = format;

    const btnPdf = getEl('btn-format-pdf');
    const btnCsv = getEl('btn-format-csv');

    if (btnPdf) {
        btnPdf.className = `flex-1 py-2 px-3 border-2 rounded-lg font-bold text-sm transition-colors ${
            format === 'pdf' ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
        }`;
    }
    if (btnCsv) {
        btnCsv.className = `flex-1 py-2 px-3 border-2 rounded-lg font-bold text-sm transition-colors ${
            format === 'csv' ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
        }`;
    }
}

/**
 * Abre el modal de exportación/impresión y rellena los selectores de Mes y Centro.
 */
function openPrintModal() {
    selectExportFormat('pdf');

    // Selector de Mes
    let mHtml = `<option value="all">Todos los meses (${currentYear})</option>`;
    for (let i = 0; i < 12; i++) {
        const isSelected = i === currentMonth ? 'selected' : '';
        mHtml += `<option value="${i}" ${isSelected}>${MONTHS_ES[i]} ${currentYear}</option>`;
    }
    const monthSelect = getEl('print-month');
    if (monthSelect) monthSelect.innerHTML = mHtml;

    // Selector de Centro
    let cHtml = '<option value="all">Todos los centros</option>';
    Object.keys(CENTERS).forEach(code => {
        cHtml += `<option value="${code}">${CENTERS[code].name}</option>`;
    });
    const centerSelect = getEl('print-center');
    if (centerSelect) centerSelect.innerHTML = cHtml;

    showEl('print-modal');
}

/**
 * Cierra el modal de exportación.
 */
function closePrintModal() {
    hideEl('print-modal');
}

/**
 * Enruta la exportación al generador adecuado (PDF o CSV).
 */
function executeExport() {
    const format = getEl('export-format')?.value || 'pdf';
    if (format === 'pdf') {
        executePrintPDF();
    } else {
        executePrintCSV();
    }
}

/**
 * Crea una copia de seguridad inmediata en CSV de toda la base de datos de Bajo de Fuera.
 * Se descarga automáticamente como seguro antes de realizar el vaciado definitivo.
 */
async function backupAllToCSV() {
    try {
        const days = await getExportDaysData('all');
        if (!days || days.length === 0) return;

        let csv = "date,dive_center,spots\n";
        days.forEach(day => {
            const daySalidas = getDaySalidas(day, day.date);
            if (daySalidas && daySalidas.length > 0) {
                daySalidas.forEach(s => {
                    const normCode = normCenter(s.centerCode);
                    const cName = CENTERS[normCode]?.name || normCode;
                    csv += `${day.date},${cName},${s.pax}\n`;
                });
            } else {
                Object.keys(CENTERS).forEach(code => {
                    const bal = getCenterBalance(code, day);
                    if (bal.effectiveSlots > 0 || bal.initialSlots > 0) {
                        const cName = CENTERS[code]?.name || code;
                        csv += `${day.date},${cName},${bal.effectiveSlots}\n`;
                    }
                });
            }
        });

        const todayStr = getStrYMD(new Date());
        const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const l = document.createElement("a");
        l.setAttribute("href", url);
        l.setAttribute("download", `Backup_Completo_BajoDeFuera_${todayStr}.csv`);
        document.body.appendChild(l);
        l.click();
        document.body.removeChild(l);
        URL.revokeObjectURL(url);
    } catch (e) {
        console.error("Error al crear la copia de seguridad CSV:", e);
    }
}

/**
 * Realiza una copia de seguridad completa de la temporada descargando un archivo JSON.
 * Solo disponible para el Administrador.
 */
async function downloadJsonBackup() {
    try {
        showToast('Generando Backup JSON', 'Descargando todos los días registrados en Bajo de Fuera...');
        const snapshot = await db.collection(BDF_COLLECTIONS.DAYS).get();
        const daysData = {};
        snapshot.forEach(doc => {
            daysData[doc.id] = doc.data();
        });

        const totalDays = Object.keys(daysData).length;
        if (totalDays === 0) {
            showToast('Sin Datos', 'No hay registros en la base de datos para exportar.', true);
            return;
        }

        const backupPayload = {
            appName: 'Visor Bajo de Fuera',
            version: '6.0',
            exportedAt: new Date().toISOString(),
            totalDays: totalDays,
            days: daysData
        };

        const jsonStr = JSON.stringify(backupPayload, null, 2);
        const todayStr = getStrYMD(new Date());
        const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `bdf_backup_${todayStr}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('Backup JSON Descargado', `Se han exportado ${totalDays} días con éxito.`);
    } catch (err) {
        console.error("Error al exportar JSON:", err);
        showToast('Error de Exportación', friendlyError(err, 'generar la copia en JSON'), true);
    }
}

/**
 * Recupera los datos de los días para la exportación desde Firestore o caché local.
 * @param {string} monthVal - 'all' o índice del mes ('0'..'11')
 * @returns {Promise<Array<Object>>}
 */
async function getExportDaysData(monthVal) {
    const days = [];
    try {
        let query = db.collection(BDF_COLLECTIONS.DAYS);
        if (monthVal !== 'all') {
            const m = String(parseInt(monthVal, 10) + 1).padStart(2, '0');
            query = query.where('date', '>=', `${currentYear}-${m}-01`).where('date', '<=', `${currentYear}-${m}-31`);
        } else {
            query = query.where('date', '>=', `${currentYear}-01-01`).where('date', '<=', `${currentYear}-12-31`);
        }
        const snap = await query.get();
        snap.forEach(doc => {
            const data = doc.data();
            days.push(data);
            monthDaysCache[data.date] = data;
        });
    } catch (e) {
        console.warn("Fallo al consultar Firestore, usando datos en caché:", e);
        Object.values(monthDaysCache).forEach(d => {
            if (monthVal !== 'all') {
                const m = parseInt(d.date.split('-')[1], 10) - 1;
                if (m === parseInt(monthVal, 10)) days.push(d);
            } else {
                days.push(d);
            }
        });
    }

    return days.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Exporta la planificación a un archivo CSV estándar descargable con columnas date,dive_center,spots.
 */
async function executePrintCSV() {
    const monthVal = getEl('print-month')?.value || 'all';
    const centerVal = getEl('print-center')?.value || 'all';

    closePrintModal();
    showToast('Generando CSV', 'Consultando y preparando datos...');

    const days = await getExportDaysData(monthVal);
    const rows = [];

    days.forEach(day => {
        const centersToCheck = centerVal === 'all' ? Object.keys(CENTERS) : [centerVal];
        const daySalidas = getDaySalidas(day, day.date);
        if (daySalidas && daySalidas.length > 0) {
            daySalidas.forEach(s => {
                const normCode = normCenter(s.centerCode);
                if (centersToCheck.includes(normCode)) {
                    rows.push({
                        date: day.date,
                        center: CENTERS[normCode]?.name || normCode,
                        spots: s.pax
                    });
                }
            });
        } else {
            centersToCheck.forEach(code => {
                const bal = getCenterBalance(code, day);
                if (bal.effectiveSlots > 0 || bal.initialSlots > 0) {
                    rows.push({
                        date: day.date,
                        center: CENTERS[code]?.name || code,
                        spots: bal.effectiveSlots
                    });
                }
            });
        }
    });

    if (rows.length === 0) {
        showToast('Sin Datos', 'No hay registros para los filtros seleccionados.', true);
        return;
    }

    try {
        let csv = "date,dive_center,spots\n";
        rows.forEach(r => {
            csv += `${r.date},${r.center},${r.spots}\n`;
        });

        const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const l = document.createElement("a");
        l.setAttribute("href", url);

        const centerLabel = centerVal === 'all' ? 'Todos' : (CENTERS[centerVal]?.name || centerVal);
        const monthLabel = monthVal === 'all' ? String(currentYear) : `${MONTHS_SHORT[parseInt(monthVal, 10)]}_${currentYear}`;
        l.setAttribute("download", `Planificacion_BajoDeFuera_${centerLabel}_${monthLabel}.csv`);

        document.body.appendChild(l);
        l.click();
        document.body.removeChild(l);
        URL.revokeObjectURL(url);

        showToast('CSV Descargado', `Se han exportado ${rows.length} registros con éxito.`);
    } catch (err) {
        console.error("Error al exportar CSV:", err);
        showToast('Error', 'Hubo un problema al exportar el archivo CSV.', true);
    }
}

/**
 * Dibuja un mes completo como calendario, igual que se ve en la app: una
 * columna por día de la semana, una fila por semana, y dentro de cada día las
 * pastillas de color de cada escuela con sus plazas.
 *
 * Antes el PDF era una lista de días uno detrás de otro. Se leía bien en una
 * pantalla, pero el papel que se cuelga en el pantalán tiene que verse de un
 * vistazo: dónde hay hueco esta semana, quién sale el sábado.
 *
 * @param {Object} doc - documento jsPDF (horizontal)
 * @param {number} year
 * @param {number} month - 0 a 11
 * @param {Object} daysByDate - { 'AAAA-MM-DD': datos del día }
 * @param {string} centerVal - 'all' o el código de un centro
 * @param {Object} L - medidas de la página
 */
function drawMonthGrid(doc, year, month, daysByDate, centerVal, L) {
    const primerDia = new Date(year, month, 1);
    const diasDelMes = new Date(year, month + 1, 0).getDate();
    // La semana empieza en lunes, como en la app (getDay() da 0 al domingo).
    const hueco = (primerDia.getDay() + 6) % 7;
    const semanas = Math.ceil((hueco + diasDelMes) / 7);

    const anchoCol = L.contentWidth / 7;
    const altoFila = (L.gridBottom - L.gridTop - L.headerRowH) / semanas;

    // Cabecera de los días de la semana
    const diasSemana = ['LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO', 'DOMINGO'];
    doc.setFillColor('#0f172a');
    doc.rect(L.marginX, L.gridTop, L.contentWidth, L.headerRowH, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor('#ffffff');
    diasSemana.forEach((d, i) => {
        doc.text(d, L.marginX + anchoCol * i + anchoCol / 2, L.gridTop + L.headerRowH - 4.5, { align: 'center' });
    });

    let y = L.gridTop + L.headerRowH;

    for (let semana = 0; semana < semanas; semana++) {
        for (let col = 0; col < 7; col++) {
            const numeroDia = semana * 7 + col - hueco + 1;
            const x = L.marginX + anchoCol * col;
            const dentroDelMes = numeroDia >= 1 && numeroDia <= diasDelMes;
            const finDeSemana = col >= 5;

            // Fondo de la celda
            doc.setFillColor(dentroDelMes ? (finDeSemana ? '#f8fafc' : '#ffffff') : '#f1f5f9');
            doc.setDrawColor('#cbd5e1');
            doc.setLineWidth(0.5);
            doc.rect(x, y, anchoCol, altoFila, 'FD');

            if (!dentroDelMes) continue;

            const fecha = `${year}-${String(month + 1).padStart(2, '0')}-${String(numeroDia).padStart(2, '0')}`;
            const datos = daysByDate[fecha] || null;
            const cupo = getDayQuota(fecha, datos);

            // Número del día
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(9);
            doc.setTextColor(finDeSemana ? '#0369a1' : '#0f172a');
            doc.text(String(numeroDia), x + 5, y + 10);

            // Ocupación del día: se cuenta SIEMPRE entera, aunque se esté
            // imprimiendo el papel de una sola escuela. Lo que importa al
            // mirar el cuadrante es cuántas plazas quedan en el barco.
            let ocupadas = 0;
            const pastillas = [];
            Object.keys(CENTERS).forEach(code => {
                const bal = getCenterBalance(code, datos);
                const plazas = bal.effectiveSlots || 0;
                if (plazas <= 0) return;
                ocupadas += plazas;
                if (centerVal === 'all' || centerVal === code) pastillas.push({ code, plazas });
            });

            if (ocupadas > 0 || cupo > 0) {
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(6.5);
                doc.setTextColor(ocupadas >= cupo ? '#dc2626' : '#64748b');
                doc.text(`${ocupadas}/${cupo} pl.`, x + anchoCol - 5, y + 9.5, { align: 'right' });
            }

            // Pastillas de cada escuela, de más plazas a menos
            pastillas.sort((a, b) => b.plazas - a.plazas);

            const altoPastilla = 10;
            const separacion = 1.5;
            const disponible = altoFila - 15;
            const caben = Math.max(0, Math.floor(disponible / (altoPastilla + separacion)));

            pastillas.slice(0, caben).forEach((p, idx) => {
                const py = y + 14 + idx * (altoPastilla + separacion);
                const estilo = PDF_CENTER_STYLES[p.code] || { bg: '#64748b', text: '#ffffff' };
                const info = safeCenter(p.code);

                doc.setFillColor(estilo.bg);
                doc.roundedRect(x + 3, py, anchoCol - 6, altoPastilla, 2, 2, 'F');

                doc.setTextColor(estilo.text);
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(6.5);
                const nombre = doc.splitTextToSize(info.name, anchoCol - 24)[0];
                doc.text(nombre, x + 6, py + 7);
                doc.text(String(p.plazas), x + anchoCol - 6, py + 7, { align: 'right' });
            });

            // Si no caben todas, se dice cuántas faltan en vez de recortar en silencio.
            if (pastillas.length > caben) {
                doc.setFont('helvetica', 'italic');
                doc.setFontSize(6);
                doc.setTextColor('#64748b');
                doc.text(`+${pastillas.length - caben} más`, x + 5, y + altoFila - 3);
            }
        }
        y += altoFila;
    }
}

/**
 * PDF del cuadrante: un mes por página, en horizontal, con el mismo aspecto
 * que el calendario de la app.
 */
async function executePrintPDF() {
    const monthVal = getEl('print-month')?.value || 'all';
    const centerVal = getEl('print-center')?.value || 'all';

    closePrintModal();
    showToast('Generando PDF Vectorial', 'Por favor, espera mientras se dibuja el documento...', false);

    const days = await getExportDaysData(monthVal);

    const daysByDate = {};
    days.forEach(d => { if (d && d.date) daysByDate[d.date] = d; });

    // Meses que se van a imprimir: el elegido, o todos los que tengan algo.
    let meses;
    if (monthVal !== 'all') {
        meses = [parseInt(monthVal, 10)];
    } else {
        const conDatos = new Set();
        days.forEach(d => {
            const tieneAlgo = Object.keys(CENTERS).some(c => (getCenterBalance(c, d).effectiveSlots || 0) > 0);
            if (tieneAlgo) conDatos.add(parseInt(d.date.split('-')[1], 10) - 1);
        });
        meses = [...conDatos].sort((a, b) => a - b);
    }

    // Con un centro concreto, comprobar que ese centro tiene algo que imprimir.
    const hayDatos = days.some(d => {
        if (centerVal === 'all') return Object.keys(CENTERS).some(c => (getCenterBalance(c, d).effectiveSlots || 0) > 0);
        return (getCenterBalance(centerVal, d).effectiveSlots || 0) > 0;
    });

    if (meses.length === 0 || !hayDatos) {
        showToast('Sin Datos', 'No hay registros para los filtros seleccionados.', true);
        return;
    }

    setTimeout(() => {
        try {
            if (!window.jspdf || !window.jspdf.jsPDF) {
                throw new Error("Librería jsPDF no disponible.");
            }

            const { jsPDF } = window.jspdf;
            // Horizontal: un mes de siete columnas no cabe en vertical.
            const doc = new jsPDF('l', 'pt', 'a4');

            const L = {
                pageWidth: 841.89,
                pageHeight: 595.28,
                marginX: 28,
                contentWidth: 841.89 - 56,
                gridTop: 74,
                gridBottom: 595.28 - 30,
                headerRowH: 16
            };

            const dibujarCabecera = (month) => {
                doc.setFillColor('#0f172a');
                doc.rect(L.marginX, 24, L.contentWidth, 40, 'F');

                doc.setTextColor('#ffffff');
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(13);
                doc.text("CABO DE PALOS · RESERVA MARINA", L.marginX + 14, 42);

                doc.setFontSize(8.5);
                doc.setFont('helvetica', 'normal');
                doc.setTextColor('#94a3b8');
                doc.text("PLANIFICACIÓN OFICIAL BAJO DE FUERA", L.marginX + 14, 55);

                doc.setFont('helvetica', 'bold');
                doc.setFontSize(16);
                doc.setTextColor('#ffffff');
                doc.text(`${MONTHS_ES[month].toUpperCase()} ${currentYear}`,
                    L.marginX + L.contentWidth / 2, 48, { align: 'center' });

                const cText = centerVal === 'all' ? 'TODOS LOS CENTROS' : (safeCenter(centerVal).name).toUpperCase();
                doc.setFontSize(8);
                doc.setTextColor('#38bdf8');
                doc.text(cText, L.marginX + L.contentWidth - 14, 48, { align: 'right' });
            };

            const dibujarPie = (pagina, total) => {
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(7.5);
                doc.setTextColor('#94a3b8');
                doc.text("Visor Bajo de Fuera · Sistema de Gestión de Plazas", L.marginX, L.pageHeight - 14);
                doc.text(`Página ${pagina} de ${total}`, L.marginX + L.contentWidth, L.pageHeight - 14, { align: 'right' });
            };

            meses.forEach((month, idx) => {
                if (idx > 0) doc.addPage('a4', 'l');
                dibujarCabecera(month);
                drawMonthGrid(doc, currentYear, month, daysByDate, centerVal, L);
                dibujarPie(idx + 1, meses.length);
            });

            const centerFile = centerVal === 'all' ? 'Todos' : (safeCenter(centerVal).name);
            const monthFile = monthVal === 'all' ? String(currentYear) : `${MONTHS_SHORT[parseInt(monthVal, 10)]}_${currentYear}`;
            doc.save(`Cuadrante_BajoDeFuera_${centerFile}_${monthFile}.pdf`);

            showToast('PDF Descargado', 'Documento PDF generado y descargado correctamente.');
        } catch (err) {
            reportFailure(err, "Error al generar el PDF del cuadrante");
            showToast('Error', friendlyError(err, 'generar el PDF'), true);
        }
    }, 120);
}
