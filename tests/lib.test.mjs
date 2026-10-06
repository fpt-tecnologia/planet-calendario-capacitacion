// Pruebas de la lógica pura (feriados, indicadores, cierre, validaciones). Ejecutar: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const PL = createRequire(import.meta.url)('../js/lib.js');

test('feriados art. 74 LFT 2026', () => {
  assert.deepEqual(PL.holidaysForYear(2026).map((h) => h.fecha), ['2026-01-01', '2026-02-02', '2026-03-16', '2026-05-01', '2026-09-16', '2026-11-16', '2026-12-25']);
});
test('1 de octubre sólo en años de transmisión del Ejecutivo', () => {
  assert.ok(PL.holidaysForYear(2030).some((h) => h.fecha === '2030-10-01'));
  assert.ok(!PL.holidaysForYear(2027).some((h) => h.fecha === '2027-10-01'));
});
test('descanso electoral configurado bloquea', () => {
  assert.ok(PL.holidayInfo('2027-06-06', [{ fecha: '2027-06-06', motivo: 'Elección' }]));
  assert.equal(PL.holidayInfo('2027-06-07', []), null);
});
test('Semana Santa no se bloquea', () => { assert.equal(PL.holidayInfo('2026-04-02', []), null); assert.equal(PL.holidayInfo('2026-04-03', []), null); });
test('fecha en zona America/Mexico_City', () => {
  assert.equal(PL.todayMX(new Date('2026-11-01T05:30:00Z')), '2026-10-31');
  assert.equal(PL.todayMX(new Date('2026-11-01T06:30:00Z')), '2026-11-01');
});
const recs = [
  { id: 'a', fecha: '2026-09-10', estado: 'Programada', tipo: 'Bootcamp', programa: 'BC', clubApertura: 'Toluca', modalidad: 'Presencial', horaInicio: '09:00', horaFin: '13:30', publicos: ['R1', 'R2'], area: 'Operaciones' },
  { id: 'b', fecha: '2026-09-11', estado: 'Cancelada', modalidad: 'Online', publicos: ['R1'] },
  { id: 'c', fecha: '2026-10-20', estado: 'Programada', modalidad: 'Online', publicos: ['Corporativo'], horaInicio: '10:00', horaFin: '11:00' },
  { id: 'd', fecha: '', estado: 'Programada' },
  { id: 'e', fecha: '2026-10-02', estado: 'Realizada', modalidad: 'Online', horaInicio: '10:00', horaFin: '12:00', publicos: ['R2'] },
];
test('cierre mensual: meses anteriores, sin canceladas ni registros sin fecha', () => {
  assert.deepEqual(PL.pendingClosures(recs, '2026-10-06').map((p) => p.id), ['a']);
});
test('indicadores del mes', () => {
  const s = PL.monthStats(recs, 2026, 9);
  assert.equal(s.total, 1); assert.equal(s.presenciales, 1); assert.equal(s.canceladas, 1); assert.equal(s.bootcamps, 1); assert.equal(s.actividadesBootcamp, 1);
});
test('dashboard acumulado enero → octubre con corte', () => {
  const d = PL.dashboard(recs, 2026, 10, '2026-10-06');
  assert.equal(d.registradas, 4); assert.equal(d.realizadas, 1); assert.equal(d.canceladas, 1); assert.equal(d.horasRealizadas, 2);
  assert.equal(d.pendientesFuturas, 1); assert.equal(d.pendientesVencidas, 1); assert.equal(d.ejecucion, 50); assert.equal(d.sinFecha, 1);
  assert.equal(d.evol.length, 10);
});
test('validación: feriado, bootcamp sin club, estado fuera de mes', () => {
  const e = PL.validateTraining({ nombre: 'a', tipo: 'Bootcamp', modalidad: 'Presencial', publicos: ['R1'], fecha: '2026-11-16', estado: 'Realizada', horaInicio: '10:00', horaFin: '09:00' }, { today: '2026-10-06', isNew: true, dateChanged: true });
  assert.ok(e.fecha && e.clubApertura && e.horaFin && e.estado);
});
test('propuesta: región autorizada y fecha desde hoy', () => {
  const ctx = { today: '2026-10-06', extras: [], regiones: ['R2'] };
  assert.deepEqual(PL.validateProposal({ nombre: 'x', fecha: '2026-10-07', region: 'R2' }, ctx), {});
  assert.ok(PL.validateProposal({ nombre: 'x', fecha: '2026-10-05', region: 'R2' }, ctx).fecha);
  assert.ok(PL.validateProposal({ nombre: 'x', fecha: '2026-10-07', region: 'R1' }, ctx).region);
});
test('importación: duplicados omitidos y revisión marcada', () => {
  const r = PL.importRows([['Nombre', 'Fecha', 'Región', 'Tipo'], ['A', '16/09/2026', 'R1', 'Bootcamp'], ['A', '16/09/2026', 'R1', 'Bootcamp'], ['B', '', 'Corporativo', 'online']], [], [], 'general');
  assert.equal(r.nuevos.length, 2); assert.equal(r.duplicados.length, 1);
  assert.ok(r.nuevos[0].revision.some((x) => x.includes('descanso obligatorio')));
  assert.ok(r.nuevos[1].revision.includes('Sin fecha'));
});
