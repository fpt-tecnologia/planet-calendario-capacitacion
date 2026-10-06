// Cierre mensual automático (zona America/Mexico_City).
// Marca como "Realizada" las capacitaciones de meses ya terminados que no estén canceladas.
// No toca registros sin fecha ni canceladas. Es idempotente: repetirlo no duplica movimientos.
// Uso: FIREBASE_SERVICE_ACCOUNT='<json>' node scripts/cierre-mensual.mjs
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { createRequire } from 'node:module';
const PL = createRequire(import.meta.url)('../js/lib.js');

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
if (!sa.project_id) { console.error('Falta el secreto FIREBASE_SERVICE_ACCOUNT.'); process.exit(1); }
initializeApp({ credential: cert(sa) });
const db = getFirestore();

const hoy = PL.todayMX();
const snap = await db.collection('capacitaciones').get();
const recs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
const pend = PL.pendingClosures(recs, hoy);
console.log(`Hoy (CDMX): ${hoy}. Pendientes de cierre: ${pend.length}`);
const porMes = {};
for (const p of pend) {
  const ref = db.doc('capacitaciones/' + p.id);
  await db.runTransaction(async (tx) => {
    const s = await tx.get(ref); const r = s.data();
    if (!r || r.estado === 'Cancelada' || r.estado === 'Realizada') return;
    const ts = new Date().toISOString();
    tx.update(ref, { estado: 'Realizada', cierreAuto: { mes: p.mes, ts, estadoAnterior: r.estado || '', origen: 'programado' } });
    tx.set(db.doc(`historial/auto-${p.id}-${p.mes}`), { ts, por: 'sistema', auto: true, accion: 'Cierre automático', calId: p.id, nombre: r.nombre || '', detalle: `Mes ${p.mes}: “${r.estado || 'sin estado'}” → “Realizada” (proceso programado)` });
    (porMes[p.mes] = porMes[p.mes] || []).push(p.id);
  });
}
for (const [mes, ids] of Object.entries(porMes)) {
  await db.doc('cierres/' + mes).set({ mes, ultimaEjecucion: new Date().toISOString(), ids: FieldValue.arrayUnion(...ids) }, { merge: true });
  console.log(`Cerradas ${ids.length} en ${mes}`);
}
console.log('Listo.');
