/* Planet · Calendario de capacitación — lógica pura (sin DOM). */
(function (root) {
  const TZ = 'America/Mexico_City';
  const PUBLICOS = ['R1', 'R2', 'R3', 'R4', 'R5', 'Corporativo'];
  const REGIONES = ['R1', 'R2', 'R3', 'R4', 'R5', 'Corporativo'];
  const TIPOS = ['Bootcamp', 'Online', 'En sitio'];
  const MODALIDADES = ['Presencial', 'Online'];
  const ESTADOS = ['Por confirmar', 'Programada', 'Realizada', 'Reprogramada', 'Cancelada'];
  const ESTADOS_ABIERTOS = ['Por confirmar', 'Programada', 'Reprogramada'];
  const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`; // m: 1-12
  const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z'));
  const monthKey = (s) => (isDate(s) ? s.slice(0, 7) : '');
  const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  const dow = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 domingo

  function todayMX(now) {
    const f = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
    return f.format(now || new Date()); // YYYY-MM-DD
  }

  // n-ésimo lunes del mes (n>=1)
  function nthMonday(y, m, n) {
    const first = dow(y, m, 1);
    const offset = (8 - first) % 7; // días hasta el primer lunes
    return ymd(y, m, 1 + offset + 7 * (n - 1));
  }

  /* Art. 74 LFT (texto vigente, última reforma DOF 14-05-2026). */
  function holidaysForYear(y) {
    const out = [
      { fecha: ymd(y, 1, 1), motivo: '1 de enero', fraccion: 'I' },
      { fecha: nthMonday(y, 2, 1), motivo: 'Primer lunes de febrero, en conmemoración del 5 de febrero', fraccion: 'II' },
      { fecha: nthMonday(y, 3, 3), motivo: 'Tercer lunes de marzo, en conmemoración del 21 de marzo', fraccion: 'III' },
      { fecha: ymd(y, 5, 1), motivo: '1 de mayo', fraccion: 'IV' },
      { fecha: ymd(y, 9, 16), motivo: '16 de septiembre', fraccion: 'V' },
      { fecha: nthMonday(y, 11, 3), motivo: 'Tercer lunes de noviembre, en conmemoración del 20 de noviembre', fraccion: 'VI' },
      { fecha: ymd(y, 12, 25), motivo: '25 de diciembre', fraccion: 'VIII' },
    ];
    // Fr. VII: 1 de octubre de cada seis años (transmisión del Poder Ejecutivo Federal: 2024, 2030, 2036…)
    if (y >= 2024 && (y - 2024) % 6 === 0) out.push({ fecha: ymd(y, 10, 1), motivo: '1 de octubre, transmisión del Poder Ejecutivo Federal', fraccion: 'VII' });
    return out.sort((a, b) => a.fecha.localeCompare(b.fecha));
  }

  // extras: [{fecha, motivo}] descansos electorales u otros configurados por la administradora (fr. IX)
  function holidayInfo(fecha, extras) {
    if (!isDate(fecha)) return null;
    const y = +fecha.slice(0, 4);
    const h = holidaysForYear(y).find((x) => x.fecha === fecha);
    if (h) return { fecha, motivo: h.motivo, fuente: `Art. 74, fracción ${h.fraccion}, LFT` };
    const e = (extras || []).find((x) => x && x.fecha === fecha);
    if (e) return { fecha, motivo: e.motivo || 'Descanso adicional', fuente: 'Art. 74, fracción IX, LFT (configurado por la administradora)' };
    return null;
  }

  function toMin(h) {
    if (typeof h !== 'string' || !/^\d{1,2}:\d{2}$/.test(h)) return null;
    const [a, b] = h.split(':').map(Number);
    if (a > 23 || b > 59) return null;
    return a * 60 + b;
  }
  function durationMin(r) {
    const a = toMin(r.horaInicio), b = toMin(r.horaFin);
    if (a == null || b == null || b <= a) return null;
    return b - a;
  }

  const bootcampKey = (r) => (r.tipo === 'Bootcamp' ? `${(r.programa || '').trim().toLowerCase()}|${(r.clubApertura || '').trim().toLowerCase()}` : null);

  function inMonth(r, y, m) { return isDate(r.fecha) && r.fecha.slice(0, 7) === `${y}-${pad(m)}`; }

  /* Indicadores superiores del mes seleccionado */
  function monthStats(records, y, m) {
    const mes = records.filter((r) => inMonth(r, y, m));
    const activas = mes.filter((r) => r.estado !== 'Cancelada');
    const bc = activas.filter((r) => r.tipo === 'Bootcamp');
    return {
      total: activas.length,
      presenciales: activas.filter((r) => r.modalidad === 'Presencial').length,
      online: activas.filter((r) => r.modalidad === 'Online').length,
      sinModalidad: activas.filter((r) => r.modalidad !== 'Presencial' && r.modalidad !== 'Online').length,
      canceladas: mes.length - activas.length,
      bootcamps: new Set(bc.map(bootcampKey)).size,
      actividadesBootcamp: bc.length,
    };
  }

  /* Dashboard acumulado enero → mes seleccionado del mismo año */
  function dashboard(records, y, m, today) {
    const ini = ymd(y, 1, 1);
    const fin = ymd(y, m, daysInMonth(y, m));
    const corte = today < fin ? today : fin;
    const futuro = today < ini; // todo el rango está en el futuro
    const set = records.filter((r) => isDate(r.fecha) && r.fecha >= ini && r.fecha <= fin).sort((a, b) => (a.fecha + (a.horaInicio || '')).localeCompare(b.fecha + (b.horaInicio || '')));
    const sinFecha = records.filter((r) => !isDate(r.fecha)).length;
    const act = set.filter((r) => r.estado !== 'Cancelada');
    const realizadas = set.filter((r) => r.estado === 'Realizada');
    const realizadasAuto = realizadas.filter((r) => r.cierreAuto && r.cierreAuto.mes);
    const abiertas = set.filter((r) => ESTADOS_ABIERTOS.includes(r.estado) || !r.estado);
    const abiertasVencidas = abiertas.filter((r) => r.fecha <= corte);
    const abiertasFuturas = abiertas.filter((r) => r.fecha > corte);
    const canceladas = set.filter((r) => r.estado === 'Cancelada');
    const bc = act.filter((r) => r.tipo === 'Bootcamp');
    let horasMin = 0, sinHorario = 0;
    realizadas.forEach((r) => { const d = durationMin(r); if (d == null) sinHorario++; else horasMin += d; });
    const base = act.filter((r) => r.fecha <= corte).length;
    const porArea = {}, porPublico = {};
    act.forEach((r) => {
      const a = (r.area || '').trim() || 'Sin información';
      porArea[a] = porArea[a] || { sesiones: 0, realizadas: 0 };
      porArea[a].sesiones++; if (r.estado === 'Realizada') porArea[a].realizadas++;
      const ps = Array.isArray(r.publicos) && r.publicos.length ? r.publicos : ['Sin información'];
      ps.forEach((p) => { porPublico[p] = porPublico[p] || { sesiones: 0, realizadas: 0 }; porPublico[p].sesiones++; if (r.estado === 'Realizada') porPublico[p].realizadas++; });
    });
    const evol = [];
    for (let i = 1; i <= m; i++) {
      const mm = set.filter((r) => r.fecha.slice(5, 7) === pad(i));
      evol.push({
        mes: i,
        realizadas: mm.filter((r) => r.estado === 'Realizada').length,
        pendientes: mm.filter((r) => ESTADOS_ABIERTOS.includes(r.estado) || !r.estado).length,
        canceladas: mm.filter((r) => r.estado === 'Cancelada').length,
      });
    }
    return {
      ini, fin, corte, futuro, sinFecha,
      registradas: set.length,
      realizadas: realizadas.length,
      realizadasAuto: realizadasAuto.length,
      realizadasManual: realizadas.length - realizadasAuto.length,
      pendientes: abiertas.length,
      pendientesVencidas: abiertasVencidas.length,
      pendientesFuturas: abiertasFuturas.length,
      canceladas: canceladas.length,
      presenciales: act.filter((r) => r.modalidad === 'Presencial').length,
      online: act.filter((r) => r.modalidad === 'Online').length,
      sinModalidad: act.filter((r) => r.modalidad !== 'Presencial' && r.modalidad !== 'Online').length,
      bootcamps: new Set(bc.map(bootcampKey)).size,
      actividadesBootcamp: bc.length,
      horasRealizadas: Math.round((horasMin / 60) * 10) / 10,
      realizadasSinHorario: sinHorario,
      baseEjecucion: base,
      ejecucion: base ? Math.round((realizadas.filter((r) => r.fecha <= corte).length / base) * 1000) / 10 : null,
      porArea, porPublico, evol, detalle: set,
    };
  }

  /* Cierre mensual: registros con fecha en meses ya terminados (zona MX) que siguen abiertos */
  function pendingClosures(records, today) {
    const mesActual = today.slice(0, 7);
    return records
      .filter((r) => isDate(r.fecha) && r.fecha.slice(0, 7) < mesActual && r.estado !== 'Cancelada' && r.estado !== 'Realizada')
      .map((r) => ({ id: r.id, mes: r.fecha.slice(0, 7), estadoAnterior: r.estado || '' }));
  }

  // Sólo se cambia manualmente el estado de registros del mes en curso
  function canChangeStatus(fecha, today) { return isDate(fecha) && fecha.slice(0, 7) === today.slice(0, 7); }

  function validateTraining(d, ctx) {
    const errs = {};
    const today = ctx.today;
    if (!(d.nombre || '').trim()) errs.nombre = 'Escribe el nombre de la capacitación.';
    const flexible = d.estado === 'Por confirmar'; // registros por confirmar pueden completarse después
    if (!TIPOS.includes(d.tipo) && !(flexible && !d.tipo)) errs.tipo = 'Elige el tipo de capacitación (puede quedar vacío sólo si el estado es “Por confirmar”).';
    if (!MODALIDADES.includes(d.modalidad) && !(flexible && !d.modalidad)) errs.modalidad = 'Elige la modalidad (puede quedar vacía sólo si el estado es “Por confirmar”).';
    if (!Array.isArray(d.publicos) || !d.publicos.length) errs.publicos = 'Elige al menos un público.';
    if (d.tipo === 'Bootcamp' && !(d.clubApertura || '').trim()) errs.clubApertura = 'El club que se aperturará es obligatorio en Bootcamp.';
    if (!isDate(d.fecha)) errs.fecha = 'Elige una fecha.';
    else if (ctx.dateChanged) {
      const h = holidayInfo(d.fecha, ctx.extras);
      if (h) errs.fecha = `No se puede programar el ${d.fecha}: es día de descanso obligatorio (${h.motivo}; ${h.fuente}).`;
    }
    const a = toMin(d.horaInicio), b = toMin(d.horaFin);
    if (d.horaInicio && a == null) errs.horaInicio = 'Hora no válida.';
    if (d.horaFin && b == null) errs.horaFin = 'Hora no válida.';
    if (a != null && b != null && b <= a) errs.horaFin = 'La hora de fin debe ser posterior a la de inicio.';
    if (d.tipo === 'Bootcamp' && d.numDia !== '' && d.numDia != null && !(Number(d.numDia) >= 1 && Number(d.numDia) <= 14)) errs.numDia = 'En Bootcamp el día va de 1 a 14.';
    if (!ESTADOS.includes(d.estado)) errs.estado = 'Elige un estado.';
    if (ctx.isNew && !['Por confirmar', 'Programada'].includes(d.estado) && !canChangeStatus(d.fecha, today)) errs.estado = 'Para fechas fuera del mes en curso, el estado inicial sólo puede ser “Por confirmar” o “Programada”.';
    // En meses cerrados la administradora puede corregir el estado; la app lo registra como corrección en el historial
    if (d.enlace && !/^https?:\/\//i.test(d.enlace)) errs.enlace = 'El enlace debe iniciar con https://';
    return errs;
  }

  function validateProposal(p, ctx) {
    const errs = {};
    if (!(p.nombre || '').trim()) errs.nombre = 'Escribe el nombre de la capacitación.';
    if (!isDate(p.fecha)) errs.fecha = 'Elige el día propuesto.';
    else if (p.fecha < ctx.today) errs.fecha = 'La fecha propuesta debe ser a partir de hoy.';
    else { const h = holidayInfo(p.fecha, ctx.extras); if (h) errs.fecha = `El ${p.fecha} es día de descanso obligatorio (${h.motivo}). Elige otra fecha.`; }
    if (!(ctx.regiones || []).includes(p.region)) errs.region = 'Elige una de tus regiones autorizadas.';
    return errs;
  }

  /* Importación: normaliza filas y marca revisión, sin inventar datos */
  const norm = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const COLS = {
    nombre: ['nombre', 'nombre de la capacitacion', 'capacitacion', 'curso', 'titulo'],
    programa: ['programa'], tema: ['tema', 'actividad', 'tema o actividad', 'tema actividad'],
    tipo: ['tipo', 'tipo de capacitacion'], modalidad: ['modalidad'],
    area: ['area', 'area que imparte', 'imparte'], facilitador: ['facilitador', 'instructor', 'ponente'],
    publicos: ['publico', 'publicos', 'region', 'regiones', 'region es'],
    perfil: ['perfil', 'perfil de asistentes', 'dirigido a', 'asistentes'],
    clubApertura: ['club que se aperturara', 'club apertura', 'club a aperturar', 'club por aperturar', 'club'],
    clubes: ['clubes participantes', 'clubes'], ciudad: ['ciudad'], sede: ['sede', 'lugar'],
    fecha: ['fecha', 'dia', 'fecha de la capacitacion'], horaInicio: ['hora inicio', 'hora de inicio', 'inicio'],
    horaFin: ['hora fin', 'hora de fin', 'fin', 'hora final'], numDia: ['numero de dia', 'dia del programa', 'sesion', 'no dia', 'num dia', 'numero de sesion'],
    enlace: ['enlace', 'link', 'liga', 'url'], estado: ['estado', 'estatus'], notas: ['notas', 'observaciones', 'comentarios'],
  };
  function mapHeaders(headers) {
    const map = {};
    headers.forEach((h, i) => {
      const n = norm(h);
      for (const [k, al] of Object.entries(COLS)) if (map[k] == null && al.includes(n)) { map[k] = i; break; }
    });
    return map;
  }
  function toISODate(v) {
    if (v == null || v === '') return '';
    if (typeof v === 'number' && v > 20000 && v < 80000) { const d = new Date(Math.round((v - 25569) * 86400000)); return d.toISOString().slice(0, 10); }
    if (v instanceof Date && !isNaN(v)) return ymd(v.getFullYear(), v.getMonth() + 1, v.getDate());
    const s = String(v).trim();
    if (isDate(s)) return s;
    let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
    if (m) { let yy = +m[3]; if (yy < 100) yy += 2000; const d = ymd(yy, +m[2], +m[1]); return isDate(d) && new Date(d + 'T00:00:00Z').getUTCDate() === +m[1] ? d : 'INVALIDA'; }
    return 'INVALIDA';
  }
  function toHHMM(v) {
    if (v == null || v === '') return '';
    if (typeof v === 'number' && v >= 0 && v < 1) { const t = Math.round(v * 1440); return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`; }
    const s = String(v).trim().toLowerCase();
    const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/);
    if (!m) return 'INVALIDA';
    let h = +m[1]; const mi = +(m[2] || 0); const ap = m[3] || '';
    if (ap.startsWith('p') && h < 12) h += 12; if (ap.startsWith('a') && h === 12) h = 0;
    return h < 24 && mi < 60 ? `${pad(h)}:${pad(mi)}` : 'INVALIDA';
  }
  const pick = (val, list) => { const n = norm(val); return list.find((x) => norm(x) === n) || ''; };
  function tipoFrom(v) { const n = norm(v); if (!n) return ''; if (n.includes('boot')) return 'Bootcamp'; if (n.includes('online') || n.includes('linea') || n.includes('virtual')) return 'Online'; if (n.includes('sitio') || n.includes('presencial')) return 'En sitio'; return ''; }
  function modFrom(v) { const n = norm(v); if (!n) return ''; if (n.includes('online') || n.includes('linea') || n.includes('virtual')) return 'Online'; if (n.includes('presencial') || n.includes('sitio')) return 'Presencial'; return ''; }
  function publicosFrom(v) {
    const n = norm(v); const out = new Set();
    if (!n) return [];
    let m; const re = /\b(?:r|region)\s*([1-5])\b/g;
    while ((m = re.exec(n))) out.add('R' + m[1]);
    if (/\bcorp/.test(n)) out.add('Corporativo');
    if (/\btodas\b|\btodos\b/.test(n)) ['R1', 'R2', 'R3', 'R4', 'R5'].forEach((x) => out.add(x));
    return PUBLICOS.filter((p) => out.has(p));
  }
  const dupKey = (r) => [norm(r.nombre), norm(r.tema), r.fecha, r.horaInicio, (r.publicos || []).join(','), norm(r.clubApertura)].join('|');
  const slotKey = (r) => [norm(r.nombre), r.fecha, r.horaInicio, norm(r.clubApertura)].join('|');

  function importRows(rows, existing, extras, fuente) {
    if (!rows.length) return { nuevos: [], duplicados: [], sinEncabezados: true };
    const headers = rows[0];
    const map = mapHeaders(headers);
    if (map.nombre == null && map.tema == null) return { nuevos: [], duplicados: [], sinEncabezados: true, headers };
    const seen = new Map(existing.map((r) => [dupKey(r), r]));
    const slots = new Map(existing.map((r) => [slotKey(r), r]));
    const nuevos = [], duplicados = [];
    rows.slice(1).forEach((row, idx) => {
      if (!row || row.every((c) => c == null || String(c).trim() === '')) return;
      const g = (k) => (map[k] == null ? '' : row[map[k]]);
      const rev = [];
      const fechaRaw = g('fecha');
      let fecha = toISODate(fechaRaw);
      if (fecha === 'INVALIDA') { rev.push(`Fecha no reconocida: “${fechaRaw}”`); fecha = ''; }
      else if (!fecha) rev.push('Sin fecha');
      let hi = toHHMM(g('horaInicio')), hf = toHHMM(g('horaFin'));
      if (hi === 'INVALIDA') { rev.push('Hora de inicio no reconocida'); hi = ''; }
      if (hf === 'INVALIDA') { rev.push('Hora de fin no reconocida'); hf = ''; }
      if (hi && hf && toMin(hf) <= toMin(hi)) rev.push('Hora de fin igual o anterior a la de inicio');
      const tipo = tipoFrom(g('tipo')) || (fuente === 'bootcamp' ? 'Bootcamp' : '');
      let modalidad = modFrom(g('modalidad'));
      if (!modalidad && tipo === 'Online') modalidad = 'Online';
      if (!modalidad && (tipo === 'Bootcamp' || tipo === 'En sitio')) modalidad = 'Presencial';
      const estadoIn = pick(g('estado'), ESTADOS);
      const rec = {
        nombre: String(g('nombre') || g('tema') || '').trim(), programa: String(g('programa') || '').trim(), tema: String(g('tema') || '').trim(),
        tipo, modalidad, area: String(g('area') || '').trim(), facilitador: String(g('facilitador') || '').trim(),
        publicos: publicosFrom(g('publicos')), perfil: String(g('perfil') || '').trim(),
        clubApertura: String(g('clubApertura') || '').trim(), clubes: String(g('clubes') || '').trim(),
        ciudad: String(g('ciudad') || '').trim(), sede: String(g('sede') || '').trim(), fecha, horaInicio: hi, horaFin: hf,
        numDia: g('numDia') === '' ? '' : String(g('numDia')).trim(), enlace: String(g('enlace') || '').trim(),
        estado: estadoIn || 'Por confirmar', origen: 'importacion', fila: idx + 2,
        _notas: String(g('notas') || '').trim(),
      };
      if (!tipo) rev.push('Tipo sin especificar');
      if (!modalidad) rev.push('Modalidad sin especificar');
      if (!rec.publicos.length) rev.push('Público sin especificar');
      if (!rec.area) rev.push('Área sin especificar');
      if (tipo === 'Bootcamp' && !rec.clubApertura) rev.push('Bootcamp sin club que se aperturará');
      if (!estadoIn && g('estado')) rev.push(`Estado no reconocido: “${g('estado')}”`);
      if (fecha) { const h = holidayInfo(fecha, extras); if (h) rev.push(`Registrada en día de descanso obligatorio (${h.motivo})`); }
      const k = dupKey(rec);
      if (seen.has(k)) { duplicados.push({ fila: idx + 2, nombre: rec.nombre, fecha }); return; }
      const sk = slotKey(rec);
      if (fecha && slots.has(sk)) rev.push('Posible registro contradictorio: misma capacitación, fecha y hora con datos distintos');
      seen.set(k, rec); slots.set(sk, rec);
      rec.revision = rev;
      nuevos.push(rec);
    });
    return { nuevos, duplicados, map, headers };
  }

  function matches(r, f) {
    if (f.publico && !(r.publicos || []).includes(f.publico)) return false;
    if (f.area && (r.area || '') !== f.area) return false;
    if (f.tipo && (r.tipo || '') !== f.tipo) return false;
    if (f.modalidad && (r.modalidad || '') !== f.modalidad) return false;
    if (f.estado && (r.estado || '') !== f.estado) return false;
    if (f.club) { const c = norm(f.club); if (!norm(r.clubApertura).includes(c) && !norm(r.clubes).includes(c)) return false; }
    if (f.q) {
      const hay = norm([r.nombre, r.programa, r.tema, r.area, r.facilitador, r.clubApertura, r.clubes, r.ciudad, r.sede, r.perfil].join(' '));
      if (!norm(f.q).split(' ').every((t) => hay.includes(t))) return false;
    }
    return true;
  }

  const api = { TZ, PUBLICOS, REGIONES, TIPOS, MODALIDADES, ESTADOS, ESTADOS_ABIERTOS, MESES, pad, ymd, isDate, monthKey, daysInMonth, dow, todayMX, nthMonday, holidaysForYear, holidayInfo, toMin, durationMin, bootcampKey, monthStats, dashboard, pendingClosures, canChangeStatus, validateTraining, validateProposal, importRows, matches, norm };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PL = api;
})(typeof window !== 'undefined' ? window : globalThis);
