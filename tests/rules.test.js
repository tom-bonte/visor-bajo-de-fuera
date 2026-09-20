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
  await should('centro escribe su propio día (10 pl.)',            true, M.collection('bdf_days').doc('2026-07-02').set(day([salida('M', 10)])));
  await should('centro escribe un día con DOS escuelas (permuta)', true, M.collection('bdf_days').doc('2026-07-03').set(day([salida('M', 8), salida('D', 12)])));
  await should('día justo en el tope de 30 plazas',                true, M.collection('bdf_days').doc('2026-07-04').set(day([salida('M', 12), salida('D', 10), salida('H', 8)])));
  await should('las 8 escuelas en un mismo día',                   true, M.collection('bdf_days').doc('2026-07-05').set(day(['MD','H','M','N','P','D','C','X'].map(c => salida(c, 3)))));
  await should('nota normal en una salida',                        true, M.collection('bdf_days').doc('2026-07-06').set(day([salida('M', 5, { note: 'Grupo de Madrid, llegan tarde' })])));
  await should('centro propone EN SU NOMBRE',                      true, M.collection('bdf_requests').add({ type: 'swap', status: 'pending', initiatorCenter: 'M', targetCenter: 'D' }));
  await should('el destinatario acepta/rechaza (borra)',           true, D.collection('bdf_requests').doc('req-MD').delete());
  await should('centro firma el historial con SU clave',           true, M.collection('bdf_history_logs').add({ actionType: 'add_salida', centerKey: 'mangamar', details: {} }));
  await should('invitado LEE el calendario',                       true, G.collection('bdf_days').doc('2026-07-01').get());
  await should('admin borra un día entero',                        true, A.collection('bdf_days').doc('2026-07-01').delete());

  results.push('\nSuplantación: actuar en nombre de otra escuela');
  await should('propuesta fingiendo ser Islas Hormigas',          false, M.collection('bdf_requests').add({ type: 'swap', status: 'pending', initiatorCenter: 'H', targetCenter: 'D' }));
  await should('historial firmado como otra escuela',             false, M.collection('bdf_history_logs').add({ actionType: 'add_salida', centerKey: 'hormigas', details: {} }));
  await testEnv.withSecurityRulesDisabled(async (ctx) => { await ctx.firestore().collection('bdf_requests').doc('req-MD2').set({ type: 'request', status: 'pending', initiatorCenter: 'M', targetCenter: 'D', date: '2026-07-01' }); });
  await should('un tercero cancela una propuesta ajena',          false, N.collection('bdf_requests').doc('req-MD2').delete());
  await should('un tercero caduca una propuesta ajena',           false, N.collection('bdf_requests').doc('req-MD2').update({ status: 'expired' }));

  await should('borrar una solicitud que ya no existe',           false, N.collection('bdf_requests').doc('no-existe').delete());
  await should('solicitud sin initiatorCenter',                   false, M.collection('bdf_requests').add({ type: 'swap', status: 'pending', targetCenter: 'D' }));
  await should('entrada de historial sin centerKey',              false, M.collection('bdf_history_logs').add({ actionType: 'add_salida', details: {} }));

  results.push('\nDatos imposibles en un día');
  await should('el día suma 40 plazas',                           false, M.collection('bdf_days').doc('2026-07-10').set(day([salida('M', 20), salida('D', 20)])));
  await should('una salida con 99 plazas',                        false, M.collection('bdf_days').doc('2026-07-11').set(day([salida('M', 99)])));
  await should('una salida con 0 plazas',                         false, M.collection('bdf_days').doc('2026-07-12').set(day([salida('M', 0)])));
  await should('plazas en texto en vez de número',                false, M.collection('bdf_days').doc('2026-07-13').set(day([salida('M', '10')])));
  await should('una escuela inventada',                           false, M.collection('bdf_days').doc('2026-07-14').set(day([salida('ZZZ', 5)])));
  await should('9 registros en un día (hay 8 escuelas)',          false, M.collection('bdf_days').doc('2026-07-15').set(day([...['MD','H','M','N','P','D','C','X'].map(c => salida(c, 1)), salida('M', 1)])));
  await should('una nota de 500 caracteres',                      false, M.collection('bdf_days').doc('2026-07-16').set(day([salida('M', 5, { note: 'x'.repeat(500) })])));

  results.push('\nSin sesión iniciada');
  await should('invitado escribe en el calendario',               false, G.collection('bdf_days').doc('2026-07-20').set(day([salida('M', 5)])));
  await should('invitado lee las solicitudes',                    false, G.collection('bdf_requests').doc('req-MD2').get());
  await should('centro borra un día entero (sólo admin)',         false, M.collection('bdf_days').doc('2026-07-03').delete());

  results.push('\nLas otras dos apps (sin cambios desde la ronda anterior)');
  await should('extraño ESCRIBE en Cabo de Palos',                false, G.collection('reservations_monthly').doc('2026-07').set({ hacked: true }));
  await should('extraño LEE Cabo de Palos',                        true, G.collection('reservations_monthly').doc('2026-07').get());
  await should('centro con sesión escribe en Cabo de Palos',       true, M.collection('reservations_monthly').doc('2026-08').set({ allocations: {} }));
  await should('Mangamar Ops lee sus datos',                       true, G.collection('mangamar_customers').doc('c1').get());
  await should('Mangamar Ops escribe sus datos',                   true, G.collection('mangamar_customers').doc('c2').set({ name: 'y' }));

  console.log(results.join('\n'));
  console.log(`\n${fail === 0 ? '✅' : '❌'}  ${pass} correctas, ${fail} fallidas\n`);
  await testEnv.cleanup();
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('ERROR:', e); process.exit(2); });
