const fs = require('fs');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');

let pass = 0, fail = 0;
const results = [];
async function should(label, allowed, op) {
  try {
    await (allowed ? assertSucceeds(op) : assertFails(op));
    results.push(`  ✓ ${allowed ? 'PERMITE ' : 'BLOQUEA '} ${label}`); pass++;
  } catch (e) {
    results.push(`  ✗ ${allowed ? 'PERMITE ' : 'BLOQUEA '} ${label}\n       → ${String(e.message).split('\n')[0]}`); fail++;
  }
}

const salida = (c, p, extra = {}) => ({ id: `plazas_2026-07-01_${c}`, date: '2026-07-01', centerCode: c, plazas: p, pax: p, note: '', ...extra });
const day = (salidas) => ({ date: '2026-07-01', totalQuota: 30, salidas, allocations: {}, updatedAt: new Date() });

(async () => {
  const testEnv = await initializeTestEnvironment({
    projectId: 'demo-bdf',
    firestore: { rules: fs.readFileSync(require('path').join(__dirname, '..', 'firestore.rules'), 'utf8'), host: '127.0.0.1', port: 8080 }
  });
  await testEnv.clearFirestore();

  const M  = testEnv.authenticatedContext('u1', { email: 'mangamar@visor.local' }).firestore();
  const D  = testEnv.authenticatedContext('u2', { email: 'divers@visor.local'   }).firestore();
  const N  = testEnv.authenticatedContext('u3', { email: 'naranjito@visor.local'}).firestore();
  const A  = testEnv.authenticatedContext('u4', { email: 'admin@visor.local'    }).firestore();
  const G  = testEnv.unauthenticatedContext().firestore();

  // Semilla con las reglas desactivadas
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.collection('bdf_requests').doc('req-MD').set({ type: 'request', status: 'pending', initiatorCenter: 'M', targetCenter: 'D', date: '2026-07-01', requestedPax: 3 });
    await db.collection('bdf_days').doc('2026-07-01').set(day([salida('M', 10)]));
    await db.collection('reservations_monthly').doc('2026-07').set({ allocations: {} });
    await db.collection('mangamar_customers').doc('c1').set({ name: 'x' });
  });

  results.push('\nLo que la app necesita poder hacer');
  // Las escuelas ya no escriben: sus cambios van por la función del servidor,
  // que usa una cuenta de servicio y no pasa por estas reglas. Lo que sigue
  // haciendo falta desde el navegador es LEER, y que el admin pueda usar sus
  // herramientas (cuadrante CSV, cupos, intercambio directo).
  await should('invitado LEE el calendario',                       true, G.collection('bdf_days').doc('2026-07-01').get());
  await should('centro LEE las solicitudes',                       true, M.collection('bdf_requests').doc('req-MD').get());
  await should('cualquiera LEE el historial',                      true, G.collection('bdf_history_logs').get());
  await should('admin escribe un día (cuadrante CSV)',             true, A.collection('bdf_days').doc('2026-07-02').set(day([salida('M', 10)])));
  await should('admin escribe un día con DOS escuelas (permuta)',  true, A.collection('bdf_days').doc('2026-07-03').set(day([salida('M', 8), salida('D', 12)])));
  await should('admin: día justo en el tope de 30 plazas',         true, A.collection('bdf_days').doc('2026-07-04').set(day([salida('M', 12), salida('D', 10), salida('H', 8)])));
  await should('admin: las 8 escuelas en un mismo día',            true, A.collection('bdf_days').doc('2026-07-05').set(day(['MD','H','M','N','P','D','C','X'].map(c => salida(c, 3)))));
  await should('admin: nota normal en una salida',                 true, A.collection('bdf_days').doc('2026-07-06').set(day([salida('M', 5, { note: 'Grupo de Madrid, llegan tarde' })])));
  await should('admin firma el historial',                         true, A.collection('bdf_history_logs').add({ actionType: 'import_csv', centerKey: 'admin', details: {} }));
  await should('admin borra un día entero',                        true, A.collection('bdf_days').doc('2026-07-01').delete());

  results.push('\nLa puerta de atrás, cerrada (lo que motivó todo esto)');
  // Esto es lo que CUALQUIER escuela podía hacer con la consola abierta: ahora
  // no. Sus cambios legítimos pasan por el servidor, que sí mira de quién son
  // las plazas.
  await should('centro reescribe un día y borra a los demás',     false, M.collection('bdf_days').doc('2026-07-03').set(day([salida('M', 13)])));
  await should('centro escribe su propio día directamente',       false, M.collection('bdf_days').doc('2026-07-30').set(day([salida('M', 10)])));
  await should('centro borra las plazas de otra escuela',         false, M.collection('bdf_days').doc('2026-07-04').set(day([salida('M', 12)])));
  await should('centro crea una solicitud directamente',          false, M.collection('bdf_requests').add({ type: 'swap', status: 'pending', initiatorCenter: 'M', targetCenter: 'D' }));
  await should('centro borra una solicitud directamente',         false, D.collection('bdf_requests').doc('req-MD').delete());
  await should('centro escribe en el historial',                  false, M.collection('bdf_history_logs').add({ actionType: 'add_salida', centerKey: 'mangamar', details: {} }));

  results.push('\nSuplantación: actuar en nombre de otra escuela');
  await should('propuesta fingiendo ser Islas Hormigas',          false, M.collection('bdf_requests').add({ type: 'swap', status: 'pending', initiatorCenter: 'H', targetCenter: 'D' }));
  await should('historial firmado como otra escuela',             false, M.collection('bdf_history_logs').add({ actionType: 'add_salida', centerKey: 'hormigas', details: {} }));
  await should('y tampoco firmándolo con la suya',                false, M.collection('bdf_history_logs').add({ actionType: 'add_salida', centerKey: 'mangamar', details: {} }));
  await testEnv.withSecurityRulesDisabled(async (ctx) => { await ctx.firestore().collection('bdf_requests').doc('req-MD2').set({ type: 'request', status: 'pending', initiatorCenter: 'M', targetCenter: 'D', date: '2026-07-01' }); });
  await should('un tercero cancela una propuesta ajena',          false, N.collection('bdf_requests').doc('req-MD2').delete());
  await should('un tercero caduca una propuesta ajena',           false, N.collection('bdf_requests').doc('req-MD2').update({ status: 'expired' }));

  await should('borrar una solicitud que ya no existe',           false, N.collection('bdf_requests').doc('no-existe').delete());
  await should('solicitud sin initiatorCenter',                   false, M.collection('bdf_requests').add({ type: 'swap', status: 'pending', targetCenter: 'D' }));
  await should('entrada de historial sin centerKey',              false, M.collection('bdf_history_logs').add({ actionType: 'add_salida', details: {} }));

  results.push('\nDatos imposibles en un día (la red de seguridad del admin)');
  await should('el día suma 40 plazas',                           false, A.collection('bdf_days').doc('2026-07-10').set(day([salida('M', 20), salida('D', 20)])));
  await should('una salida con 99 plazas',                        false, A.collection('bdf_days').doc('2026-07-11').set(day([salida('M', 99)])));
  await should('una salida con 0 plazas',                         false, A.collection('bdf_days').doc('2026-07-12').set(day([salida('M', 0)])));
  await should('plazas en texto en vez de número',                false, A.collection('bdf_days').doc('2026-07-13').set(day([salida('M', '10')])));
  await should('una escuela inventada',                           false, A.collection('bdf_days').doc('2026-07-14').set(day([salida('ZZZ', 5)])));
  await should('9 registros en un día (hay 8 escuelas)',          false, A.collection('bdf_days').doc('2026-07-15').set(day([...['MD','H','M','N','P','D','C','X'].map(c => salida(c, 1)), salida('M', 1)])));
  await should('una nota de 500 caracteres',                      false, A.collection('bdf_days').doc('2026-07-16').set(day([salida('M', 5, { note: 'x'.repeat(500) })])));

  results.push('\nSin sesión iniciada');
  await should('invitado escribe en el calendario',               false, G.collection('bdf_days').doc('2026-07-20').set(day([salida('M', 5)])));
  await should('invitado lee las solicitudes',                    false, G.collection('bdf_requests').doc('req-MD2').get());
  await should('centro borra un día entero (sólo admin)',         false, M.collection('bdf_days').doc('2026-07-03').delete());

  results.push('\nLas otras dos apps (sin cambios desde la ronda anterior)');
  await should('extraño ESCRIBE en Cabo de Palos',                false, G.collection('reservations_monthly').doc('2026-07').set({ hacked: true }));
  await should('extraño LEE Cabo de Palos',                        true, G.collection('reservations_monthly').doc('2026-07').get());
  await should('centro con sesión escribe en Cabo de Palos',       true, M.collection('reservations_monthly').doc('2026-08').set({ allocations: {} }));
  // Hasta ahora mangamar_* estaba abierto a cualquiera. Ya no: ver la sección
  // 'Mangamar Ops' más abajo.
  await should('invitado LEE datos de Mangamar Ops',              false, G.collection('mangamar_customers').doc('c1').get());
  await should('invitado ESCRIBE datos de Mangamar Ops',          false, G.collection('mangamar_customers').doc('c2').set({ name: 'y' }));

  await mangamarOps(testEnv);

  console.log(results.join('\n'));
  console.log(`\n${fail === 0 ? '✅' : '❌'}  ${pass} correctas, ${fail} fallidas\n`);
  await testEnv.cleanup();
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('ERROR:', e); process.exit(2); });

