// Pruebas de las reglas de seguridad con el emulador de Firestore.
// Ejecutar: npm run test:rules   (requiere Java; en CI corre en GitHub Actions)
import { readFileSync } from 'node:fs';
import { test, before, after, beforeEach } from 'node:test';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';

const PROJECT = 'planet-cal-test';
let env;

// Fechas relativas a hoy en Ciudad de México (UTC-6)
const mx = (d = 0) => { const t = new Date(Date.now() - 6 * 3600e3 + d * 86400e3); return t.toISOString().slice(0, 10); };
const hoy = mx();
const [Y, M] = hoy.split('-').map(Number);
const pad = (n) => String(n).padStart(2, '0');
const mesPasado = M === 1 ? `${Y - 1}-12-15` : `${Y}-${pad(M - 1)}-15`;
const mesSiguiente = M === 12 ? `${Y + 1}-01-15` : `${Y}-${pad(M + 1)}-15`;
const enMesActual = `${Y}-${pad(M)}-${hoy.slice(8, 10)}`;
const feriado = `${Y + 1}-12-25`;
const futuro = mx(20) === feriado ? mx(21) : mx(20);

const cap = (o = {}) => ({ nombre: 'Capacitación', programa: '', tema: '', tipo: 'Online', modalidad: 'Online', area: '', facilitador: '', publicos: ['R1'], perfil: '', clubApertura: '', clubes: '', ciudad: '', sede: '', fecha: mesSiguiente, horaInicio: '10:00', horaFin: '11:00', numDia: '', enlace: '', estado: 'Programada', origen: 'manual', revision: [], cierreAuto: null, ...o });
const as = (email) => env.authenticatedContext(email, { email, email_verified: true }).firestore();
const ADMIN = 'jair@fpt.com.mx', REG = 'regional@fpt.com.mx', GER = 'gerente@fpt.com.mx', EXT = 'otro@gmail.com';

before(async () => {
  env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 } });
});
after(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc('config/roles').set({ admins: [ADMIN], dominios: ['fpt.com.mx'], lectores: [] });
    await db.doc('config/bloqueos').set({ fechas: [feriado] });
    await db.doc('regionales/' + REG).set({ regiones: ['R2'], activo: true });
    await db.doc('capacitaciones/c1').set(cap());
    await db.doc('capacitaciones/pasada').set(cap({ fecha: mesPasado }));
    await db.doc('capacitaciones/actual').set(cap({ fecha: enMesActual }));
    await db.doc('notas/c1').set({ texto: 'privada' });
    await db.doc('propuestas/p1').set({ nombre: 'X', fecha: futuro, region: 'R2', email: REG, enviado: 'x', estado: 'Pendiente' });
  });
});

