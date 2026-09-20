/**
 * Tests de los flujos de pantalla (app.js).
 *
 * Por qué existe este fichero: los dos fallos del 20/09/2026 —que un centro no
 * pudiera editar sus plazas, y que el aviso de WhatsApp dijera "Centro
 * desconocido"— estaban los dos AQUÍ, en la costura entre lo que rellena la
 * pantalla y lo que se manda al servidor. Era la única parte de la app que
 * ningún test ejecutaba: se comprobaba la aritmética y se comprobaba el
 * servidor, pero no el trozo que los une.
 *
 * No hace falta un navegador de verdad: se carga app.js en el mismo contexto
 * aislado que el resto de tests, con una pantalla de mentira en la que sólo se
 * registran los campos que la función toca.
 */
const { loadApp } = require('./load-app.js');
const { section, check, ok, report } = require('./assert.js');

/**
 * Prepara la app como si un centro tuviera abierto el cuadro de "modificar
 * salida" sobre una salida suya.
 */
function prepararEdicion({ usuario = 'mangamar', centro = 'M', plazasActuales = 6, plazasNuevas = 3, centroElegido = null } = {}) {
    const app = loadApp();
    const enviado = {};

    app.setElement('edit-salida-pax', { value: String(plazasNuevas) });
    app.setElement('edit-salida-note', { value: '' });
    app.setElement('edit-salida-center', { value: centroElegido || centro });
    app.setElement('edit-salida-modal');

    app.evaluate(`currentUserKey = ${JSON.stringify(usuario)};`);
    app.evaluate(`isGuestMode = false;`);
    app.evaluate(`monthDaysCache = ${JSON.stringify({
        '2026-07-14': { date: '2026-07-14', totalQuota: 30, salidas: [{ id: 'sal-1', centerCode: centro, plazas: plazasActuales, pax: plazasActuales, note: '' }] }
    })};`);
    app.evaluate(`pendingEditSalida = ${JSON.stringify({
        dateStr: '2026-07-14', salidaId: 'sal-1', centerCode: centro,
        currentPax: plazasActuales, allowedMax: 30, dayCap: 30, itemNote: ''
    })};`);

    // Se capturan la llamada al servidor y el mensaje de WhatsApp.
    app.executeEditSalida = async (dateStr, salidaId, pax, newCenterCode, note) => {
        Object.assign(enviado, { dateStr, salidaId, pax, newCenterCode, note });
    };
    app.triggerWhatsAppConfirm = (titulo, mensaje, accion) => {
        enviado.aviso = mensaje;
        return accion();
    };
    app.showToast = (t, m) => { enviado.toast = `${t}: ${m}`; };
    app.showNotification = (t, m) => { enviado.notificacion = `${t}: ${m}`; };

    return { app, enviado };
}

(async () => {

// -------------------------------------------------------------------------
section('Un centro edita sus propias plazas');

const centro = prepararEdicion({ usuario: 'mangamar', centro: 'M', plazasActuales: 6, plazasNuevas: 3 });
await centro.app.confirmEditSalida();

check('se manda el día correcto', centro.enviado.dateStr, '2026-07-14');
check('y las plazas nuevas', centro.enviado.pax, 3);
check('sin cambio de centro: el servidor lo rechazaría como reasignación',
    centro.enviado.newCenterCode, null);

ok('el aviso nombra a la escuela', /Mangamar/.test(centro.enviado.aviso || ''));
check('y NUNCA dice "Centro desconocido"',
    /Centro desconocido/.test(centro.enviado.aviso || ''), false);
ok('el aviso dice qué ha pasado', /redujo su salida/.test(centro.enviado.aviso || ''));
ok('con las cifras de antes y después', /de 6 a 3 plazas/.test(centro.enviado.aviso || ''));

// -------------------------------------------------------------------------
section('Cada escuela se nombra a sí misma');

for (const [usuario, code, nombre] of [
    ['moondive', 'MD', 'Moondive'],
    ['hormigas', 'H', 'Islas Hormigas'],
    ['naranjito', 'N', 'Naranjito'],
    ['xlm', 'X', 'X La Manga']
]) {
    const caso = prepararEdicion({ usuario, centro: code, plazasActuales: 5, plazasNuevas: 8 });
    await caso.app.confirmEditSalida();
    ok(`${nombre} aparece en su aviso`, new RegExp(nombre).test(caso.enviado.aviso || ''));
    check(`${nombre} no manda centro al servidor`, caso.enviado.newCenterCode, null);
}

// -------------------------------------------------------------------------
section('El administrador sí puede reasignar');

const admin = prepararEdicion({ usuario: 'admin', centro: 'M', plazasActuales: 6, plazasNuevas: 4, centroElegido: 'D' });
await admin.app.confirmEditSalida();

check('el admin sí manda el centro elegido', admin.enviado.newCenterCode, 'D');
check('con las plazas indicadas', admin.enviado.pax, 4);
ok('y no se manda ningún aviso a WhatsApp', !admin.enviado.aviso);
ok('se confirma por pantalla', /Salida Modificada/.test(admin.enviado.toast || ''));

// -------------------------------------------------------------------------
section('Lo que no se debe poder guardar');

const cero = prepararEdicion({ plazasNuevas: 0 });
await cero.app.confirmEditSalida();
check('cero plazas no llega al servidor', cero.enviado.pax, undefined);
ok('y se avisa', /Error/.test(cero.enviado.notificacion || ''));

const exceso = prepararEdicion({ plazasNuevas: 99 });
await exceso.app.confirmEditSalida();
check('99 plazas tampoco', exceso.enviado.pax, undefined);
ok('con el motivo', /Límite excedido/.test(exceso.enviado.notificacion || ''));

const sinCupo = prepararEdicion({ plazasActuales: 6, plazasNuevas: 29 });
sinCupo.app.evaluate(`monthDaysCache['2026-07-14'].salidas.push({ id: 'otro', centerCode: 'D', plazas: 20, pax: 20 });`);
await sinCupo.app.confirmEditSalida();
check('ni pasarse del cupo del día', sinCupo.enviado.pax, undefined);
ok('explicando cuántas caben', /Cupo Excedido/.test(sinCupo.enviado.notificacion || ''));

process.exit(report('FLUJOS DE PANTALLA'));

})();