// =============================================================================
// MANGAMAR OPS (sección 3 de las reglas)
// =============================================================================
// Entran: los DISPOSITIVOS APROBADOS (token 'custom' del servidor con
// mgDevice: true y ficha mangamar_devices/{uid} con status 'approved') y las
// dos cuentas EXACTAS con email y contraseña: la de la tienda
// (mangamar@visor.local) y la de Tom (admin@visor.local). Cada forma de acceso
// que usa la app (mapa de accesos + grep del código) se prueba con las tres
// identidades buenas (PERMITE) y con todas las malas (BLOQUEA), incluidos los
// dispositivos pendientes, quitados, sin ficha o con el token mal.
async function mangamarOps(testEnv) {
  const firebase = require('firebase/compat/app');
  const FV = firebase.firestore.FieldValue;
  const pwd = (uid, email) => testEnv.authenticatedContext(uid, { email, firebase: { sign_in_provider: 'password' } }).firestore();
  const other = (uid, email, provider) => testEnv.authenticatedContext(uid, { email, firebase: { sign_in_provider: provider } }).firestore();

  const dev = (uid, claims) => testEnv.authenticatedContext(uid, claims).firestore();
  const devClaims = { mgDevice: true, firebase: { sign_in_provider: 'custom' } };

  const SHOP   = pwd('mg-shop',  'mangamar@visor.local');
  const ADMIN  = pwd('mg-admin', 'admin@visor.local');
  const DEVICE = dev('dev_ok', devClaims);                      // dispositivo aprobado
  const DEV_PEND = dev('dev_pend', devClaims);
  const DEV_REV  = dev('dev_rev', devClaims);
  const BAD = [
    ['sin sesión',                                   testEnv.unauthenticatedContext().firestore()],
    ['moondive@visor.local (otra escuela)',          pwd('mg-moon', 'moondive@visor.local')],
    ['x@gmail.com (registrado por su cuenta)',       pwd('mg-gmail', 'x@gmail.com')],
    ['evil@visor.local (registrado por su cuenta)',  pwd('mg-evil', 'evil@visor.local')],
    ['token custom con email de la tienda',          other('mg-fake', 'mangamar@visor.local', 'custom')],
    ['token custom con email de admin',              other('mg-fake2', 'admin@visor.local', 'custom')],
    ['anónimo con email de la tienda',               other('mg-anon', 'mangamar@visor.local', 'anonymous')],
    ['cuenta de la tienda por Google (no password)', other('mg-google', 'mangamar@visor.local', 'google.com')],
    ['dispositivo PENDIENTE',                        DEV_PEND],
    ['dispositivo QUITADO',                          DEV_REV],
    ['dispositivo sin ficha en mangamar_devices',    dev('dev_nodoc', devClaims)],
    ['token custom de dev_ok SIN mgDevice',          dev('dev_ok', { firebase: { sign_in_provider: 'custom' } })],
    ['token custom de dev_ok con mgDevice: false',   dev('dev_ok', { mgDevice: false, firebase: { sign_in_provider: 'custom' } })],
    ['token custom de dev_ok con mgDevice: "true"',  dev('dev_ok', { mgDevice: 'true', firebase: { sign_in_provider: 'custom' } })],
    ['token password de dev_ok con mgDevice',        dev('dev_ok', { mgDevice: true, firebase: { sign_in_provider: 'password' } })],
    ['anónimo de dev_ok con mgDevice',               dev('dev_ok', { mgDevice: true, firebase: { sign_in_provider: 'anonymous' } })],
  ];

  const listen = (q) => new Promise((resolve, reject) => {
    const unsub = q.onSnapshot(s => { unsub(); resolve(s); }, reject);
  });
  const run = (fn, db) => Promise.resolve().then(() => fn(db));

  // La app: dispositivo aprobado, tienda y Tom PERMITE; todas las identidades
  // malas BLOQUEA. Primero las malas (así el estado sigue intacto), luego las buenas.
  async function staffOnly(label, fn) {
    for (const [who, db] of BAD) await should(`${label}  [${who}]`, false, run(fn, db));
    await should(`${label}  [tienda]`,      true, run(fn, SHOP));
    await should(`${label}  [admin]`,       true, run(fn, ADMIN));
    await should(`${label}  [dispositivo]`, true, run(fn, DEVICE));
  }
  // Nadie desde el navegador (ni dispositivo, ni tienda, ni admin).
  async function nobody(label, fn) {
    for (const [who, db] of BAD) await should(`${label}  [${who}]`, false, run(fn, db));
    await should(`${label}  [tienda]`,      false, run(fn, SHOP));
    await should(`${label}  [admin]`,       false, run(fn, ADMIN));
    await should(`${label}  [dispositivo]`, false, run(fn, DEVICE));
  }
  // Sólo Tom (borrar documentos enteros que la app no borra).
  async function adminOnly(label, fn) {
    for (const [who, db] of BAD) await should(`${label}  [${who}]`, false, run(fn, db));
    await should(`${label}  [tienda]`,      false, run(fn, SHOP));
    await should(`${label}  [dispositivo]`, false, run(fn, DEVICE));
    await should(`${label}  [admin]`,       true, run(fn, ADMIN));
  }

  const hist = (db, dni, id) => db.collection('mangamar_customers').doc(dni).collection('history').doc(id);
  const month = (db, id = '2026-07') => db.collection('mangamar_monthly').doc(id);
  const settings = (db) => db.collection('mangamar_directory').doc('settings');
  const trip = { id: 't1', date: '2026-07-01', time: '09:00', site: 'Bajo de Dentro', guests: [{ dni: '12345678Z', nombre: 'Ana' }] };
  const h = (extra = {}) => ({ date: '2026-07-01', type: 'buceo', price: 45, paymentStatus: 'pending', certStatus: 'pendiente', processedAt: new Date('2026-07-02'), paidAt: new Date('2026-07-01T10:00:00Z'), ...extra });

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await month(db).set({ allocations: { t1: trip, t2: { ...trip, id: 't2' } } });
    await month(db, '2026-08').set({ allocations: { t9: trip } });
    await month(db, 'staff').set({ capitanes: [{ nombre: 'Abel' }], guias: [] });
    await month(db, 'reg_maintenance').set({ tickets: [{ id: 'r1' }] });
    await month(db, 'tank_inventory').set({ tanks: [{ id: 'k1' }] });
    await db.collection('mangamar_customers').doc('12345678Z').set({ nombre: 'Ana', dni: '12345678Z', outstandingDebt: 0, insurance: { until: '2026-12-31' } });
    await db.collection('mangamar_customers').doc('87654321X').set({ nombre: 'Luis', dni: '87654321X' });
    await db.collection('mangamar_customers').doc('OLDDNI1').set({ nombre: 'Pepe', dni: 'OLDDNI1' });
    await db.collection('mangamar_customers').doc('BORRAR1').set({ nombre: 'Borrar', dni: 'BORRAR1' });
    await hist(db, '12345678Z', 't1').set(h());
    await hist(db, '12345678Z', 'dep1').set(h({ type: 'deposito', paymentStatus: 'paid' }));
    await hist(db, '12345678Z', 'pago1').set(h({ type: 'pago', certStatus: 'procesado' }));
    await hist(db, '87654321X', 't1').set(h());
    await hist(db, 'OLDDNI1', 'h-old').set(h());
    await hist(db, 'BORRAR1', 'h-b').set(h());
    await db.collection('mangamar_directory').doc('master_list').set({ clients: [{ dni: '12345678Z', nombre: 'Ana' }] });
    await db.collection('mangamar_directory').doc('master_list_2').set({ clients: [] });
    await settings(db).set({ adminPassword: 'secreto-viejo', crmShardCount: 2, dniRedirects: {}, waTemplates: [], showTVRadioTimes: true, staffOffTracking: { Abel: 'always' } });
    await db.collection('mangamar_groups').doc('grp_1').set({ name: 'Madrid', members: ['12345678Z'] });
    await db.collection('mangamar_inbox').doc('11111111H').set({ nombre: 'Nuevo', email: 'n@x.com' });
    await db.collection('mangamar_inbox').doc('22222222J').set({ nombre: 'Otro' });
    await db.collection('mangamar_portal_logs').doc('12345678Z').set({ dni: '12345678Z', nombre: 'Ana', portalLoginCount: 3 });
    await db.collection('mangamar_portal_throttle').doc('ip_1').set({ attempts: 2 });
    await db.collection('mangamar_bonos').doc('b1').set({ createdAt: new Date(), buyer: 'Ana', used: [] });
    await db.collection('mangamar_contacts').doc('ct1').set({ name: 'Proveedor' });
    await db.collection('mangamar_projects').doc('proj_1').set({ name: 'Compresor' });
    await db.collection('mangamar_settings').doc('pricing').set({ items: [{ id: 'buceo', price: 45 }] });
    await db.collection('mangamar_staff_schedule').doc('2026-07').set({ days: {} });
    await db.collection('mangamar_secret').doc('x').set({ a: 1 });
    const devDoc = (status) => ({ status, secretHash: 'h'.repeat(64), role: 'staff', ua: 'Chrome', createdAt: new Date('2026-09-22'), lastSeen: new Date('2026-09-22'), approvedBy: status === 'approved' ? 'alta automática' : '' });
    await db.collection('mangamar_devices').doc('dev_ok').set(devDoc('approved'));
    await db.collection('mangamar_devices').doc('dev_ok2').set(devDoc('approved'));
    await db.collection('mangamar_devices').doc('dev_pend').set(devDoc('pending'));
    await db.collection('mangamar_devices').doc('dev_rev').set(devDoc('revoked'));
    await db.collection('mangamar_devices').doc('dev_target').set(devDoc('pending'));
    await db.collection('mangamar_customers').doc('12345678Z').collection('notes').doc('n1').set({ a: 1 });
  });

  // ---------------------------------------------------------------- monthly
  results.push('\nMangamar Ops · mangamar_monthly (salidas, plantilla, taller, botellas)');
  await staffOnly('lee un mes (listener de 3 meses)',            db => listen(month(db)));
  await staffOnly('lee un mes (get)',                            db => month(db, '2026-08').get());
  await staffOnly('lista la colección entera (barrido)',         db => db.collection('mangamar_monthly').get());
  await staffOnly('transacción get + update en punto',           db => db.runTransaction(async tx => { const r = month(db); await tx.get(r); tx.update(r, { 'allocations.t1.site': 'Carbonera' }); }));
  await staffOnly('transacción get + set(merge) mes nuevo',      db => db.runTransaction(async tx => { const r = month(db, '2026-09'); await tx.get(r); tx.set(r, { allocations: { t5: trip } }, { merge: true }); }));
  await staffOnly('update allocations.X = FieldValue.delete()',  db => month(db).update({ 'allocations.t2': FV.delete() }));
  await staffOnly('update renombra un viaje (nuevo + borra)',    db => month(db).update({ 'allocations.t3': trip, 'allocations.t2': FV.delete() }));
  await staffOnly('update reemplaza todo allocations',           db => month(db, '2026-08').update({ allocations: { t9: trip } }));
  await staffOnly('set(merge) de respaldo tras update fallido',  db => month(db, '2026-10').set({ allocations: { t7: trip } }, { merge: true }));
  await staffOnly('batch.update de varios meses (borrado)',      db => { const b = db.batch(); b.update(month(db), { 'allocations.t3': FV.delete() }); b.update(month(db, '2026-08'), { 'allocations.t9.guests': FV.delete() }); return b.commit(); });
  await staffOnly('plantilla: listener de staff',                db => listen(month(db, 'staff')));
  await staffOnly('plantilla: set del documento entero',         db => month(db, 'staff').set({ capitanes: [{ nombre: 'Abel' }], guias: [{ nombre: 'Rosa' }] }));
  await staffOnly('taller: listener reg_maintenance',            db => listen(month(db, 'reg_maintenance')));
  await staffOnly('taller: transacción get + update',            db => db.runTransaction(async tx => { const r = month(db, 'reg_maintenance'); await tx.get(r); tx.update(r, { tickets: [{ id: 'r1' }, { id: 'r2' }] }); }));
  await staffOnly('botellas: listener tank_inventory',           db => listen(month(db, 'tank_inventory')));
  await staffOnly('botellas: transacción get + update',          db => db.runTransaction(async tx => { const r = month(db, 'tank_inventory'); await tx.get(r); tx.update(r, { tanks: [{ id: 'k1' }, { id: 'k2' }] }); }));
  await staffOnly('actas: transacción que CREA tank_actas',      db => db.runTransaction(async tx => { const r = month(db, 'tank_actas'); const s = await tx.get(r); if (s.exists) tx.update(r, { actas: [{ id: 'a1' }] }); else tx.set(r, { actas: [{ id: 'a1' }] }); }));
  await staffOnly('actas: listener tank_actas',                  db => listen(month(db, 'tank_actas')));

  // -------------------------------------------------------------- customers
  results.push('\nMangamar Ops · mangamar_customers y su historial');
  await staffOnly('ficha: get',                                  db => db.collection('mangamar_customers').doc('12345678Z').get());
  await staffOnly('ficha: get de una que no existe',             db => db.collection('mangamar_customers').doc('99999999R').get());
  await staffOnly('ficha: set(merge)',                           db => db.collection('mangamar_customers').doc('12345678Z').set({ telefono: '600000000' }, { merge: true }));
  await staffOnly('ficha: set(merge) crea una nueva',            db => db.collection('mangamar_customers').doc('NUEVO1').set({ nombre: 'Nuevo' }, { merge: true }));
  await staffOnly('ficha: update seguro con FieldValue.delete',  db => db.collection('mangamar_customers').doc('87654321X').update({ insurance: FV.delete(), insuranceEdited: true }));
  await staffOnly('ficha: batch.set(merge) de deudas',           db => { const b = db.batch(); b.set(db.collection('mangamar_customers').doc('12345678Z'), { outstandingDebt: 45 }, { merge: true }); b.set(db.collection('mangamar_customers').doc('87654321X'), { outstandingDebt: 0 }, { merge: true }); return b.commit(); });
  await staffOnly('ficha: VENTA DIRECTA/history add',            db => db.collection('mangamar_customers').doc('VENTA DIRECTA').collection('history').add(h({ type: 'venta' })));
  await staffOnly('historial: get de un documento',              db => hist(db, '12345678Z', 't1').get());
  await staffOnly('historial: lista la subcolección',            db => db.collection('mangamar_customers').doc('12345678Z').collection('history').get());
  await staffOnly('historial: orderBy(date desc)',               db => db.collection('mangamar_customers').doc('12345678Z').collection('history').orderBy('date', 'desc').get());
  await staffOnly('historial: where paymentStatus == pending',   db => db.collection('mangamar_customers').doc('12345678Z').collection('history').where('paymentStatus', '==', 'pending').get());
  await staffOnly('historial: where type == pago',               db => db.collection('mangamar_customers').doc('12345678Z').collection('history').where('type', '==', 'pago').get());
  await staffOnly('historial: add (pago en caja)',               db => db.collection('mangamar_customers').doc('12345678Z').collection('history').add(h({ type: 'pago' })));
  await staffOnly('historial: set(merge)',                       db => hist(db, '12345678Z', 't1').set({ paymentStatus: 'paid' }, { merge: true }));
  await staffOnly('historial: update',                           db => hist(db, '12345678Z', 'dep1').update({ used: true }));
  await staffOnly('historial: delete',                           db => hist(db, '12345678Z', 'borrable').delete());
  await staffOnly('batch del manifiesto (set merge + delete)',   db => { const b = db.batch(); b.set(hist(db, '12345678Z', 't1'), { site: 'Carbonera' }, { merge: true }); b.set(hist(db, '87654321X', 't1'), { site: 'Carbonera' }, { merge: true }); b.delete(hist(db, '87654321X', 'viejo')); return b.commit(); });
  await staffOnly('batch de caja (pago nuevo + update + ficha)', db => { const b = db.batch(); b.set(db.collection('mangamar_customers').doc('12345678Z').collection('history').doc(), h({ type: 'pago' })); b.update(hist(db, '87654321X', 't1'), { paymentStatus: 'paid' }); b.set(db.collection('mangamar_customers').doc('87654321X'), { outstandingDebt: 0 }, { merge: true }); return b.commit(); });
  await staffOnly('mover buceador (batch.set sin merge + delete)', db => { const b = db.batch(); b.set(hist(db, '12345678Z', 't8'), h()); b.delete(hist(db, '12345678Z', 't7')); return b.commit(); });
  await staffOnly('mover buceador + mes en el mismo batch',      db => { const b = db.batch(); b.set(hist(db, '12345678Z', 't6'), h()); b.update(month(db), { 'allocations.t1.guests': [] }); return b.commit(); });
  await staffOnly('cambio de DNI: migra historial y borra ficha', async db => {
    const old = db.collection('mangamar_customers').doc('OLDDNI1');
    const snap = await old.collection('history').get();
    const b = db.batch();
    snap.forEach(d => { b.set(hist(db, 'NEWDNI1', d.id), d.data(), { merge: true }); b.delete(d.ref); });
    await b.commit();
    await db.collection('mangamar_customers').doc('NEWDNI1').set({ nombre: 'Pepe' }, { merge: true });
    await old.delete();
  });
  await staffOnly('borrar cliente (historial en batch + ficha)', async db => {
    const c = db.collection('mangamar_customers').doc('BORRAR1');
    const snap = await c.collection('history').get();
    const b = db.batch(); snap.forEach(d => b.delete(d.ref)); await b.commit();
    await c.delete();
  });

  // --------------------------------------------------------- collectionGroup
  results.push('\nMangamar Ops · consultas collectionGroup(history) (sólo lectura)');
  await staffOnly('CG certStatus == pendiente (listener)',       db => listen(db.collectionGroup('history').where('certStatus', '==', 'pendiente')));
  await staffOnly('CG certStatus == pendiente (get)',            db => db.collectionGroup('history').where('certStatus', '==', 'pendiente').get());
  await staffOnly('CG certStatus == procesado + orderBy + limit', db => db.collectionGroup('history').where('certStatus', '==', 'procesado').orderBy('processedAt', 'desc').limit(150).get());
  await staffOnly('CG paymentStatus == pending',                 db => db.collectionGroup('history').where('paymentStatus', '==', 'pending').get());
  await staffOnly('CG paidAt entre dos fechas',                  db => db.collectionGroup('history').where('paidAt', '>=', new Date('2026-07-01')).where('paidAt', '<=', new Date('2026-07-31T23:59:59Z')).get());
  await staffOnly('CG date entre dos textos',                    db => db.collectionGroup('history').where('date', '>=', '2026-07-01').where('date', '<=', '2026-07-31').get());
  await staffOnly('CG sin filtro (herramienta de borrado)',      db => db.collectionGroup('history').get());
  // La regla de grupo NO da escritura: sólo la ruta completa bajo mangamar_customers.
  await nobody('escribir un history fuera de mangamar_customers', db => db.collection('mangamar_directory').doc('settings').collection('history').doc('x').set({ a: 1 }));
  await nobody('escribir history bajo mangamar_monthly',          db => month(db).collection('history').doc('x').set({ a: 1 }));
  await nobody('escribir una colección raíz "history"',            db => db.collection('history').doc('x').set({ a: 1 }));

  // -------------------------------------------------------------- directory
  results.push('\nMangamar Ops · mangamar_directory (CRM y ajustes)');
  await staffOnly('CRM: listener master_list',                   db => listen(db.collection('mangamar_directory').doc('master_list')));
  await staffOnly('CRM: get de cada shard',                      db => Promise.all([db.collection('mangamar_directory').doc('master_list').get(), db.collection('mangamar_directory').doc('master_list_2').get()]));
  await staffOnly('CRM: batch.set shards + crmShardCount',       db => { const b = db.batch(); b.set(db.collection('mangamar_directory').doc('master_list'), { clients: [{ dni: '12345678Z' }] }); b.set(db.collection('mangamar_directory').doc('master_list_2'), { clients: [] }); b.set(db.collection('mangamar_directory').doc('master_list_3'), { clients: [] }); b.set(settings(db), { crmShardCount: 3 }, { merge: true }); return b.commit(); });
  await staffOnly('ajustes: listener',                           db => listen(settings(db)));
  await staffOnly('ajustes: get',                                db => settings(db).get());
  await staffOnly('ajustes: dniRedirects (merge)',               db => settings(db).set({ dniRedirects: { OLDDNI1: 'NEWDNI1' } }, { merge: true }));
  await staffOnly('ajustes: waTemplates (merge)',                db => settings(db).set({ waTemplates: [{ id: 'w1', text: 'Hola' }], waTemplateSections: ['General'] }, { merge: true }));
  await staffOnly('ajustes: staffOffTracking + radio (merge)',   db => settings(db).set({ staffOffTracking: { Abel: 'always' }, showTVRadioTimes: false }, { merge: true }));
  await staffOnly('ajustes: update de otro campo',               db => settings(db).update({ showTVRadioTimes: true }));
  await staffOnly('ajustes: reenviar adminPassword SIN cambiarlo', db => settings(db).set({ adminPassword: 'secreto-viejo', showTVRadioTimes: true }, { merge: true }));

  // Desde el 22/09/2026 adminPassword ya no está reservado a Tom: ningún
  // dispositivo entra como admin, y "Cambiar contraseña" tiene que seguir
  // funcionando desde los dispositivos del personal.
  results.push('\nMangamar Ops · adminPassword: lo cambia el personal (dispositivos, tienda y Tom)');
  await staffOnly('cambiar adminPassword (set merge, app.js)',   db => settings(db).set({ adminPassword: 'nuevo-' + Math.random() }, { merge: true }));
  await staffOnly('cambiar adminPassword (update)',              db => settings(db).update({ adminPassword: 'otro-' + Math.random() }));
  await staffOnly('adminPassword dentro de un batch con shards', db => { const b = db.batch(); b.set(db.collection('mangamar_directory').doc('master_list'), { clients: [] }); b.set(settings(db), { adminPassword: 'batch-' + Math.random() }, { merge: true }); return b.commit(); });
  await staffOnly('borrar el campo adminPassword',               db => settings(db).update({ adminPassword: FV.delete() }));
  await staffOnly('volver a poner adminPassword',                db => settings(db).set({ adminPassword: 'repuesto' }, { merge: true }));
  await staffOnly('set SIN merge que se lleva adminPassword',    db => settings(db).set({ crmShardCount: 3, showTVRadioTimes: true, dniRedirects: {}, waTemplates: [] }));
  await staffOnly('reponer adminPassword',                       db => settings(db).set({ adminPassword: 'repuesto' }, { merge: true }));
  await staffOnly('set SIN merge que conserva adminPassword',    db => settings(db).set({ adminPassword: 'repuesto', crmShardCount: 3, showTVRadioTimes: true, dniRedirects: {}, waTemplates: [] }));

  // ---------------------------------------------------------------- groups
  results.push('\nMangamar Ops · mangamar_groups');
  await staffOnly('listener de toda la colección',               db => listen(db.collection('mangamar_groups')));
  await staffOnly('set(merge) de un grupo',                      db => db.collection('mangamar_groups').doc('grp_2').set({ name: 'Bilbao', members: [], endDate: '2099-12-31' }, { merge: true }));
  await staffOnly('delete de un grupo',                          db => db.collection('mangamar_groups').doc('grp_2').delete());

  // ----------------------------------------------------------------- inbox
  results.push('\nMangamar Ops · mangamar_inbox (altas de Jotform)');
  await staffOnly('listener de toda la colección',               db => listen(db.collection('mangamar_inbox')));
  await staffOnly('batch.delete tras pasarlas al CRM',           db => { const b = db.batch(); b.delete(db.collection('mangamar_inbox').doc('11111111H')); b.delete(db.collection('mangamar_inbox').doc('22222222J')); return b.commit(); });
  await nobody('crear un alta desde el navegador (lo hace Make.com)', db => db.collection('mangamar_inbox').doc('33333333P').set({ nombre: '<img src=x onerror=alert(1)>' }));

  // ----------------------------------------------------- portal (servidor)
  results.push('\nMangamar Ops · portal de clientes: sólo el servidor escribe');
  await staffOnly('portal_logs: la tienda lista los accesos',    db => db.collection('mangamar_portal_logs').get());
  await staffOnly('portal_logs: get de uno',                     db => db.collection('mangamar_portal_logs').doc('12345678Z').get());
  await nobody('portal_logs: set(merge) desde el navegador',     db => db.collection('mangamar_portal_logs').doc('12345678Z').set({ portalLoginCount: 99 }, { merge: true }));
  await nobody('portal_logs: crear uno',                         db => db.collection('mangamar_portal_logs').doc('NUEVO').set({ dni: 'NUEVO' }));
  await nobody('portal_logs: borrar',                            db => db.collection('mangamar_portal_logs').doc('12345678Z').delete());
  await nobody('throttle: leer',                                 db => db.collection('mangamar_portal_throttle').doc('ip_1').get());
  await nobody('throttle: listar',                               db => db.collection('mangamar_portal_throttle').get());
  await nobody('throttle: escribir',                             db => db.collection('mangamar_portal_throttle').doc('ip_1').set({ attempts: 0 }));
  await nobody('throttle: borrar',                               db => db.collection('mangamar_portal_throttle').doc('ip_1').delete());

  // ----------------------------------------------- bonos, contactos, proyectos
  results.push('\nMangamar Ops · bonos, contactos, proyectos');
  await staffOnly('bonos: orderBy(createdAt desc) + listener',   db => listen(db.collection('mangamar_bonos').orderBy('createdAt', 'desc')));
  await staffOnly('bonos: set de uno nuevo',                     db => db.collection('mangamar_bonos').doc('b2').set({ createdAt: new Date(), buyer: 'Luis' }));
  await staffOnly('bonos: update',                               db => db.collection('mangamar_bonos').doc('b1').update({ used: ['2026-07-01'] }));
  await staffOnly('bonos: delete',                               db => db.collection('mangamar_bonos').doc('b2').delete());
  await staffOnly('contactos: listener',                         db => listen(db.collection('mangamar_contacts')));
  await staffOnly('contactos: add',                              db => db.collection('mangamar_contacts').add({ name: 'Taller' }));
  await staffOnly('contactos: set(merge)',                       db => db.collection('mangamar_contacts').doc('ct1').set({ phone: '600' }, { merge: true }));
  await staffOnly('contactos: delete',                           db => db.collection('mangamar_contacts').doc('ct2').delete());
  await staffOnly('proyectos: listener',                         db => listen(db.collection('mangamar_projects')));
  await staffOnly('proyectos: set(merge)',                       db => db.collection('mangamar_projects').doc('proj_2').set({ name: 'Barco' }, { merge: true }));
  await staffOnly('proyectos: delete',                           db => db.collection('mangamar_projects').doc('proj_2').delete());

  // ------------------------------------------------------ settings, horarios
  results.push('\nMangamar Ops · mangamar_settings y horarios');
  await staffOnly('tarifas: listener pricing',                   db => listen(db.collection('mangamar_settings').doc('pricing')));
  await staffOnly('tarifas: set del documento entero',           db => db.collection('mangamar_settings').doc('pricing').set({ items: [{ id: 'buceo', price: 48 }] }));
  await staffOnly('dispositivos: device_checkins merge (crea)',  (db) => db.collection('mangamar_settings').doc('device_checkins').set({ ['dev-' + (db === SHOP ? 'shop' : 'x')]: { email: 'mangamar@visor.local', build: '2026-09-21', at: new Date(), ua: 'Chrome' } }, { merge: true }));
  await staffOnly('dispositivos: device_checkins merge (otro)',  db => db.collection('mangamar_settings').doc('device_checkins').set({ 'dev-tv': { email: 'mangamar@visor.local', build: '2026-09-21', at: new Date(), ua: 'TV' } }, { merge: true }));
  await staffOnly('dispositivos: leer device_checkins',          db => db.collection('mangamar_settings').doc('device_checkins').get());
  await staffOnly('horarios: listener de un mes',                db => listen(db.collection('mangamar_staff_schedule').doc('2026-07')));
  await staffOnly('horarios: get de un mes',                     db => db.collection('mangamar_staff_schedule').doc('2026-08').get());
  await staffOnly('horarios: set del documento entero',          db => db.collection('mangamar_staff_schedule').doc('2026-07').set({ days: { '01': [] } }));

  // --------------------------------------------------------------- Visor
  results.push('\nMangamar Ops · lo que lee del Visor');
  // (Sección 2, sin cambios: es público para todos. Aquí sólo se comprueba que
  // la tienda con su nueva sesión lo sigue leyendo.)
  await should('reservations_monthly: listener  [tienda]',  true, listen(SHOP.collection('reservations_monthly').doc('2026-07')));
  await should('reservations_monthly: listener  [admin]',   true, listen(ADMIN.collection('reservations_monthly').doc('2026-07')));
  await should('reservations_monthly: listener  [dispositivo]', true, listen(DEVICE.collection('reservations_monthly').doc('2026-07')));

  // ------------------------------------------------ colecciones no listadas
  results.push('\nMangamar Ops · lo que NO está en la lista queda cerrado');
  await nobody('colección mangamar_secret: leer',                db => db.collection('mangamar_secret').doc('x').get());
  await nobody('colección mangamar_secret: escribir',            db => db.collection('mangamar_secret').doc('y').set({ a: 1 }));
  await nobody('colección mangamar_nueva: crear',                db => db.collection('mangamar_nueva').add({ a: 1 }));
  await nobody('subcolección customers/notes: leer',             db => db.collection('mangamar_customers').doc('12345678Z').collection('notes').doc('n1').get());
  await nobody('subcolección customers/notes: escribir',         db => db.collection('mangamar_customers').doc('12345678Z').collection('notes').doc('n2').set({ a: 1 }));
  await nobody('subcolección bajo mangamar_monthly: escribir',   db => month(db).collection('extra').doc('x').set({ a: 1 }));
  await nobody('subcolección bajo mangamar_directory: leer',     db => settings(db).collection('extra').doc('x').get());
  await nobody('historial anidado (history/x/history/y)',        db => hist(db, '12345678Z', 't1').collection('history').doc('y').set({ a: 1 }));

  // -------------------------------------------- borrados que la app no hace
  results.push('\nMangamar Ops · borrados de documentos enteros que la app no hace: sólo Tom');
  await adminOnly('borrar un mes entero',                        db => month(db, '2026-10').delete());
  await adminOnly('borrar un shard del CRM',                     db => db.collection('mangamar_directory').doc('master_list_3').delete());
  await adminOnly('borrar device_checkins',                      db => db.collection('mangamar_settings').doc('device_checkins').delete());
  await adminOnly('borrar las tarifas',                          db => db.collection('mangamar_settings').doc('pricing').delete());
  await adminOnly('borrar un documento del CRM (master_list)',   db => db.collection('mangamar_directory').doc('master_list_2').delete());

  // ------------------------------------------------ settings recién creado
  results.push('\nMangamar Ops · crear ajustes desde cero');
  await adminOnly('borrar mangamar_directory/settings',          db => settings(db).delete());
  await should('dispositivo pendiente crea settings',            false, settings(DEV_PEND).set({ adminPassword: 'x' }, { merge: true }));
  await should('dispositivo crea settings CON adminPassword (semilla de firebase-service.js)', true, settings(DEVICE).set({ adminPassword: 'manga321', showTVRadioTimes: true }, { merge: true }));
  await adminOnly('borrar mangamar_directory/settings otra vez', db => settings(db).delete());
  await should('tienda crea settings CON adminPassword (semilla de firebase-service.js)', true, settings(SHOP).set({ adminPassword: 'manga321', showTVRadioTimes: true }, { merge: true }));
  await should('tienda añade campos SIN adminPassword',           true,  settings(SHOP).set({ staffOffTracking: { Abel: 'always' } }, { merge: true }));
  await should('admin cambia adminPassword',                      true,  settings(ADMIN).set({ adminPassword: 'nuevo' }, { merge: true }));

  // ------------------------------------------------- dispositivos conectados
  results.push('\nMangamar Ops · mangamar_devices (lista "Dispositivos conectados")');
  const devRef = (db, uid) => db.collection('mangamar_devices').doc(uid);
  const review = (status) => ({ status, reviewedAt: FV.serverTimestamp() });
  await staffOnly('leer la lista de dispositivos',               db => db.collection('mangamar_devices').get());
  await staffOnly('leer la ficha de un dispositivo',             db => devRef(db, 'dev_target').get());
  // Aprobar / quitar otro dispositivo (setStatus de device-login.js)
  await nobody('aprobar otro dispositivo desde el navegador (sólo el servidor)',        db => devRef(db, 'dev_target').update(review('approved')));
  await nobody('quitar otro dispositivo desde el navegador (sólo el servidor)',         db => devRef(db, 'dev_target').update(review('revoked')));
  await nobody('sólo status, sin reviewedAt',                 db => devRef(db, 'dev_target').update({ status: 'approved' }));
  // Lo que NO se puede tocar desde el navegador
  await nobody('status a "pending"',                             db => devRef(db, 'dev_target').update(review('pending')));
  await nobody('status a un valor inventado',                    db => devRef(db, 'dev_target').update(review('admin')));
  await nobody('status no textual (true)',                       db => devRef(db, 'dev_target').update(review(true)));
  await nobody('borrar el campo status',                         db => devRef(db, 'dev_target').update({ status: FV.delete() }));
  for (const k of ['secretHash', 'role', 'ua', 'createdAt', 'lastSeen', 'approvedBy']) {
    await nobody(`cambiar ${k}`,                                 db => devRef(db, 'dev_target').update({ [k]: k.endsWith('At') || k === 'lastSeen' ? new Date() : 'x' }));
    await nobody(`aprobar y a la vez cambiar ${k}`,              db => devRef(db, 'dev_target').update({ ...review('approved'), [k]: k.endsWith('At') || k === 'lastSeen' ? new Date() : 'x' }));
  }
  await nobody('borrar el campo secretHash',                     db => devRef(db, 'dev_target').update({ secretHash: FV.delete() }));
  await nobody('añadir un campo nuevo',                          db => devRef(db, 'dev_target').update({ ...review('approved'), extra: 1 }));
  // reviewedAt sólo con la hora del servidor
  await nobody('reviewedAt con fecha del navegador (antigua)',    db => devRef(db, 'dev_target').update({ status: 'approved', reviewedAt: new Date('2020-01-01') }));
  await nobody('reviewedAt con fecha del navegador (hace 1 min)', db => devRef(db, 'dev_target').update({ status: 'revoked', reviewedAt: new Date(Date.now() - 60000) }));
  await nobody('reviewedAt como texto',                          db => devRef(db, 'dev_target').update({ status: 'approved', reviewedAt: 'ayer' }));
  await nobody('borrar el campo reviewedAt',                     db => devRef(db, 'dev_target').update({ status: 'approved', reviewedAt: FV.delete() }));
  await nobody('set SIN merge que reescribe la ficha',           db => devRef(db, 'dev_target').set({ status: 'approved', reviewedAt: FV.serverTimestamp() }));
  await nobody('set(merge) con secretHash propio',               db => devRef(db, 'dev_target').set({ status: 'approved', secretHash: 'f'.repeat(64) }, { merge: true }));
  await nobody('crear una ficha de dispositivo',                 db => devRef(db, 'dev_new').set({ status: 'approved', secretHash: 'f'.repeat(64), role: 'staff' }));
  await nobody('crear una ficha con sólo status (update-like set)', db => devRef(db, 'dev_new2').set(review('approved')));
  await nobody('update de una ficha que no existe',              db => devRef(db, 'dev_new3').update(review('approved')));
  await nobody('borrar la ficha de otro dispositivo',            db => devRef(db, 'dev_target').delete());
  await nobody('borrar mi propia ficha (dispositivo aprobado)',  db => devRef(db, 'dev_ok').delete());
  await nobody('subcolección bajo mangamar_devices',             db => devRef(db, 'dev_ok').collection('x').doc('y').set({ a: 1 }));
  // Auto-aprobación y vuelta atrás
  await should('dispositivo PENDIENTE se aprueba a sí mismo',    false, devRef(DEV_PEND, 'dev_pend').update(review('approved')));
  await should('dispositivo QUITADO se vuelve a aprobar',        false, devRef(DEV_REV, 'dev_rev').update(review('approved')));
  await should('dispositivo PENDIENTE aprueba a otro',           false, devRef(DEV_PEND, 'dev_target').update(review('approved')));
  await should('dispositivo QUITADO quita a uno aprobado',       false, devRef(DEV_REV, 'dev_ok').update(review('revoked')));
  await should('dispositivo PENDIENTE lee la lista',             false, DEV_PEND.collection('mangamar_devices').get());
  await should('dispositivo QUITADO lee su propia ficha',        false, devRef(DEV_REV, 'dev_rev').get());
  // Quitar corta el acceso al momento (el token sigue vivo, la ficha no)
  const DEV2 = dev('dev_ok2', devClaims);
  await should('dev_ok2 aprobado lee clientes',                  true,  DEV2.collection('mangamar_customers').doc('12345678Z').get());
  await should('dev_ok intenta quitar a dev_ok2 desde el navegador', false, devRef(DEVICE, 'dev_ok2').update(review('revoked')));
  await testEnv.withSecurityRulesDisabled(ctx => ctx.firestore().collection('mangamar_devices').doc('dev_ok2').update({ status: 'revoked' }));   // el servidor lo quita
  await should('dev_ok2 quitado ya NO lee clientes',             false, DEV2.collection('mangamar_customers').doc('12345678Z').get());
  await should('dev_ok2 quitado ya NO escribe un mes',           false, month(DEV2).update({ 'allocations.t1.site': 'x' }));
  await should('dev_ok2 quitado NO se vuelve a aprobar',         false, devRef(DEV2, 'dev_ok2').update(review('approved')));
  await should('dev_ok intenta volver a aprobar a dev_ok2 desde el navegador', false, devRef(DEVICE, 'dev_ok2').update(review('approved')));
  await testEnv.withSecurityRulesDisabled(ctx => ctx.firestore().collection('mangamar_devices').doc('dev_ok2').update({ status: 'approved' }));   // el servidor lo vuelve a aprobar
  await should('dev_ok2 aprobado otra vez lee clientes',         true,  DEV2.collection('mangamar_customers').doc('12345678Z').get());
  await should('dispositivo aprobado se quita a sí mismo desde el navegador', false, devRef(DEV2, 'dev_ok2').update(review('revoked')));
  await should('... así que sigue entrando (sólo el servidor puede quitarlo)', true, DEV2.collection('mangamar_customers').doc('12345678Z').get());
  await testEnv.withSecurityRulesDisabled(ctx => ctx.firestore().collection('mangamar_devices').doc('dev_ok2').update({ status: 'revoked' }));   // el servidor lo quita
  await should('quitado por el servidor: ya no entra',          false, DEV2.collection('mangamar_customers').doc('12345678Z').get());
  await should('dev_ok sigue aprobado tras estas pruebas (nadie malo lo ha quitado)', true,
    testEnv.withSecurityRulesDisabled(ctx => ctx.firestore().collection('mangamar_devices').doc('dev_ok').get().then(s => { if (s.data().status !== 'approved') throw new Error('dev_ok ya no está aprobado'); })));

  // ------------------------------------- REVISIÓN ADVERSARIA (22/09/2026)
  results.push('\nREVISIÓN ADVERSARIA · dispositivos: fichas raras, lotes grandes, accesos de la app');
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const base = { secretHash: 'h'.repeat(64), role: 'staff', ua: 'Chrome', createdAt: new Date('2026-09-22'), lastSeen: new Date('2026-09-22'), approvedBy: '' };
    await db.collection('mangamar_devices').doc('dev_case').set({ ...base, status: 'Approved' });
    await db.collection('mangamar_devices').doc('dev_space').set({ ...base, status: 'approved ' });
    await db.collection('mangamar_devices').doc('dev_nostat').set({ ...base });
    await db.collection('mangamar_devices').doc('dev_bool').set({ ...base, status: true });
    await db.collection('mangamar_devices').doc('dev_list').set({ ...base, status: ['approved'] });
    await db.collection('mangamar_devices').doc('dev_tgt2').set({ ...base, status: 'pending' });
    for (let i = 0; i < 40; i++) await db.collection('mangamar_inbox').doc('adv_inbox_' + i).set({ nombre: 'x' + i });
  });
  for (const uid of ['dev_case', 'dev_space', 'dev_nostat', 'dev_bool', 'dev_list']) {
    const X = dev(uid, devClaims);
    await should(`ficha con status raro (${uid}) lee clientes`,        false, X.collection('mangamar_customers').doc('12345678Z').get());
    await should(`ficha con status raro (${uid}) se aprueba sola`,     false, devRef(X, uid).update(review('approved')));
    await should(`ficha con status raro (${uid}) lee la lista`,        false, X.collection('mangamar_devices').get());
  }
  // uid de otro tipo con la marca: 'dev_ok' en mayúsculas no es la ficha dev_ok
  await should('uid DEV_OK (mayúsculas) con marca lee clientes',        false, dev('DEV_OK', devClaims).collection('mangamar_customers').doc('12345678Z').get());
  // Consultas de la lista (la app hace get() sin filtros, pero una consulta filtrada debe ir igual)
  await should('dispositivo aprobado: lista filtrada por status',       true,  DEVICE.collection('mangamar_devices').where('status', '==', 'pending').get());
  await should('dispositivo pendiente: lista filtrada por status',      false, DEV_PEND.collection('mangamar_devices').where('status', '==', 'approved').get());
  await should('dispositivo pendiente: escucha la lista (onSnapshot)',  false, listen(DEV_PEND.collection('mangamar_devices')));
  // Sólo reviewedAt: aceptable sobre una aprobada; sobre una pendiente no (status no está en la lista)
  await should('dispositivo aprobado toca sólo reviewedAt de uno aprobado', false, devRef(DEVICE, 'dev_ok').update({ reviewedAt: FV.serverTimestamp() }));
  await should('dispositivo aprobado toca sólo reviewedAt de uno pendiente', false, devRef(DEVICE, 'dev_tgt2').update({ reviewedAt: FV.serverTimestamp() }));
  await should('set(merge) con status+reviewedAt (otra forma de aprobar)', false, devRef(DEVICE, 'dev_tgt2').set(review('approved'), { merge: true }));
  await should('... y quitarlo con un lote',                            false,  (() => { const b = DEVICE.batch(); b.update(devRef(DEVICE, 'dev_tgt2'), review('revoked')); return b.commit(); })());
  await should('lote: aprobar a otro + crear una ficha nueva',          false, (() => { const b = DEVICE.batch(); b.update(devRef(DEVICE, 'dev_tgt2'), review('approved')); b.set(devRef(DEVICE, 'dev_evil'), { status: 'approved' }); return b.commit(); })());
  await should('transacción: dispositivo pendiente lee su ficha y se aprueba', false, DEV_PEND.runTransaction(async tx => { await tx.get(devRef(DEV_PEND, 'dev_pend')); tx.update(devRef(DEV_PEND, 'dev_pend'), review('approved')); }));
  // Lotes grandes con dispositivo (cada escritura evalúa exists()+get() de la misma ficha)
  await should('dispositivo: lote de 450 set(merge) de outstandingDebt (crm-profile.js debtBatch)', true,
    (() => { const b = DEVICE.batch(); for (let i = 0; i < 450; i++) b.set(DEVICE.collection('mangamar_customers').doc('ADV' + i), { outstandingDebt: i }, { merge: true }); return b.commit(); })());
  await should('dispositivo: lote que borra 40 altas del inbox (tryFoldInbox)', true,
    DEVICE.collection('mangamar_inbox').get().then(s => { const b = DEVICE.batch(); s.docs.filter(d => d.id.startsWith('adv_inbox_')).forEach(d => b.delete(d.ref)); return b.commit(); }));
  await should('dispositivo: transacción de botellas (tank-inventory.js)', true,
    DEVICE.runTransaction(async tx => { const s = await tx.get(month(DEVICE, 'tank_inventory')); tx.set(month(DEVICE, 'tank_inventory'), { tanks: (s.data().tanks || []) }, { merge: true }); }));
  await should('dispositivo: lote de historial 20 docs + mes (manifest-editor.js)', true,
    (() => { const b = DEVICE.batch(); for (let i = 0; i < 20; i++) b.set(hist(DEVICE, '12345678Z', 'advh' + i), h()); b.update(month(DEVICE), { 'allocations.t1.site': 'Piles' }); return b.commit(); })());
  // Fuera de mangamar_*: el dispositivo NO es admin de Bajo de Fuera (sección 1 mira el email)
  await should('dispositivo aprobado escribe bdf_days',                 false, DEVICE.collection('bdf_days').doc('2026-07-01').set({ salidas: [] }));
  await should('dispositivo aprobado escribe bdf_requests',             false, DEVICE.collection('bdf_requests').doc('x').set({ a: 1 }));
  await should('dispositivo aprobado lee reservations_monthly (app.js/crm-profile.js)', true, DEVICE.collection('reservations_monthly').doc('2026-07').get());
  // Límite conocido de la sección 2 (no se toca aquí): cualquier sesión, incluido un dispositivo QUITADO, escribe en config/swaps/…
  await should('LÍMITE CONOCIDO: dispositivo QUITADO escribe config (sección 2 = isSignedIn)', true, DEV_REV.collection('config').doc('adv').set({ a: 1 }));
  await testEnv.withSecurityRulesDisabled(ctx => ctx.firestore().collection('config').doc('adv').delete());

  // ------------------------------- LÍMITE CONOCIDO: historial ajeno (sección 2)
  // La sección 2 (sin cambios) deja escribir reservations_monthly/{doc=**} y
  // swaps/{doc=**} a CUALQUIER cuenta con sesión, y la regla de grupo
  // {path=**}/history da lectura a toda subcolección 'history'. Así que las
  // REGLAS no pueden impedir que un 'history' ajeno salga en las consultas
  // collectionGroup('history') de la tienda, ni que la tienda lo borre. Eso lo
  // arregla la APP: firebase-service.js window.isMangamarHistoryDoc descarta
  // todo lo que no sea exactamente mangamar_customers/{dni}/history/{id}.
  // Estas pruebas FIJAN el comportamiento actual de las reglas (si algún día
  // se cierra la sección 2, cambiarán y habrá que revisarlas) y comprueban que
  // el filtro de la app deja sólo lo de Mangamar.
  results.push('\nLÍMITE CONOCIDO · historial ajeno en collectionGroup(history) (lo filtra la app)');
  const MOON = pwd('rv-moon', 'moondive@visor.local');
  const GMAIL = pwd('rv-gmail', 'x@gmail.com');
  await should('otra escuela crea reservations_monthly/2026-07/history/fake (sección 2 lo permite)', true,
    MOON.collection('reservations_monthly').doc('2026-07').collection('history').doc('fake').set(h({ course: 'Open Water <img src=x onerror=alert(1)>', price: 9999 })));
  await should('cuenta registrada por su cuenta crea swaps/a/history/fake2 (sección 2 lo permite)', true,
    GMAIL.collection('swaps').doc('a').collection('history').doc('fake2').set(h({ price: 5000 })));
  // Copia exacta de window.isMangamarHistoryDoc (firebase-service.js)
  const isMangamarHistoryDoc = (d) => { const parts = String((d && d.ref && d.ref.path) || '').split('/'); return parts.length === 4 && parts[0] === 'mangamar_customers' && parts[2] === 'history'; };
  const foreignThenFiltered = async (q) => {
    const s = await q.get();
    const foreign = s.docs.filter(d => !isMangamarHistoryDoc(d)).map(d => d.ref.path);
    if (!foreign.includes('reservations_monthly/2026-07/history/fake') || !foreign.includes('swaps/a/history/fake2'))
      throw new Error('las reglas ya NO devuelven el historial ajeno: revisar esta sección (' + foreign.join(', ') + ')');
    const kept = s.docs.filter(isMangamarHistoryDoc);
    if (!kept.length) throw new Error('el filtro de la app no deja nada de mangamar_customers');
    return s;
  };
  for (const [who, db] of [['tienda', SHOP], ['dispositivo', DEVICE]]) {
    await should(`certificados pendientes: las reglas devuelven historial ajeno, el filtro de la app lo quita  [${who}]`, true,
      foreignThenFiltered(db.collectionGroup('history').where('certStatus', '==', 'pendiente')));
    await should(`deudas (paymentStatus==pending): las reglas devuelven historial ajeno, el filtro lo quita  [${who}]`, true,
      foreignThenFiltered(db.collectionGroup('history').where('paymentStatus', '==', 'pending')));
    await should(`contabilidad (paidAt en rango): las reglas devuelven historial ajeno, el filtro lo quita  [${who}]`, true,
      foreignThenFiltered(db.collectionGroup('history').where('paidAt', '>=', new Date('2026-07-01')).where('paidAt', '<=', new Date('2026-07-31'))));
  }
  await should('sección 2 PERMITE a la tienda borrar historial del Visor (la herramienta de borrado lo evita con el filtro)', true,
    SHOP.collection('reservations_monthly').doc('2026-07').collection('history').doc('fake').delete());
  // Lo que las reglas SÍ garantizan: nadie de fuera escribe historial de Mangamar.
  await should('otra escuela escribe historial bajo mangamar_customers', false,
    MOON.collection('mangamar_customers').doc('12345678Z').collection('history').doc('fake').set(h({ price: 9999 })));
  await should('dispositivo pendiente escribe historial bajo mangamar_customers', false,
    DEV_PEND.collection('mangamar_customers').doc('12345678Z').collection('history').doc('fake').set(h({ price: 9999 })));

  // ------------------------------------ herramientas de borrado (al final)
  results.push('\nMangamar Ops · herramienta de borrado (destructiva, va la última)');
  await staffOnly('borrado: CG history get + delete de cada uno', async db => { const s = await db.collectionGroup('history').get(); await Promise.all(s.docs.map(d => d.ref.delete())); });
  await staffOnly('borrado: grupos get + delete de cada uno',    async db => { const s = await db.collection('mangamar_groups').get(); await Promise.all(s.docs.map(d => d.ref.delete())); });
  await staffOnly('borrado: batch.update de meses',              db => { const b = db.batch(); b.update(month(db), { allocations: {} }); b.update(month(db, '2026-08'), { allocations: {} }); return b.commit(); });
}
