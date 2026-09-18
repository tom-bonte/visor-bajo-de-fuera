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
    'B': { bg: '#ef4444', text: '#ffffff' },
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
    let mHtml = '<option value="all">Todos los meses (2026)</option>';
    for (let i = 0; i < 12; i++) {
        const isSelected = i === currentMonth ? 'selected' : '';
        mHtml += `<option value="${i}" ${isSelected}>${MONTHS_ES[i]} 2026</option>`;
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
                    const normCode = s.centerCode === 'B' ? 'MD' : s.centerCode;
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
            query = query.where('date', '>=', `2026-${m}-01`).where('date', '<=', `2026-${m}-31`);
        } else {
            query = query.where('date', '>=', '2026-01-01').where('date', '<=', '2026-12-31');
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
                const normCode = s.centerCode === 'B' ? 'MD' : s.centerCode;
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
        const monthLabel = monthVal === 'all' ? '2026' : `${MONTHS_SHORT[parseInt(monthVal, 10)]}_2026`;
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
 * Genera y descarga un documento PDF vectorial de alta calidad con el cuadrante diario.
 */
async function executePrintPDF() {
    const monthVal = getEl('print-month')?.value || 'all';
    const centerVal = getEl('print-center')?.value || 'all';

    closePrintModal();
    showToast('Generando PDF Vectorial', 'Por favor, espera mientras se dibuja el documento...', false);

    const days = await getExportDaysData(monthVal);

    // Filtrar días que contengan asignaciones para el filtro
    const filteredDays = days.filter(day => {
        if (centerVal === 'all') {
            return Object.keys(CENTERS).some(c => {
                const bal = getCenterBalance(c, day);
                return bal.effectiveSlots > 0 || bal.initialSlots > 0;
            });
        } else {
            const bal = getCenterBalance(centerVal, day);
            return bal.effectiveSlots > 0 || bal.initialSlots > 0;
        }
    });

    if (filteredDays.length === 0) {
        showToast('Sin Datos', 'No hay registros para los filtros seleccionados.', true);
        return;
    }

    setTimeout(() => {
        try {
            if (!window.jspdf || !window.jspdf.jsPDF) {
                throw new Error("Librería jsPDF no disponible.");
            }

            const { jsPDF } = window.jspdf;
            const doc = new jsPDF('p', 'pt', 'a4');
            const pageWidth = 595.28;
            const pageHeight = 841.89;
            const marginX = 36;
            const contentWidth = pageWidth - (marginX * 2); // 523.28 pt

            let currentY = 36;
            let pageNumber = 1;

            const renderDocHeader = () => {
                doc.setFillColor(15, 23, 42); // slate-900
                doc.rect(marginX, currentY, contentWidth, 42, 'F');

                doc.setTextColor(255, 255, 255);
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(13);
                doc.text("CABO DE PALOS · RESERVA MARINA", marginX + 14, currentY + 18);

                doc.setFontSize(9);
                doc.setFont('helvetica', 'normal');
                doc.setTextColor(148, 163, 184); // slate-400
                doc.text("PLANIFICACIÓN OFICIAL BAJO DE FUERA 2026", marginX + 14, currentY + 32);

                const cText = centerVal === 'all' ? 'TODOS LOS CENTROS' : (CENTERS[centerVal]?.name || centerVal).toUpperCase();
                const mText = monthVal === 'all' ? 'TEMPORADA 2026' : `${MONTHS_ES[parseInt(monthVal, 10)]} 2026`;
                doc.setFontSize(8);
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(56, 189, 248); // sky-400
                doc.text(`${cText} · ${mText}`, marginX + contentWidth - 14, currentY + 25, { align: 'right' });

                currentY += 52;
            };

            const renderFooter = (page) => {
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(7.5);
                doc.setTextColor(148, 163, 184);
                doc.text("Visor Bajo de Fuera · Sistema de Gestión de Plazas", marginX, pageHeight - 20);
                doc.text(`Página ${page}`, marginX + contentWidth, pageHeight - 20, { align: 'right' });
            };

            renderDocHeader();

            for (let i = 0; i < filteredDays.length; i++) {
                const day = filteredDays[i];
                const dObj = parseDateT00(day.date);
                const dayName = DAYS_ES[dObj.getDay()];
                const dateTitle = `${dayName}, ${dObj.getDate()} DE ${MONTHS_ES[dObj.getMonth()]} ${dObj.getFullYear()}`;

                const centerEntries = [];
                let totalDayEffective = 0;

                const targetCodes = centerVal === 'all' ? Object.keys(CENTERS) : [centerVal];
                targetCodes.forEach(code => {
                    const bal = getCenterBalance(code, day);
                    if (bal.effectiveSlots > 0 || bal.initialSlots > 0) {
                        centerEntries.push({ code, bal });
                        totalDayEffective += bal.effectiveSlots;
                    }
                });

                if (centerEntries.length === 0) continue;

                centerEntries.sort((a, b) => b.bal.effectiveSlots - a.bal.effectiveSlots);

                // Cálculo de altura del bloque diario
                const blockHeight = 20 + 14 + (centerEntries.length * 16) + 12;

                if (currentY + blockHeight > pageHeight - 36) {
                    renderFooter(pageNumber);
                    doc.addPage();
                    pageNumber++;
                    currentY = 36;
                    renderDocHeader();
                }

                // Marco exterior redondeado
                doc.setDrawColor(226, 232, 240);
                doc.setLineWidth(0.8);
                doc.setFillColor(255, 255, 255);
                doc.roundedRect(marginX, currentY, contentWidth, blockHeight - 4, 3, 3, 'FD');

                // Cabecera del día
                doc.setFillColor(241, 245, 249);
                doc.roundedRect(marginX, currentY, contentWidth, 20, 3, 3, 'F');
                doc.rect(marginX, currentY + 10, contentWidth, 10, 'F');
                doc.setDrawColor(226, 232, 240);
                doc.line(marginX, currentY + 20, marginX + contentWidth, currentY + 20);

                doc.setTextColor(15, 23, 42);
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(8.5);
                doc.text(dateTitle.toUpperCase(), marginX + 10, currentY + 13);

                const totalCap = getDayQuota(day.date, day);
                doc.setFontSize(8);
                doc.setTextColor(2, 132, 199);
                doc.text(`TOTAL: ${totalDayEffective} / ${totalCap} PLAZAS`, marginX + contentWidth - 10, currentY + 13, { align: 'right' });

                let tableY = currentY + 20;

                // Cabecera de columnas
                doc.setFillColor(248, 250, 252);
                doc.rect(marginX, tableY, contentWidth, 14, 'F');
                doc.line(marginX, tableY + 14, marginX + contentWidth, tableY + 14);

                doc.setFont('helvetica', 'bold');
                doc.setFontSize(7);
                doc.setTextColor(100, 116, 139);
                doc.text("CENTRO DE BUCEO", marginX + 22, tableY + 10);
                doc.text("PLAZAS BASE", marginX + 175, tableY + 10);
                doc.text("MOVIMIENTOS / CESIONES", marginX + 265, tableY + 10);
                doc.text("PLAZAS EFECTIVAS", marginX + contentWidth - 10, tableY + 10, { align: 'right' });

                tableY += 14;

                // Filas de centros
                centerEntries.forEach((entry, rIdx) => {
                    const { code, bal } = entry;
                    const cInfo = CENTERS[code] || { name: code, hex: '#64748b' };
                    const pdfStyle = PDF_CENTER_STYLES[code] || { bg: '#64748b', text: '#ffffff' };

                    if (rIdx % 2 === 1) {
                        doc.setFillColor(248, 250, 252);
                        doc.rect(marginX, tableY, contentWidth, 16, 'F');
                    }
                    doc.setDrawColor(241, 245, 249);
                    doc.line(marginX, tableY + 16, marginX + contentWidth, tableY + 16);

                    // Pastilla de color del centro
                    doc.setFillColor(pdfStyle.bg);
                    doc.roundedRect(marginX + 8, tableY + 3.5, 9, 9, 2, 2, 'F');

                    // Nombre del centro
                    doc.setFont('helvetica', 'bold');
                    doc.setFontSize(7.5);
                    doc.setTextColor(30, 41, 59);
                    doc.text(cInfo.name, marginX + 22, tableY + 11);

                    // Plazas iniciales
                    doc.setFont('helvetica', 'normal');
                    doc.setFontSize(7.5);
                    doc.setTextColor(71, 85, 105);
                    doc.text(`${bal.initialSlots} plazas`, marginX + 175, tableY + 11);

                    // Movimientos
                    let movText = "-";
                    const notes = [];
                    if (bal.transferredOut > 0) notes.push(`-${bal.transferredOut} cedidas`);
                    if (bal.transferredIn > 0) notes.push(`+${bal.transferredIn} recibidas`);
                    if (bal.releasedToPool > 0) notes.push(`-${bal.releasedToPool} al pool`);
                    if (bal.claimedFromPool > 0) notes.push(`+${bal.claimedFromPool} del pool`);
                    if (notes.length > 0) movText = notes.join(', ');

                    doc.setFont('helvetica', 'normal');
                    doc.setFontSize(7);
                    doc.setTextColor(movText === '-' ? 148 : 71, movText === '-' ? 163 : 85, movText === '-' ? 184 : 105);
                    doc.text(movText, marginX + 265, tableY + 11);

                    // Plazas finales
                    doc.setFont('helvetica', 'bold');
                    doc.setFontSize(8);
                    doc.setTextColor(15, 23, 42);
                    doc.text(`${bal.effectiveSlots} plazas`, marginX + contentWidth - 10, tableY + 11, { align: 'right' });

                    tableY += 16;
                });

                currentY += blockHeight;
            }

            renderFooter(pageNumber);

            const centerFile = centerVal === 'all' ? 'Todos' : (CENTERS[centerVal]?.name || centerVal);
            const monthFile = monthVal === 'all' ? '2026' : `${MONTHS_SHORT[parseInt(monthVal, 10)]}_2026`;
            doc.save(`Planificacion_BajoDeFuera_${centerFile}_${monthFile}.pdf`);

            showToast('PDF Descargado', 'Documento PDF generado y descargado correctamente.');
        } catch (err) {
            console.error("Error al generar PDF vectorial:", err);
            showToast('Error', 'Hubo un fallo al generar el PDF: ' + err.message, true);
        }
    }, 120);
}