test('bootstrap: sin config/roles sólo el correo inicial es administrador', async () => {
  await env.withSecurityRulesDisabled((ctx) => ctx.firestore().doc('config/roles').delete());
  await assertSucceeds(as(ADMIN).doc('config/roles').set({ admins: [ADMIN], dominios: [], lectores: [] }));
  await env.withSecurityRulesDisabled((ctx) => ctx.firestore().doc('config/roles').delete());
  await assertFails(as(GER).doc('config/roles').set({ admins: [GER], dominios: [], lectores: [] }));
});
test('correo no verificado no lee', async () => {
  const db = env.authenticatedContext(GER, { email: GER, email_verified: false }).firestore();
  await assertFails(db.doc('capacitaciones/c1').get());
});
test('gerente del dominio lee calendario pero no notas, historial, roles ni propuestas', async () => {
  const db = as(GER);
  await assertSucceeds(db.doc('capacitaciones/c1').get());
  await assertFails(db.doc('notas/c1').get());
  await assertFails(db.collection('historial').get());
  await assertFails(db.doc('config/roles').get());
  await assertFails(db.collection('propuestas').get());
});
test('gerente no puede escribir', async () => {
  await assertFails(as(GER).doc('capacitaciones/c2').set(cap()));
  await assertFails(as(GER).doc('capacitaciones/c1').update({ nombre: 'Hack' }));
});
test('correo externo sin autorización no lee', async () => {
  await assertFails(as(EXT).doc('capacitaciones/c1').get());
});
test('sin sesión no lee', async () => {
  await assertFails(env.unauthenticatedContext().firestore().doc('capacitaciones/c1').get());
});
test('administradora crea; no en feriado; bootcamp exige club', async () => {
  const db = as(ADMIN);
  await assertSucceeds(db.doc('capacitaciones/n1').set(cap()));
  await assertFails(db.doc('capacitaciones/n2').set(cap({ fecha: feriado })));
  await assertFails(db.doc('capacitaciones/n3').set(cap({ tipo: 'Bootcamp', modalidad: 'Presencial', clubApertura: '' })));
  await assertSucceeds(db.doc('capacitaciones/n4').set(cap({ tipo: 'Bootcamp', modalidad: 'Presencial', clubApertura: 'Toluca' })));
  await assertSucceeds(db.doc('capacitaciones/n5').set(cap({ fecha: feriado, origen: 'importacion', revision: ['feriado'] })));
});
test('estado: sólo mes en curso; cierre automático en meses pasados', async () => {
  const db = as(ADMIN);
  await assertFails(db.doc('capacitaciones/c1').update({ estado: 'Cancelada' }));
  await assertSucceeds(db.doc('capacitaciones/actual').update({ estado: 'Realizada' }));
  await assertFails(db.doc('capacitaciones/pasada').update({ estado: 'Realizada' }));
  await assertSucceeds(db.doc('capacitaciones/pasada').update({ estado: 'Realizada', cierreAuto: { mes: mesPasado.slice(0, 7), ts: 'x' } }));
  await assertFails(db.doc('capacitaciones/c1').update({ estado: 'Realizada', cierreAuto: { mes: mesSiguiente.slice(0, 7), ts: 'x' } }));
});
test('sólo la administradora elimina del calendario; el historial no se borra', async () => {
  await assertFails(as(GER).doc('capacitaciones/c1').delete());
  await assertFails(as(REG).doc('capacitaciones/c1').delete());
  await assertFails(as(EXT).doc('capacitaciones/c1').delete());
  await assertSucceeds(as(ADMIN).doc('capacitaciones/c1').delete());
  await env.withSecurityRulesDisabled((ctx) => ctx.firestore().doc('historial/h1').set({ a: 1 }));
  await assertFails(as(ADMIN).doc('historial/h1').delete());
});
test('regional propone sólo en sus regiones, desde hoy y fuera de feriados', async () => {
  const db = as(REG);
  const p = (o) => ({ nombre: 'Taller', fecha: futuro, region: 'R2', email: REG, enviado: 'x', estado: 'Pendiente', ...o });
  await assertSucceeds(db.doc('propuestas/a').set(p()));
  await assertFails(db.doc('propuestas/b').set(p({ region: 'R3' })));
  await assertFails(db.doc('propuestas/c').set(p({ fecha: mx(-2) })));
  await assertFails(db.doc('propuestas/d').set(p({ fecha: feriado })));
  await assertFails(db.doc('propuestas/e').set(p({ estado: 'Confirmada' })));
  await assertFails(db.doc('propuestas/f').set(p({ email: 'otro@fpt.com.mx' })));
});
test('regional no confirma, no edita calendario, no lee ajenas', async () => {
  const db = as(REG);
  await assertFails(db.doc('propuestas/p1').update({ estado: 'Confirmada' }));
  await assertFails(db.doc('capacitaciones/x').set(cap()));
  await assertSucceeds(db.collection('propuestas').where('email', '==', REG).get());
  await assertFails(db.collection('propuestas').get());
  await assertFails(db.doc('regionales/otro@fpt.com.mx').get());
  await assertFails(db.doc('regionales/' + REG).set({ regiones: ['R1', 'R2', 'R3'], activo: true }));
});
test('regional inactivo no propone', async () => {
  await env.withSecurityRulesDisabled((ctx) => ctx.firestore().doc('regionales/' + REG).update({ activo: false }));
  await assertFails(as(REG).doc('propuestas/z').set({ nombre: 'T', fecha: futuro, region: 'R2', email: REG, enviado: 'x', estado: 'Pendiente' }));
});
test('administradora confirma una vez; una decisión no se repite', async () => {
  const db = as(ADMIN);
  await assertSucceeds(db.doc('propuestas/p1').update({ estado: 'Confirmada', decision: 'x', calId: 'p-p1', decididoPor: ADMIN }));
  await assertFails(db.doc('propuestas/p1').update({ estado: 'Rechazada', decision: 'y' }));
});
