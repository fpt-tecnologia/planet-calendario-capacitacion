/* ===== Planet · Calendario de capacitación — núcleo (Firebase) ===== */
const $ = (s, el = document) => el.querySelector(s);
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uidGen = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const nowISO = () => new Date().toISOString();
const fmtTS = (iso) => { try { return new Intl.DateTimeFormat('es-MX', { timeZone: PL.TZ, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)); } catch (e) { return iso || ''; } };
const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const DIAS_C = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
function fmtFecha(f, largo) {
  if (!PL.isDate(f)) return 'Sin fecha';
  const [y, m, d] = f.split('-').map(Number);
  const dn = DIAS[PL.dow(y, m, d)];
  return largo ? `${dn} ${d} de ${PL.MESES[m - 1].toLowerCase()} de ${y}` : `${dn.slice(0, 3)} ${d} ${PL.MESES[m - 1].slice(0, 3).toLowerCase()} ${y}`;
}
const lsGet = (k, d) => { try { const v = localStorage.getItem('planetcal:' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem('planetcal:' + k, JSON.stringify(v)); } catch (e) {} };

// Rutas de datos en Firestore
const P = {
  cal: 'capacitaciones', notas: 'notas', hist: 'historial', cierres: 'cierres',
  pub: 'config/publico', roles: 'config/roles', bloqueos: 'config/bloqueos',
  regs: 'regionales', props: 'propuestas',
};

const S = {
  db: null, auth: null, email: null, role: 'loading', roleNote: '', preview: false,
  cal: new Map(), calReady: false, notas: {}, hist: [], pub: { areas: [], descansos: [] },
  roles: { admins: [], dominios: [], lectores: [] }, regs: [], props: [], myAuth: null, myProps: [],
  today: PL.todayMX(), tab: 'cal', view: lsGet('view', 'cal'), filters: lsGet('filters', {}),
  y: 0, m: 0, selDay: null, bcAll: false, histFilter: 'todos', busy: new Set(), closureDone: false, err: '', unsubs: [],
};
{ const [y, m] = S.today.split('-').map(Number); S.y = y; S.m = m; }

/* ---------- Toasts y errores ---------- */
function toast(msg, kind) {
  const t = document.createElement('div'); t.className = 'toast ' + (kind || ''); t.setAttribute('role', 'status'); t.textContent = msg;
  $('#toasts').appendChild(t); setTimeout(() => t.remove(), kind === 'bad' ? 7000 : 4000);
}
function dbErr(e) {
  const c = e && e.code;
  if (c === 'permission-denied') return 'El servidor rechazó el cambio: no tienes permiso o los datos no cumplen las reglas (por ejemplo, fecha bloqueada o estado fuera del mes en curso).';
  if (c === 'resource-exhausted') return 'Se alcanzó un límite del servicio. Espera unos minutos e inténtalo de nuevo.';
  if (c === 'unavailable') return 'Sin conexión con el servidor. Revisa tu internet e inténtalo de nuevo.';
  if (c === 'failed-precondition' || c === 'aborted') return 'Otro cambio se guardó al mismo tiempo. Vuelve a intentarlo.';
  return 'No se pudo guardar. ' + ((e && e.message) || '');
}
async function retry(fn) { try { return await fn(); } catch (e) { if (e && e.code === 'unavailable') { await new Promise((r) => setTimeout(r, 800)); return fn(); } throw e; } }

const isAdmin = () => S.role === 'admin' && !S.preview;
const isAdminRole = () => S.role === 'admin';
const records = () => [...S.cal.values()];
const extras = () => S.pub.descansos || [];
async function addHist(entry, id) {
  if (S.role !== 'admin') return;
  try { await retry(() => S.db.collection(P.hist).doc(id || uidGen('h')).set({ ts: nowISO(), por: S.email || '', auto: false, ...entry })); } catch (e) { console.warn('historial', e); }
}

/* ---------- Ingreso con enlace por correo ---------- */
function renderLogin(msg, kind) {
  $('#top').innerHTML = `<div class="top-in"><div class="brand"><b>Planet <span>·</span> Calendario de capacitación</b><small>Ingreso con tu correo de trabajo</small></div></div>`;
  const regional = location.hash === '#regional';
  $('#main').innerHTML = `<section class="panel login">
    <h2>${regional ? 'Ingreso para Regionales' : 'Ingresar'}</h2>
    <p class="muted">Escribe tu correo. Te enviaremos un enlace de acceso de un solo uso; ábrelo en este mismo dispositivo. No se usan contraseñas.</p>
    <form id="loginForm" class="fgrid" novalidate>
      <div class="field wide"><label for="lg-email">Correo</label><input id="lg-email" type="email" autocomplete="email" required placeholder="nombre@empresa.com" value="${esc(lsGet('lastEmail', ''))}"></div>
      <div class="field"><button class="btn primary" id="lg-btn" type="submit">Enviarme el enlace</button></div>
    </form>
    ${CONFIG.googleLogin ? '<div class="row" style="margin-top:10px"><span class="muted">o</span><button class="btn" data-act="google">Ingresar con Google</button></div>' : ''}
    ${msg ? `<div class="alert ${kind || 'info'}" style="margin-top:12px">${esc(msg)}</div>` : ''}
    <p class="muted" style="font-size:13px;margin-top:14px">Compartir este enlace no da permisos: cada persona ve sólo lo que su cuenta tiene autorizado.</p>
  </section>`;
}
async function sendLink(email) {
  const btn = $('#lg-btn'); btn.disabled = true; btn.textContent = 'Enviando…';
  try {
    await S.auth.sendSignInLinkToEmail(email, { url: location.href.split('#')[0] + (location.hash || ''), handleCodeInApp: true });
    lsSet('emailForSignIn', email); lsSet('lastEmail', email);
    renderLogin(`Te enviamos un enlace a ${email}. Ábrelo desde este dispositivo para entrar. Revisa también la carpeta de correo no deseado.`, 'ok');
  } catch (e) { renderLogin('No se pudo enviar el enlace: ' + (e.message || e.code), 'bad'); }
}
async function completeLinkSignIn() {
  if (!S.auth.isSignInWithEmailLink(location.href)) return;
  let email = lsGet('emailForSignIn', '');
  if (!email) { renderLogin('Escribe de nuevo tu correo para confirmar el ingreso y vuelve a solicitar el enlace desde este dispositivo.', 'warn'); return 'stop'; }
  try { await S.auth.signInWithEmailLink(email, location.href); lsSet('emailForSignIn', ''); history.replaceState(null, '', location.pathname + location.hash); }
  catch (e) { renderLogin('El enlace no es válido o ya se usó. Solicita uno nuevo.', 'bad'); return 'stop'; }
}

/* ---------- Arranque ---------- */
async function boot() {
  if (!window.firebase || !window.CONFIG || !CONFIG.firebase || !CONFIG.firebase.apiKey || CONFIG.firebase.apiKey.startsWith('PEGAR')) {
    $('#main').innerHTML = '<div class="alert bad">Falta la configuración de Firebase. Edita <code>js/config.js</code> con los datos de tu proyecto (ver README).</div>'; return;
  }
  firebase.initializeApp(CONFIG.firebase);
  S.auth = firebase.auth(); S.db = firebase.firestore();
  S.db.settings({ ignoreUndefinedProperties: true, merge: true });
  try { await S.db.enablePersistence({ synchronizeTabs: true }); } catch (e) {}
  if ((await completeLinkSignIn()) === 'stop') return;
  S.auth.onAuthStateChanged(async (u) => {
    S.unsubs.forEach((f) => f()); S.unsubs = [];
    if (!u) { S.role = 'loading'; return renderLogin(); }
    if (!u.emailVerified) { await S.auth.signOut(); return renderLogin('Tu correo no está verificado. Ingresa con el enlace por correo.', 'bad'); }
    S.email = u.email.toLowerCase(); S.role = 'loading'; render();
    await detectRole(); subscribe(); render();
  });
}

async function detectRole() {
  S.roleNote = ''; S.tab = 'cal';
  // ¿Administradora? (las reglas sólo permiten leer config/roles a administradoras)
  try {
    const r = await S.db.doc(P.roles).get();
    if (r.exists) { const d = r.data(); S.roles = { admins: d.admins || [], dominios: d.dominios || [], lectores: d.lectores || [] }; if (S.roles.admins.includes(S.email)) { S.role = 'admin'; return; } }
    else if (S.email === CONFIG.adminInicial.toLowerCase()) {
      // Primera ejecución: registra a la administradora configurada al implementar
      await S.db.doc(P.roles).set({ admins: [S.email], dominios: CONFIG.dominiosIniciales || [], lectores: [] });
      S.roles = { admins: [S.email], dominios: CONFIG.dominiosIniciales || [], lectores: [] }; S.role = 'admin'; return;
    }
  } catch (e) {
    S.diag = 'roles: ' + (e.code || e.message);
    // Error de red o de conexión (no de permisos): reintenta antes de decidir el rol
    if (e.code !== 'permission-denied' && !detectRole.retried) { detectRole.retried = true; await new Promise((r) => setTimeout(r, 1500)); return detectRole(); }
  }
  try { const a = await S.db.doc(P.regs + '/' + S.email).get(); if (a.exists && a.data().activo) { S.role = 'regional'; S.myAuth = a.data(); S.tab = 'reg'; return; } } catch (e) {}
  try { await S.db.collection(P.cal).limit(1).get({ source: 'server' }); S.role = 'gerente'; }
  catch (e) {
    if (e.code === 'permission-denied') S.role = 'sinacceso';
    else { S.role = 'error'; S.err = 'No se pudo conectar con el servidor (' + (e.code || e.message) + '). Revisa tu conexión y vuelve a intentar.'; }
    S.diag = (S.diag ? S.diag + ' · ' : '') + 'calendario: ' + (e.code || e.message);
  }
  if (location.hash === '#regional' && S.role === 'gerente') S.roleNote = 'Esta cuenta no está habilitada como Regional. Pide a la coordinación de capacitación que registre tu correo y tus regiones.';
}

function onSubErr(e, label) {
  console.warn('Firestore', label, e);
  if (!e || e.code !== 'permission-denied') return;
  // Una lectura rechazada no quita el rol de administradora: se informa y se sigue
  if (S.role === 'admin') { toast(`El servidor rechazó la lectura de “${label}”: ${e.message}`, 'bad'); return; }
  S.diag = label + ': ' + e.code; S.role = 'sinacceso'; render();
}
function sub(ref, fn) { const label = ref.path || (ref._query && ref._query.path && ref._query.path.toString()) || 'datos'; S.unsubs.push(ref.onSnapshot(fn, (e) => onSubErr(e, label))); }

function subscribe() {
  if (S.role === 'sinacceso') return;
  sub(S.db.doc(P.pub), (s) => { const d = s.exists ? s.data() : {}; S.pub = { areas: d.areas || [], descansos: d.descansos || [] }; if (isAdminRole()) syncBloqueos(); render(); });
  sub(S.db.collection(P.cal), (snap) => {
    S.cal = new Map(snap.docs.map((d) => [d.id, { id: d.id, ...d.data() }]));
    S.calReady = true;
    if (isAdminRole() && !snap.metadata.fromCache && !S.closureDone) { S.closureDone = true; runClosure(); }
    render();
  });
  if (isAdminRole()) {
    sub(S.db.doc(P.roles), (s) => { if (s.exists) { const d = s.data(); S.roles = { admins: d.admins || [], dominios: d.dominios || [], lectores: d.lectores || [] }; } render(); });
    sub(S.db.collection(P.notas), (snap) => { S.notas = Object.fromEntries(snap.docs.map((d) => [d.id, d.data().texto || ''])); render(); });
    sub(S.db.collection(P.hist).orderBy('ts', 'desc').limit(500), (snap) => { S.hist = snap.docs.map((d) => ({ id: d.id, ...d.data() })); render(); });
    sub(S.db.collection(P.regs), (snap) => { S.regs = snap.docs.map((d) => ({ id: d.id, ...d.data() })); render(); });
    sub(S.db.collection(P.props), (snap) => { S.props = snap.docs.map((d) => ({ id: d.id, ...d.data() })); render(); });
  }
  if (S.role === 'regional') {
    sub(S.db.doc(P.regs + '/' + S.email), (s) => { S.myAuth = s.exists ? s.data() : null; if (!S.myAuth || !S.myAuth.activo) { S.role = 'gerente'; S.tab = 'cal'; S.roleNote = 'Tu acceso como Regional fue retirado.'; } render(); });
    sub(S.db.collection(P.props).where('email', '==', S.email), (snap) => { S.myProps = snap.docs.map((d) => ({ id: d.id, ...d.data() })); render(); });
  }
}

/* Lista de días bloqueados que usan las reglas del servidor (LFT art. 74 + descansos configurados) */
async function syncBloqueos() {
  const y0 = +S.today.slice(0, 4);
  const fechas = [];
  for (let y = y0 - 1; y <= y0 + 6; y++) PL.holidaysForYear(y).forEach((h) => fechas.push(h.fecha));
  extras().forEach((x) => fechas.push(x.fecha));
  const lista = [...new Set(fechas)].sort();
  try {
    const cur = await S.db.doc(P.bloqueos).get();
    if (!cur.exists || JSON.stringify(cur.data().fechas || []) !== JSON.stringify(lista)) await S.db.doc(P.bloqueos).set({ fechas: lista, actualizado: nowISO() });
  } catch (e) { console.warn('bloqueos', e); }
}

/* ---------- Cierre mensual (respaldo al abrir; el cierre programado corre en GitHub Actions) ---------- */
async function runClosure() {
  S.today = PL.todayMX();
  const pend = PL.pendingClosures(records(), S.today);
  if (!pend.length) return;
  const porMes = {};
  for (const p of pend) {
    const r = S.cal.get(p.id); if (!r || r.estado === 'Cancelada' || r.estado === 'Realizada') continue;
    try {
      const batch = S.db.batch();
      batch.update(S.db.doc(P.cal + '/' + p.id), { estado: 'Realizada', cierreAuto: { mes: p.mes, ts: nowISO(), estadoAnterior: p.estadoAnterior, origen: 'app' } });
      batch.set(S.db.collection(P.hist).doc('auto-' + p.id + '-' + p.mes), { ts: nowISO(), por: 'sistema', auto: true, accion: 'Cierre automático', calId: p.id, nombre: r.nombre || '', detalle: `Mes ${p.mes}: “${p.estadoAnterior || 'sin estado'}” → “Realizada”` });
      await retry(() => batch.commit());
      (porMes[p.mes] = porMes[p.mes] || []).push(p.id);
    } catch (e) { console.warn('cierre', e); }
  }
  for (const [mes, ids] of Object.entries(porMes)) {
    try { await S.db.collection(P.cierres).doc(mes).set({ mes, ultimaEjecucion: nowISO(), ids: firebase.firestore.FieldValue.arrayUnion(...ids) }, { merge: true }); } catch (e) {}
  }
  const n = Object.values(porMes).flat().length;
  if (n) toast(`Cierre mensual aplicado: ${n} capacitación(es) de meses anteriores marcadas como “Realizada” (cierre automático).`, 'ok');
}
setInterval(() => { const t = PL.todayMX(); if (t.slice(0, 7) !== S.today.slice(0, 7)) { S.today = t; if (isAdminRole()) runClosure(); render(); } else S.today = t; }, 60000);

/* ---------- Etiquetas ---------- */
const AREA_COLORS = ['#7a3fb0', '#1b8a8a', '#c0582b', '#2e6fd1', '#9a7a00', '#c23b7a', '#4f8a2b', '#6b5bd6', '#a8452c', '#2b7f5f', '#8a5a9e', '#3a86a8'];
function areaColor(a) { if (!a) return 'var(--muted)'; let h = 0; for (const c of a) h = (h * 31 + c.charCodeAt(0)) >>> 0; return AREA_COLORS[h % AREA_COLORS.length]; }
const tipoClass = (t) => (t === 'Bootcamp' ? 'Bootcamp' : t === 'Online' ? 'Online' : t === 'En sitio' ? 'En' : 'none');
const tipoTag = (t) => `<span class="tag t-${tipoClass(t)}">${esc(t || 'Tipo por confirmar')}</span>`;
const stTag = (r) => `<span class="st st-${esc((r.estado || 'Por confirmar').split(' ')[0])}">${esc(r.estado || 'Por confirmar')}</span>${r.cierreAuto && r.cierreAuto.mes ? ' <span class="badge-auto" title="Marcada como realizada por el cierre mensual automático, no por validación manual">Cierre auto.</span>' : ''}`;
const pubTags = (r) => (r.publicos || []).map((p) => `<span class="tag pub">${esc(p)}</span>`).join('');
const areaTag = (a) => (a ? `<span class="tag area"><i style="background:${areaColor(a)}"></i>${esc(a)}</span>` : '<span class="tag area"><i></i>Área por confirmar</span>');
const horario = (r) => (r.horaInicio ? `${r.horaInicio}${r.horaFin ? '–' + r.horaFin : ''}` : 'Horario por confirmar');
/* ---------- Render principal ---------- */
let renderQueued = false;
function render() { if (renderQueued) return; renderQueued = true; requestAnimationFrame(() => { renderQueued = false; doRender(); }); }

function doRender() {
  const focusId = document.activeElement && document.activeElement.id;
  const selStart = document.activeElement && document.activeElement.selectionStart;
  renderTop();
  const main = $('#main');
  if (S.role === 'loading') { main.innerHTML = '<div class="loading"><div class="spin"></div>Cargando el calendario…</div>'; return; }
  if (S.role === 'error') { main.innerHTML = `<div class="alert bad">${esc(S.err)}</div><div class="row" style="margin-top:10px"><button class="btn primary" data-act="retry">Reintentar</button><button class="btn" data-act="logout">Salir</button></div>`; return; }
  if (S.role === 'sinacceso') { main.innerHTML = `<section class="panel"><h2 style="color:var(--accent)">Sin acceso</h2><p>La cuenta <b>${esc(S.email)}</b> no tiene acceso al calendario. Pide a la coordinación de capacitación que te habilite.</p>${S.diag ? `<p class="muted" style="font-size:12px">Detalle técnico: ${esc(S.diag)}</p>` : ''}<div class="row"><button class="btn primary" data-act="retry">Reintentar</button><button class="btn" data-act="logout">Ingresar con otra cuenta</button></div></section>`; return; }
  let html = '';
  if (S.roleNote) html += `<div class="alert warn">${esc(S.roleNote)}</div>`;
  if (S.preview) html += `<div class="alert info">Estás viendo la aplicación como la vería un Gerente. <button class="btn sm" data-act="preview-off">Volver a la vista de administradora</button></div>`;
  if (S.tab === 'cal') html += renderCalTab();
  else if (S.tab === 'prop' && isAdmin()) html += renderPropTab();
  else if (S.tab === 'hist' && isAdmin()) html += renderHistTab();
  else if (S.tab === 'cfg' && isAdmin()) html += renderCfgTab();
  else if (S.tab === 'reg' && S.role === 'regional') html += renderRegTab();
  else { S.tab = 'cal'; html += renderCalTab(); }
  const keep = {};
  main.querySelectorAll('input[id],textarea[id],select[id]').forEach((el) => { if (el.dataset.filter || ['selMes', 'selAnio', 'bcAll'].includes(el.id) || el.type === 'file') return; keep[el.id] = el.type === 'checkbox' ? el.checked : el.value; });
  main.querySelectorAll('.checks[id]').forEach((box) => { keep['#' + box.id] = [...box.querySelectorAll('input:checked')].map((x) => x.value); });
  main.innerHTML = html;
  Object.entries(keep).forEach(([id, v]) => {
    if (id.startsWith('#')) { const box = document.getElementById(id.slice(1)); if (box) box.querySelectorAll('input').forEach((x) => (x.checked = v.includes(x.value))); return; }
    const el = document.getElementById(id); if (!el) return; if (el.type === 'checkbox') el.checked = v; else if (v !== '' || el.tagName !== 'SELECT') el.value = v;
  });
  if (S.tab === 'cfg') { paintImport(); }
  if (focusId) { const el = document.getElementById(focusId); if (el) { el.focus(); try { if (selStart != null && el.setSelectionRange) el.setSelectionRange(selStart, selStart); } catch (e) {} } }
}

function renderTop() {
  const roleName = { admin: 'Administradora', gerente: 'Consulta · Gerentes', regional: 'Regional', loading: '…', error: '', sinacceso: 'Sin acceso' }[S.role];
  const tabs = [];
  if (S.role === 'regional') tabs.push(['reg', 'Mis propuestas'], ['cal', 'Calendario']);
  else tabs.push(['cal', 'Calendario']);
  if (isAdmin()) {
    const pend = S.props.filter((p) => p.estado === 'Pendiente').length;
    tabs.push(['prop', 'Propuestas' + (pend ? `<span class="count">${pend}</span>` : '')], ['hist', 'Historial'], ['cfg', 'Configuración']);
  }
  $('#top').innerHTML = `<div class="top-in"><div class="brand"><b>Planet <span>·</span> Calendario de capacitación</b><small>Bootcamps, capacitación online y en sitio · R1–R5 y Corporativo</small></div>
    <div class="who">${roleName ? `<span class="role">${esc(roleName)}</span>` : ''}${S.email ? `<span>${esc(S.email)}</span>` : ''}
    ${S.role === 'admin' ? `<button class="btn sm" data-act="${S.preview ? 'preview-off' : 'preview-on'}">${S.preview ? 'Salir de vista Gerentes' : 'Ver como Gerente'}</button>` : ''}${S.email ? '<button class="btn sm" data-act="logout">Salir</button>' : ''}</div></div>
    <nav class="tabs" role="tablist">${tabs.map(([k, l]) => `<button class="tab" role="tab" aria-selected="${S.tab === k}" data-tab="${k}">${l}</button>`).join('')}</nav>`;
}

/* ---------- Pestaña Calendario ---------- */
function filtered() { return records().filter((r) => PL.matches(r, S.filters)); }

function renderCalTab() {
  const st = PL.monthStats(filtered(), S.y, S.m);
  const anyFilter = Object.values(S.filters).some(Boolean);
  let h = `<section class="panel" aria-label="Mes"><div class="monthbar">
    <div class="row"><button class="iconbtn" data-act="prev" aria-label="Mes anterior">‹</button>
    <h1>${PL.MESES[S.m - 1]} <small class="tabnum">${S.y}</small></h1>
    <button class="iconbtn" data-act="next" aria-label="Mes siguiente">›</button></div>
    <div class="row">
      <div class="field"><label for="selMes">Mes</label><select id="selMes">${PL.MESES.map((n, i) => `<option value="${i + 1}" ${i + 1 === S.m ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
      <div class="field"><label for="selAnio">Año</label><input id="selAnio" type="number" min="2020" max="2040" value="${S.y}" style="width:96px"></div>
      <button class="btn" data-act="hoy">Hoy</button>
      <button class="btn" data-act="xls-month" title="Exporta la programación del mes con los filtros activos">Excel del mes</button>
      <div class="views" role="group" aria-label="Vista">${[['cal', 'Calendario'], ['agenda', 'Agenda'], ['bc', 'Bootcamps']].map(([k, l]) => `<button aria-pressed="${S.view === k}" data-view="${k}">${l}</button>`).join('')}</div>
      ${isAdmin() ? '<button class="btn primary" data-act="new">+ Nueva capacitación</button>' : ''}
    </div></div></section>`;

  h += `<section class="kpis" aria-label="Indicadores del mes">
    <div class="kpi main"><span class="lbl">Total de sesiones</span><span class="val">${st.total}</span><span class="sub">${st.actividadesBootcamp ? `Incluye ${st.actividadesBootcamp} actividad(es) de ${st.bootcamps} Bootcamp(s)` : 'Sesiones y actividades no canceladas del mes'}</span></div>
    <div class="kpi"><span class="lbl">Sesiones presenciales</span><span class="val">${st.presenciales}</span><span class="sub">Modalidad presencial</span></div>
    <div class="kpi"><span class="lbl">Sesiones online</span><span class="val">${st.online}</span><span class="sub">Modalidad online</span></div>
    <div class="kpi"><span class="lbl">Bootcamps del mes</span><span class="val">${st.bootcamps}</span><span class="sub">${st.actividadesBootcamp} actividad(es) en total · cada Bootcamp agrupa sus 6 días</span></div>
  </section>
  ${st.sinModalidad || st.canceladas || anyFilter ? `<p class="muted" style="margin:-6px 0 0;font-size:13px">${anyFilter ? 'Indicadores calculados con los filtros activos. ' : ''}${st.sinModalidad ? `${st.sinModalidad} sesión(es) sin modalidad definida. ` : ''}${st.canceladas ? `${st.canceladas} cancelada(s) no se cuentan en el total.` : ''}</p>` : ''}`;

  h += renderFilters();
  h += `<section class="panel" aria-label="Programación">${renderLegend()}<div style="height:12px"></div>`;
  if (!S.calReady) h += '<div class="loading"><div class="spin"></div>Cargando capacitaciones…</div>';
  else if (S.view === 'agenda') h += renderAgenda();
  else if (S.view === 'bc') h += renderBootcamps();
  else h += renderCalendar();
  h += '</section>';
  if (isAdmin()) h += renderDashboard();
  return h;
}

function renderFilters() {
  const f = S.filters;
  const areas = [...new Set([...(S.pub.areas || []), ...records().map((r) => r.area).filter(Boolean)])].sort();
  const sel = (id, label, opts, val) => `<div class="field"><label for="${id}">${label}</label><select id="${id}" data-filter="${id.slice(2)}"><option value="">Todos</option>${opts.map((o) => `<option ${o === val ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></div>`;
  return `<section class="panel" aria-label="Filtros"><div class="filters">
    ${sel('f-publico', 'Público', PL.PUBLICOS, f.publico)}
    ${sel('f-area', 'Área que imparte', areas, f.area)}
    ${sel('f-tipo', 'Tipo de capacitación', PL.TIPOS, f.tipo)}
    ${sel('f-modalidad', 'Modalidad', PL.MODALIDADES, f.modalidad)}
    ${sel('f-estado', 'Estado', PL.ESTADOS, f.estado)}
    <div class="field"><label for="f-club">Club</label><input id="f-club" data-filter="club" value="${esc(f.club || '')}" placeholder="Nombre del club"></div>
    <div class="field"><label for="f-q">Buscar</label><input id="f-q" data-filter="q" type="search" value="${esc(f.q || '')}" placeholder="Nombre, tema, facilitador…"></div>
    <div class="field"><button class="btn" data-act="clear-filters" ${Object.values(f).some(Boolean) ? '' : 'disabled'}>Limpiar filtros</button></div>
  </div></section>`;
}

function renderLegend() {
  const pre = `${S.y}-${PL.pad(S.m)}`;
  const areas = [...new Set(records().filter((r) => r.fecha && r.fecha.startsWith(pre)).map((r) => r.area).filter(Boolean))].sort().slice(0, 14);
  return `<div class="legend" aria-label="Leyenda">
    <div class="grp"><b>Tipo</b>${PL.TIPOS.map(tipoTag).join('')}</div>
    <div class="grp"><b>Estado</b>${PL.ESTADOS.map((e) => stTag({ estado: e })).join('')}</div>
    <div class="grp"><b>Público</b><span class="tag pub">R1–R5 · Corporativo</span></div>
    ${areas.length ? `<div class="grp"><b>Área</b>${areas.map(areaTag).join('')}</div>` : ''}
    <div class="grp"><b>Bloqueado</b><span class="tag" style="background:var(--holiday);color:var(--holiday-ink)">Descanso obligatorio</span></div>
  </div>`;
}

function evCard(r) {
  return `<button class="ev k-${tipoClass(r.tipo)} ${r.estado === 'Cancelada' ? 'cancel' : ''}" data-open="${esc(r.id)}">
    <span class="h">${esc(horario(r))} ${stTag(r)}</span>
    <span class="n">${esc(r.nombre || 'Sin nombre')}${r.tipo === 'Bootcamp' && r.numDia ? ` · Día ${esc(r.numDia)}` : ''}</span>
    ${r.tipo === 'Bootcamp' ? `<span class="club">Apertura: ${esc(r.clubApertura || 'club por confirmar')}</span>` : ''}
    <span class="m">${tipoTag(r.tipo)}${areaTag(r.area)}${pubTags(r)}${isAdmin() && (r.revision || []).length ? '<span class="rev">Revisar</span>' : ''}</span>
  </button>`;
}

function monthGrid() {
  const y = S.y, m = S.m;
  const first = (PL.dow(y, m, 1) + 6) % 7; // lunes = 0
  const dim = PL.daysInMonth(y, m);
  const cells = [];
  const prevDim = PL.daysInMonth(m === 1 ? y - 1 : y, m === 1 ? 12 : m - 1);
  for (let i = first - 1; i >= 0; i--) { const pm = m === 1 ? 12 : m - 1, py = m === 1 ? y - 1 : y; cells.push({ f: PL.ymd(py, pm, prevDim - i), d: prevDim - i, out: true }); }
  for (let d = 1; d <= dim; d++) cells.push({ f: PL.ymd(y, m, d), d, out: false });
  let nd = 1; while (cells.length % 7) { const nm = m === 12 ? 1 : m + 1, ny = m === 12 ? y + 1 : y; cells.push({ f: PL.ymd(ny, nm, nd), d: nd++, out: true }); }
  return cells;
}
function byDate(list) { const g = {}; list.forEach((r) => { if (PL.isDate(r.fecha)) (g[r.fecha] = g[r.fecha] || []).push(r); }); Object.values(g).forEach((a) => a.sort((x, y) => (x.horaInicio || '99').localeCompare(y.horaInicio || '99'))); return g; }

function renderCalendar() {
  const g = byDate(filtered());
  const cells = monthGrid();
  let h = '<div class="calwrap"><div class="cal" role="grid">' + DIAS_C.map((d) => `<div class="dh">${d}</div>`).join('');
  cells.forEach((c) => {
    const hol = PL.holidayInfo(c.f, extras());
    const evs = g[c.f] || [];
    h += `<div class="day ${c.out ? 'out' : ''} ${c.f === S.today ? 'today' : ''} ${hol ? 'hol' : ''}" role="gridcell">
      <div class="dn"><span>${c.d}</span>${isAdmin() && !c.out ? `<button class="add" data-newdate="${c.f}" aria-label="Nueva capacitación el ${c.f}" title="${hol ? 'Día bloqueado' : 'Nueva capacitación'}">+</button>` : ''}</div>
      ${hol ? `<div class="holtag" title="${esc(hol.fuente)}">Bloqueado · ${esc(hol.motivo)}</div>` : ''}
      ${evs.slice(0, 4).map(evCard).join('')}
      ${evs.length > 4 ? `<button class="more" data-day="${c.f}">+${evs.length - 4} más</button>` : ''}
    </div>`;
  });
  h += '</div>';
  // Versión compacta para celular
  const sel = S.selDay && S.selDay.slice(0, 7) === `${S.y}-${PL.pad(S.m)}` ? S.selDay : (S.today.slice(0, 7) === `${S.y}-${PL.pad(S.m)}` ? S.today : PL.ymd(S.y, S.m, 1));
  h += '<div class="mcal">' + DIAS_C.map((d) => `<div class="dh">${d.slice(0, 2)}</div>`).join('');
  cells.forEach((c) => {
    const hol = PL.holidayInfo(c.f, extras()); const evs = g[c.f] || [];
    h += `<button class="mday ${c.out ? 'out' : ''} ${hol ? 'hol' : ''} ${c.f === S.today ? 'today' : ''} ${c.f === sel ? 'sel' : ''}" data-selday="${c.f}" aria-label="${fmtFecha(c.f, true)}: ${evs.length} actividad(es)${hol ? ', día bloqueado' : ''}">${c.d}<span class="dots">${evs.slice(0, 4).map((r) => `<i style="background:var(--t-${r.tipo === 'Bootcamp' ? 'boot' : r.tipo === 'Online' ? 'online' : 'sitio'})"></i>`).join('')}</span></button>`;
  });
  h += '</div>';
  const mevs = g[sel] || []; const mh = PL.holidayInfo(sel, extras());
  h += `<div class="mlist"><h3 style="font-size:20px;color:var(--accent)">${fmtFecha(sel, true)}</h3>${mh ? `<div class="holtag">Bloqueado · ${esc(mh.motivo)}</div>` : ''}<div class="list" style="margin-top:8px">${mevs.length ? mevs.map(evCard).join('') : '<p class="muted">Sin actividades este día.</p>'}</div>${isAdmin() && !mh ? `<button class="btn primary sm" style="margin-top:8px" data-newdate="${sel}">+ Nueva capacitación este día</button>` : ''}</div>`;
  h += '</div>';
  if (!filtered().some((r) => r.fecha && r.fecha.slice(0, 7) === `${S.y}-${PL.pad(S.m)}`)) h += `<div class="empty" style="margin-top:12px"><b>Sin capacitaciones en ${PL.MESES[S.m - 1].toLowerCase()} ${S.y}${Object.values(S.filters).some(Boolean) ? ' con estos filtros' : ''}</b>${isAdmin() ? 'Usa “+ Nueva capacitación” o el botón + de cada día para programar.' : 'Cuando la coordinación programe capacitaciones aparecerán aquí.'}</div>`;
  return h;
}

function agendaItem(r) {
  return `<button class="ag-item k-${tipoClass(r.tipo)}" data-open="${esc(r.id)}">
    <span class="tabnum"><b>${esc(horario(r))}</b></span>
    <span style="display:flex;flex-direction:column;gap:4px;min-width:0"><span class="n">${esc(r.nombre || 'Sin nombre')}${r.tipo === 'Bootcamp' && r.numDia ? ` · Día ${esc(r.numDia)}` : ''}</span>
    ${r.tipo === 'Bootcamp' ? `<span class="club" style="color:var(--t-boot);font-weight:700">Club que se aperturará: ${esc(r.clubApertura || 'por confirmar')}</span>` : ''}
    <span class="muted" style="font-size:13px">${esc([r.tema, r.facilitador, r.modalidad, [r.sede, r.ciudad].filter(Boolean).join(', ')].filter(Boolean).join(' · '))}</span>
    <span class="m" style="display:flex;flex-wrap:wrap;gap:4px">${tipoTag(r.tipo)}${areaTag(r.area)}${pubTags(r)}</span></span>
    <span>${stTag(r)}</span></button>`;
}
function renderAgenda() {
  const pre = `${S.y}-${PL.pad(S.m)}`;
  const g = byDate(filtered().filter((r) => r.fecha && r.fecha.startsWith(pre)));
  const days = Object.keys(g).sort();
  if (!days.length) return `<div class="empty"><b>Sin capacitaciones en ${PL.MESES[S.m - 1].toLowerCase()} ${S.y}</b>Cambia de mes o ajusta los filtros.</div>`;
  return '<div class="agenda">' + days.map((d) => { const [, , dd] = d.split('-'); return `<div class="ag-day"><div class="ag-date"><b>${+dd}</b>${fmtFecha(d).split(' ')[0]}</div><div class="ag-list">${g[d].map(agendaItem).join('')}</div></div>`; }).join('') + '</div>';
}

function renderBootcamps() {
  const pre = `${S.y}-${PL.pad(S.m)}`;
  const all = filtered().filter((r) => r.tipo === 'Bootcamp');
  const groups = {};
  all.forEach((r) => { const k = PL.bootcampKey(r); (groups[k] = groups[k] || []).push(r); });
  let list = Object.values(groups).filter((g) => (S.bcAll ? g.some((r) => r.fecha && r.fecha.startsWith(String(S.y))) : g.some((r) => r.fecha && r.fecha.startsWith(pre))));
  list.sort((a, b) => (a.map((r) => r.fecha).sort()[0] || '').localeCompare(b.map((r) => r.fecha).sort()[0] || ''));
  let h = `<div class="row spread" style="margin-bottom:12px"><p class="muted" style="margin:0">${list.length} Bootcamp(s) · ${list.reduce((n, g) => n + g.length, 0)} actividad(es). Cada Bootcamp se identifica por su programa y el club que se aperturará.</p>
    <label class="chk"><input type="checkbox" id="bcAll" ${S.bcAll ? 'checked' : ''}> Ver todos los de ${S.y}</label></div>`;
  if (!list.length) return h + '<div class="empty"><b>Sin Bootcamps en este periodo</b>Los Bootcamps aparecen al registrar actividades de tipo Bootcamp con su club.</div>';
  h += '<div class="list" style="gap:14px">';
  list.forEach((g) => {
    const f = g.map((r) => r.fecha).filter(Boolean).sort();
    const club = g[0].clubApertura || 'Club por confirmar';
    const dias = {}; g.forEach((r) => { const k = r.numDia ? 'Día ' + r.numDia : 'Sin día asignado'; (dias[k] = dias[k] || []).push(r); });
    const keys = Object.keys(dias).sort((a, b) => (a.startsWith('Sin') ? 1 : b.startsWith('Sin') ? -1 : parseInt(a.slice(4)) - parseInt(b.slice(4))));
    const n = new Set(g.map((r) => r.numDia).filter(Boolean)).size;
    h += `<article class="bc"><div class="bc-head"><div><span class="lbl2">Club que se aperturará</span><h3>${esc(club)}</h3><span class="muted">${esc(g[0].programa || 'Programa sin nombre')} · ${f.length ? `${fmtFecha(f[0])} – ${fmtFecha(f[f.length - 1])}` : 'Sin fechas'}</span></div>
      <div class="row"><span class="tag t-Bootcamp">${g.length} actividad(es)</span><span class="tag ${n === 6 ? 'pub' : 'mod'}">${n} de 6 días programados</span></div></div>
      <div class="bc-days">${keys.map((k) => `<div class="bc-day"><h4>${k}</h4>${dias[k].sort((a, b) => (a.fecha + a.horaInicio).localeCompare(b.fecha + b.horaInicio)).map((r) => `<div class="muted tabnum" style="font-size:12px">${esc(fmtFecha(r.fecha))}</div>${evCard(r)}`).join('')}</div>`).join('')}</div></article>`;
  });
  return h + '</div>';
}
/* ---------- Dashboard acumulado para Dirección (sólo administradora) ---------- */
function renderDashboard() {
  const D = PL.dashboard(records(), S.y, S.m, S.today);
  const esMesActual = S.today.slice(0, 7) === `${S.y}-${PL.pad(S.m)}`;
  const n = (v) => `<span class="tabnum">${v}</span>`;
  const bars = (obj, total) => {
    const rows = Object.entries(obj).sort((a, b) => b[1].sesiones - a[1].sesiones);
    if (!rows.length) return '<p class="muted">Sin información registrada en el periodo.</p>';
    const max = Math.max(...rows.map((r) => r[1].sesiones), 1);
    return '<div class="bars">' + rows.map(([k, v]) => `<div class="bar"><span class="lab">${esc(k)}</span><span class="track" title="${v.realizadas} realizada(s) de ${v.sesiones}"><i class="c-real" style="width:${(v.realizadas / max) * 100}%"></i><i class="c-pend" style="width:${((v.sesiones - v.realizadas) / max) * 100}%;opacity:.45"></i></span><span class="tabnum" style="text-align:right">${v.realizadas}/${v.sesiones}</span></div>`).join('') + '</div>';
  };
  const maxEv = Math.max(1, ...D.evol.map((e) => e.realizadas + e.pendientes + e.canceladas));
  const corteTxt = D.futuro ? `El periodo aún no inicia (hoy es ${fmtFecha(S.today, true)}). Todo lo registrado es programación futura.`
    : esMesActual ? `Mes en curso. Fecha de corte: ${fmtFecha(D.corte, true)}. Lo realizado se cuenta hasta hoy; lo posterior es programación, no resultado.`
      : D.corte < D.fin ? `Fecha de corte: ${fmtFecha(D.corte, true)}. Las sesiones posteriores son programación futura.`
        : `Periodo cerrado al ${fmtFecha(D.fin, true)}.`;
  return `<section class="dash" id="dashboard" aria-label="Dashboard acumulado para Dirección">
    <div class="dash-head"><div><span class="lbl2">Sólo visible para la administradora</span><h2>Dashboard acumulado · enero – ${PL.MESES[S.m - 1].toLowerCase()} ${S.y}</h2>
      <p class="muted" style="margin:4px 0 0">${S.m === 12 ? 'Año completo.' : `Acumulado del 1 de enero al ${fmtFecha(D.fin, true)}.`} Considera todo el calendario oficial; no aplica los filtros de arriba ni incluye propuestas pendientes.</p></div>
      <div class="row"><button class="btn" data-act="xls-year">Exportar programación a Excel</button><button class="btn primary" data-act="pdf">Guardar dashboard en PDF</button></div></div>
    <div class="cut">${esc(corteTxt)}</div>
    <div class="kpis">
      <div class="kpi main"><span class="lbl">Sesiones registradas</span><span class="val">${n(D.registradas)}</span><span class="sub">Con fecha en el periodo, incluye canceladas</span></div>
      <div class="kpi"><span class="lbl">Realizadas</span><span class="val" style="color:var(--ok)">${n(D.realizadas)}</span><span class="sub">${D.realizadasManual} validadas manualmente · ${D.realizadasAuto} por cierre automático</span></div>
      <div class="kpi"><span class="lbl">Pendientes o programadas</span><span class="val" style="color:var(--info)">${n(D.pendientes)}</span><span class="sub">${D.pendientesFuturas} futuras · ${D.pendientesVencidas} con fecha ya cumplida sin validar</span></div>
      <div class="kpi"><span class="lbl">Canceladas</span><span class="val" style="color:var(--bad)">${n(D.canceladas)}</span><span class="sub">Se conservan con su estado</span></div>
      <div class="kpi"><span class="lbl">Presenciales / Online</span><span class="val">${n(D.presenciales)} / ${n(D.online)}</span><span class="sub">No canceladas${D.sinModalidad ? ` · ${D.sinModalidad} sin modalidad` : ''}</span></div>
      <div class="kpi"><span class="lbl">Bootcamps</span><span class="val">${n(D.bootcamps)}</span><span class="sub">${D.actividadesBootcamp} actividad(es) de Bootcamp</span></div>
      <div class="kpi"><span class="lbl">Horas realizadas</span><span class="val">${D.realizadas ? n(D.horasRealizadas.toLocaleString('es-MX')) : 'Sin información'}</span><span class="sub">${D.realizadasSinHorario ? `${D.realizadasSinHorario} realizada(s) sin horario válido: no suman horas` : 'Suma de horarios válidos de sesiones realizadas'}</span></div>
      <div class="kpi"><span class="lbl">Porcentaje de ejecución</span><span class="val">${D.ejecucion == null ? 'Sin información' : n(D.ejecucion + '%')}</span><span class="sub">Realizadas ÷ sesiones no canceladas con fecha hasta el corte (${D.baseEjecucion})</span></div>
    </div>
    <div class="grid2">
      <div><h3 style="font-size:20px;margin-bottom:8px">Distribución por área</h3><p class="muted" style="font-size:13px;margin:0 0 8px"><span class="sw c-real"></span>Realizadas <span class="sw c-pend" style="opacity:.45"></span>Resto programado · sin canceladas</p>${bars(D.porArea)}</div>
      <div><h3 style="font-size:20px;margin-bottom:8px">Distribución por público</h3><p class="muted" style="font-size:13px;margin:0 0 8px">Una sesión que convoca a varios públicos se cuenta una sola vez en el total general, pero aparece en cada público convocado.</p>${bars(D.porPublico)}</div>
    </div>
    <div><h3 style="font-size:20px;margin-bottom:6px">Evolución mensual</h3><p class="muted" style="font-size:13px;margin:0 0 8px"><span class="sw c-real"></span>Realizadas <span class="sw c-pend"></span>Pendientes/programadas <span class="sw c-canc"></span>Canceladas</p>
      <div class="evol" role="img" aria-label="Sesiones por mes">${D.evol.map((e) => `<div class="col" title="${PL.MESES[e.mes - 1]}: ${e.realizadas} realizadas, ${e.pendientes} pendientes, ${e.canceladas} canceladas"><span class="v">${e.realizadas + e.pendientes + e.canceladas}</span><i class="c-canc" style="height:${(e.canceladas / maxEv) * 85}%"></i><i class="c-pend" style="height:${(e.pendientes / maxEv) * 85}%"></i><i class="c-real" style="height:${(e.realizadas / maxEv) * 85}%"></i></div>`).join('')}</div>
      <div class="evol-x">${D.evol.map((e) => `<span>${PL.MESES[e.mes - 1].slice(0, 3)}</span>`).join('')}</div></div>
    <div><h3 style="font-size:20px;margin-bottom:8px">Detalle de capacitaciones del acumulado (${D.detalle.length})</h3>
      ${D.detalle.length ? `<div class="tablewrap"><table><thead><tr><th>Fecha</th><th>Horario</th><th>Capacitación</th><th>Tipo</th><th>Modalidad</th><th>Área</th><th>Público</th><th>Club apertura</th><th>Estado</th><th class="num">Horas</th></tr></thead><tbody>
      ${D.detalle.map((r) => { const d = PL.durationMin(r); return `<tr><td class="tabnum">${esc(r.fecha)}</td><td class="tabnum">${esc(r.horaInicio ? horario(r) : 'Sin información')}</td><td><a href="#" data-open="${esc(r.id)}">${esc(r.nombre)}</a></td><td>${esc(r.tipo || 'Sin información')}</td><td>${esc(r.modalidad || 'Sin información')}</td><td>${esc(r.area || 'Sin información')}</td><td>${esc((r.publicos || []).join(', ') || 'Sin información')}</td><td>${esc(r.tipo === 'Bootcamp' ? r.clubApertura || 'Sin información' : '—')}</td><td>${esc(r.estado)}${r.cierreAuto && r.cierreAuto.mes ? ' (cierre automático)' : r.estado === 'Realizada' ? ' (validación manual)' : ''}</td><td class="num">${d == null ? 'Sin información' : (d / 60).toFixed(1)}</td></tr>`; }).join('')}
      </tbody></table></div>` : '<div class="empty"><b>Sin capacitaciones registradas en el periodo</b>Los indicadores muestran cero porque no hay registros guardados entre enero y el mes seleccionado.</div>'}
      ${D.sinFecha ? `<p class="note" style="margin-top:8px">${D.sinFecha} registro(s) sin fecha no se incluyen en el acumulado. Están marcados para revisión.</p>` : ''}
    </div>
  </section>`;
}

/* ---------- Detalle ---------- */
function openModal(html, cls) {
  closeModal();
  const sc = document.createElement('div'); sc.className = 'scrim'; sc.id = 'scrim';
  sc.innerHTML = `<div class="modal ${cls || ''}" role="dialog" aria-modal="true">${html}</div>`;
  sc.addEventListener('mousedown', (e) => { if (e.target === sc) closeModal(); });
  document.body.appendChild(sc);
  const f = sc.querySelector('input,select,textarea,button.btn'); if (f) f.focus();
}
function closeModal() { const s = $('#scrim'); if (s) s.remove(); }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

function showDetail(id) {
  const r = S.cal.get(id); if (!r) return toast('Esta capacitación ya no existe.', 'bad');
  const fromProp = r.origen === 'propuesta';
  const v = (x) => (x == null || x === '' || (Array.isArray(x) && !x.length) ? `<span class="pc">${fromProp ? 'Por confirmar' : 'Sin información'}</span>` : esc(Array.isArray(x) ? x.join(', ') : x));
  const canSt = PL.canChangeStatus(r.fecha, S.today);
  let h = `<div class="modal-h"><div><span class="lbl2">${esc(r.programa || r.tipo || 'Capacitación')}</span><h2>${esc(r.nombre)}</h2><div class="row" style="margin-top:6px">${tipoTag(r.tipo)}${stTag(r)}${areaTag(r.area)}${pubTags(r)}</div></div><button class="iconbtn" data-act="close" aria-label="Cerrar">×</button></div><div class="modal-b">`;
  if (r.tipo === 'Bootcamp') h += `<div class="clubbanner"><small>Club que se aperturará</small>${esc(r.clubApertura || 'Por confirmar')}${r.numDia ? ` · Día ${esc(r.numDia)} de 6` : ''}</div>`;
  if (isAdmin() && (r.revision || []).length) h += `<div class="alert bad"><b>Marcada para revisión:</b><ul style="margin:4px 0 0 18px;padding:0">${r.revision.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
  if (r.cierreAuto && r.cierreAuto.mes) h += `<div class="alert warn">Marcada como “Realizada” por el cierre mensual automático de ${esc(r.cierreAuto.mes)} (${esc(fmtTS(r.cierreAuto.ts))}). No es una validación manual de ejecución.</div>`;
  const hol = PL.holidayInfo(r.fecha, extras());
  if (hol) h += `<div class="alert warn">Esta fecha es día de descanso obligatorio: ${esc(hol.motivo)} (${esc(hol.fuente)}).</div>`;
  h += `<dl class="dl">
    <dt>Fecha</dt><dd>${PL.isDate(r.fecha) ? esc(fmtFecha(r.fecha, true)) : v('')}</dd>
    <dt>Horario</dt><dd class="tabnum">${r.horaInicio ? esc(horario(r)) : v('')}</dd>
    <dt>Programa</dt><dd>${v(r.programa)}</dd><dt>Tema o actividad</dt><dd>${v(r.tema)}</dd>
    <dt>Tipo</dt><dd>${v(r.tipo)}</dd><dt>Modalidad</dt><dd>${v(r.modalidad)}</dd>
    <dt>Área que imparte</dt><dd>${v(r.area)}</dd><dt>Facilitador</dt><dd>${v(r.facilitador)}</dd>
    <dt>Público</dt><dd>${v(r.publicos)}</dd><dt>Perfil de asistentes</dt><dd>${v(r.perfil)}</dd>
    ${r.tipo === 'Bootcamp' ? `<dt>Club que se aperturará</dt><dd><b>${v(r.clubApertura)}</b></dd><dt>Día del Bootcamp</dt><dd>${v(r.numDia)}</dd>` : `<dt>Día o sesión</dt><dd>${v(r.numDia)}</dd>`}
    <dt>Clubes participantes</dt><dd>${v(r.clubes)}</dd><dt>Ciudad</dt><dd>${v(r.ciudad)}</dd><dt>Sede</dt><dd>${v(r.sede)}</dd>
    ${r.modalidad === 'Online' || r.enlace ? `<dt>Enlace de conexión</dt><dd>${r.enlace && /^https?:\/\//i.test(r.enlace) ? `<a href="${esc(r.enlace)}" target="_blank" rel="noopener">${esc(r.enlace)}</a>` : v('')}</dd>` : ''}
    ${isAdmin() ? `<dt>Notas internas</dt><dd>${S.notas[r.id] ? esc(S.notas[r.id]).replace(/\n/g, '<br>') : '<span class="muted">Sin notas</span>'}</dd>
    <dt>Origen</dt><dd>${esc({ propuesta: 'Propuesta de Regional confirmada', importacion: 'Importado de archivo', manual: 'Captura manual', duplicado: 'Duplicado' }[r.origen] || 'Captura manual')}</dd>
    ${r.actualizado ? `<dt>Última modificación</dt><dd>${esc(fmtTS(r.actualizado))}</dd>` : ''}` : ''}
  </dl>`;
  if (isAdmin()) {
    h += `<div class="panel" style="background:var(--surface)"><div class="row spread"><b>Cambiar estado</b>${canSt ? '' : '<span class="lock">Bloqueado: sólo se modifica el estado de capacitaciones del mes en curso.</span>'}</div>
      <div class="row" style="margin-top:8px">${PL.ESTADOS.map((e) => `<button class="btn sm" data-setstatus="${esc(e)}" data-id="${esc(r.id)}" ${!canSt || r.estado === e ? 'disabled' : ''}>${esc(e)}</button>`).join('')}</div></div>`;
  }
  h += '</div>';
  if (isAdmin()) h += `<div class="modal-f"><button class="btn" data-act="close">Cerrar</button><button class="btn" data-dup="${esc(r.id)}">Duplicar capacitación</button><button class="btn primary" data-edit="${esc(r.id)}">Editar</button></div>`;
  else h += '<div class="modal-f"><button class="btn" data-act="close">Cerrar</button></div>';
  openModal(h);
}

async function setStatus(id, estado, btn) {
  if (!isAdmin()) return;
  const r = S.cal.get(id); if (!r) return;
  if (!PL.canChangeStatus(r.fecha, PL.todayMX())) return toast('Sólo se puede cambiar el estado de capacitaciones del mes en curso.', 'bad');
  const key = 'st' + id; if (S.busy.has(key)) return; S.busy.add(key); if (btn) btn.disabled = true;
  try {
    await retry(() => S.db.doc(P.cal + '/' + id).update({ estado, actualizado: nowISO(), cierreAuto: null }));
    await addHist({ accion: 'Cambio de estado', calId: id, nombre: r.nombre, detalle: `“${r.estado}” → “${estado}” (validación manual)` });
    toast(`Estado actualizado a “${estado}”.`, 'ok'); showDetail(id);
  } catch (e) { toast(dbErr(e), 'bad'); } finally { S.busy.delete(key); }
}

/* ---------- Formulario de capacitación (crear / editar / duplicar) ---------- */
const FIELDS = ['nombre', 'programa', 'tema', 'tipo', 'modalidad', 'area', 'facilitador', 'publicos', 'perfil', 'clubApertura', 'clubes', 'ciudad', 'sede', 'fecha', 'horaInicio', 'horaFin', 'numDia', 'enlace', 'estado'];
let FORM = null; // {mode, id, src}

function openForm(mode, id, fecha) {
  if (!isAdmin()) return;
  const src = id ? S.cal.get(id) : null;
  const base = src ? { ...src } : { publicos: [], estado: 'Programada', fecha: fecha || '' };
  if (mode === 'dup') { base.fecha = ''; if (!['Por confirmar', 'Programada'].includes(base.estado)) base.estado = 'Programada'; }
  FORM = { mode, id: mode === 'edit' ? id : null, src, nota: src ? S.notas[src.id] || '' : '' };
  const d = base;
  const areas = [...new Set([...(S.pub.areas || []), d.area].filter(Boolean))].sort();
  const isNew = mode !== 'edit';
  const canSt = isNew || PL.canChangeStatus(src.fecha, S.today);
  const t = mode === 'edit' ? 'Editar capacitación' : mode === 'dup' ? 'Duplicar capacitación' : 'Nueva capacitación';
  const opt = (list, val, empty) => (empty ? `<option value="">${empty}</option>` : '') + list.map((o) => `<option ${o === val ? 'selected' : ''}>${esc(o)}</option>`).join('');
  const fld = (k, label, inner, cls) => `<div class="field ${cls || ''}" data-f="${k}"><label for="fm-${k}">${label}</label>${inner}<span class="err" id="err-${k}"></span></div>`;
  const inp = (k, label, type, extra, cls) => fld(k, label, `<input id="fm-${k}" type="${type || 'text'}" value="${esc(d[k] == null ? '' : d[k])}" ${extra || ''}>`, cls);
  const h = `<div class="modal-h"><div><span class="lbl2">${mode === 'dup' ? 'Se creará un registro nuevo; la capacitación original no cambia' : 'Calendario oficial'}</span><h2>${t}</h2></div><button class="iconbtn" data-act="close" aria-label="Cerrar">×</button></div>
  <form id="tform" class="modal-b" novalidate>
    ${mode === 'dup' ? '<div class="alert info">Elige la nueva fecha. La copia no se guarda hasta que confirmes con “Guardar copia”.</div>' : ''}
    ${src && src.origen === 'propuesta' ? '<div class="alert info">Viene de una propuesta de Regional. Completa los datos que estén por confirmar.</div>' : ''}
    <div class="fgrid">
      ${inp('nombre', 'Nombre de la capacitación *', 'text', 'required maxlength="160"', 'wide')}
      ${inp('programa', 'Programa al que pertenece', 'text', 'list="dl-prog"')}
      ${inp('tema', 'Tema o actividad')}
      ${fld('tipo', 'Tipo *', `<select id="fm-tipo">${opt(PL.TIPOS, d.tipo, 'Por confirmar')}</select>`)}
      ${fld('modalidad', 'Modalidad *', `<select id="fm-modalidad">${opt(PL.MODALIDADES, d.modalidad, 'Por confirmar')}</select>`)}
      ${fld('area', 'Área que imparte', `<div class="row" style="flex-wrap:nowrap"><select id="fm-area" style="flex:1">${opt(areas, d.area, 'Por confirmar')}</select><button type="button" class="btn sm" data-act="add-area">+ Área</button></div>`)}
      ${inp('facilitador', 'Facilitador')}
      ${fld('publicos', 'Público *', `<div class="checks" id="fm-publicos">${PL.PUBLICOS.map((p) => `<label class="chk"><input type="checkbox" value="${p}" ${(d.publicos || []).includes(p) ? 'checked' : ''}>${p}</label>`).join('')}</div>`, 'wide')}
      ${inp('perfil', 'Perfil de asistentes', 'text', 'list="dl-perfil" placeholder="Ej. Gerentes y Subgerentes"')}
      ${inp('clubApertura', 'Club que se aperturará' + (d.tipo === 'Bootcamp' ? ' *' : ''), 'text', 'list="dl-club"')}
      ${inp('clubes', 'Clubes participantes')}
      ${inp('ciudad', 'Ciudad')}
      ${inp('sede', 'Sede')}
      ${inp('fecha', 'Fecha *', 'date')}
      ${inp('horaInicio', 'Hora de inicio', 'time')}
      ${inp('horaFin', 'Hora de fin', 'time')}
      ${inp('numDia', 'Día o sesión del programa', 'number', 'min="1" max="99"')}
      ${inp('enlace', 'Enlace de conexión (online)', 'url', 'placeholder="https://"', 'wide')}
      ${fld('estado', 'Estado', `<select id="fm-estado" ${canSt ? '' : 'disabled'}>${opt(isNew && !PL.canChangeStatus(d.fecha, S.today) ? ['Por confirmar', 'Programada'] : PL.ESTADOS, d.estado)}</select>${canSt ? (isNew ? '<span class="lock">Fuera del mes en curso sólo puedes iniciar en “Por confirmar” o “Programada”.</span>' : '') : '<span class="lock">Bloqueado: el estado sólo se modifica en capacitaciones del mes en curso.</span>'}`)}
      ${fld('notas', 'Notas internas (sólo administradora)', `<textarea id="fm-notas">${esc(FORM.nota)}</textarea>`, 'wide')}
      ${src && (src.revision || []).length && mode === 'edit' ? `<div class="field wide"><label class="chk"><input type="checkbox" id="fm-revisado"> Ya revisé: quitar la marca de revisión (${src.revision.length})</label></div>` : ''}
    </div>
    <datalist id="dl-prog">${[...new Set(records().map((r) => r.programa).filter(Boolean))].map((x) => `<option value="${esc(x)}">`).join('')}</datalist>
    <datalist id="dl-club">${[...new Set(records().flatMap((r) => [r.clubApertura]).filter(Boolean))].map((x) => `<option value="${esc(x)}">`).join('')}</datalist>
    <datalist id="dl-perfil"><option value="Gerentes y Subgerentes"><option value="Gerentes"><option value="Subgerentes"><option value="Personal del club">${[...new Set(records().map((r) => r.perfil).filter(Boolean))].map((x) => `<option value="${esc(x)}">`).join('')}</datalist>
    <div id="form-msg"></div>
  </form>
  <div class="modal-f"><button class="btn" data-act="close">Cancelar</button><button class="btn primary" id="btnSave" data-act="save">${mode === 'dup' ? 'Guardar copia' : 'Guardar'}</button></div>`;
  openModal(h);
  $('#fm-fecha').addEventListener('change', liveDate);
  $('#fm-tipo').addEventListener('change', (e) => { const l = $('[data-f="clubApertura"] label'); l.textContent = 'Club que se aperturará' + (e.target.value === 'Bootcamp' ? ' *' : ''); const mod = $('#fm-modalidad'); if (e.target.value === 'Online' && !mod.value) mod.value = 'Online'; if ((e.target.value === 'Bootcamp' || e.target.value === 'En sitio') && !mod.value) mod.value = 'Presencial'; });
  liveDate();
}
function liveDate() {
  const f = $('#fm-fecha'); if (!f) return;
  const changed = !FORM.src || FORM.mode !== 'edit' || f.value !== FORM.src.fecha;
  const hol = changed ? PL.holidayInfo(f.value, extras()) : null;
  $('#err-fecha').textContent = hol ? `Día bloqueado: ${hol.motivo} (${hol.fuente}). Elige otra fecha.` : '';
  $('[data-f="fecha"]').classList.toggle('invalid', !!hol);
  if (FORM.mode !== 'edit') { // en altas, los estados disponibles dependen del mes
    const sel = $('#fm-estado'); const cur = sel.value; const all = PL.canChangeStatus(f.value, S.today) ? PL.ESTADOS : ['Por confirmar', 'Programada'];
    sel.innerHTML = all.map((o) => `<option ${o === cur ? 'selected' : ''}>${o}</option>`).join('');
  }
}
function readForm() {
  const g = (k) => ($('#fm-' + k) ? $('#fm-' + k).value.trim() : '');
  const d = {}; FIELDS.forEach((k) => { if (k !== 'publicos') d[k] = g(k); });
  d.publicos = [...document.querySelectorAll('#fm-publicos input:checked')].map((x) => x.value);
  return d;
}
async function saveForm() {
  if (!isAdmin() || !FORM) return;
  const btn = $('#btnSave'); if (btn.disabled) return;
  const d = readForm(); const nota = $('#fm-notas').value;
  const src = FORM.src; const isNew = FORM.mode !== 'edit';
  S.today = PL.todayMX();
  const errs = PL.validateTraining(d, { today: S.today, isNew, dateChanged: isNew || d.fecha !== src.fecha, extras: extras(), estadoOriginal: src && src.estado, fechaOriginal: src && src.fecha });
  document.querySelectorAll('#tform .field').forEach((f) => f.classList.remove('invalid'));
  document.querySelectorAll('#tform .err').forEach((e) => (e.textContent = ''));
  if (Object.keys(errs).length) {
    Object.entries(errs).forEach(([k, m]) => { const e = $('#err-' + k); if (e) { e.textContent = m; e.closest('.field').classList.add('invalid'); } });
    $('#form-msg').innerHTML = `<div class="alert bad">Revisa ${Object.keys(errs).length} campo(s) marcado(s) antes de guardar.</div>`;
    const first = $('#tform .invalid input, #tform .invalid select'); if (first) first.focus();
    return;
  }
  btn.disabled = true; btn.textContent = 'Guardando…';
  const id = isNew ? uidGen('c') : FORM.id;
  const rec = { ...d, numDia: d.numDia === '' ? '' : String(d.numDia), actualizado: nowISO() };
  if (isNew) { rec.creado = nowISO(); rec.origen = FORM.mode === 'dup' ? 'duplicado' : 'manual'; rec.revision = []; rec.cierreAuto = null; if (FORM.mode === 'dup') rec.duplicadoDe = src.id; }
  else {
    rec.creado = src.creado || ''; rec.origen = src.origen || 'manual'; rec.cierreAuto = d.estado === src.estado ? src.cierreAuto || null : null;
    rec.revision = $('#fm-revisado') && $('#fm-revisado').checked ? [] : (src.revision || []);
    if (src.propuesta) rec.propuesta = src.propuesta; if (src.duplicadoDe) rec.duplicadoDe = src.duplicadoDe;
  }
  try {
    await retry(() => S.db.doc(P.cal + '/' + id).set(rec));
    if ((nota || '') !== (FORM.nota || '') || (FORM.mode === 'dup' && nota)) await retry(() => S.db.doc(P.notas + '/' + id).set({ texto: nota }));
    let detalle = '';
    if (!isNew) { const ch = FIELDS.filter((k) => JSON.stringify(src[k] ?? '') !== JSON.stringify(rec[k] ?? '')); detalle = ch.length ? 'Campos: ' + ch.join(', ') : 'Sin cambios en campos'; if (src.estado !== rec.estado) detalle += ` · estado “${src.estado}” → “${rec.estado}”`; }
    await addHist({ accion: FORM.mode === 'dup' ? 'Duplicada' : isNew ? 'Creada' : 'Editada', calId: id, nombre: rec.nombre, detalle: FORM.mode === 'dup' ? `Copia de ${src.nombre} (${src.fecha || 'sin fecha'}) para el ${rec.fecha}` : detalle });
    toast(FORM.mode === 'dup' ? 'Copia guardada como capacitación nueva.' : isNew ? 'Capacitación guardada en el calendario.' : 'Cambios guardados.', 'ok');
    closeModal(); FORM = null;
    if (PL.isDate(rec.fecha)) { S.y = +rec.fecha.slice(0, 4); S.m = +rec.fecha.slice(5, 7); render(); }
  } catch (e) { btn.disabled = false; btn.textContent = 'Guardar'; $('#form-msg').innerHTML = `<div class="alert bad">${esc(dbErr(e))}</div>`; }
}
function addAreaInline() {
  const box = $('[data-f="area"]');
  if ($('#newArea')) return $('#newArea').focus();
  const w = document.createElement('div'); w.className = 'row'; w.style.marginTop = '6px';
  w.innerHTML = '<input id="newArea" placeholder="Nombre del área" style="flex:1;border:1px solid var(--line);border-radius:8px;padding:6px 8px;min-width:0"><button type="button" class="btn sm primary" data-act="save-area">Agregar</button>';
  box.appendChild(w); $('#newArea').focus();
}
async function saveAreaInline() {
  const v = ($('#newArea').value || '').trim(); if (!v) return;
  const areas = [...new Set([...(S.pub.areas || []), v])].sort();
  try { await savePub({ areas }); const sel = $('#fm-area'); if (sel && ![...sel.options].some((o) => o.value === v)) sel.add(new Option(v, v)); if (sel) sel.value = v; $('#newArea').closest('.row').remove(); toast(`Área “${v}” agregada al catálogo.`, 'ok'); await addHist({ accion: 'Catálogo de áreas', detalle: `Alta: ${v}` }); }
  catch (e) { toast(dbErr(e), 'bad'); }
}
async function savePub(patch) {
  const ref = S.db.doc(P.pub);
  const cur = { areas: S.pub.areas || [], descansos: S.pub.descansos || [], ...patch };
  await retry(() => ref.set(cur)); S.pub = cur; render();
}
/* ---------- Bandeja de propuestas (administradora) ---------- */
const regOf = (email) => S.regs.find((r) => r.id === email);
function renderPropTab() {
  const list = [...S.props].sort((a, b) => (b.enviado || '').localeCompare(a.enviado || ''));
  const f = S.propFilter || 'Pendiente';
  const shown = list.filter((p) => f === 'Todas' || p.estado === f);
  const cnt = (e) => list.filter((p) => p.estado === e).length;
  let h = `<section class="panel"><div class="sec-title"><h2>Propuestas de Regionales</h2><div class="views" role="group">${['Pendiente', 'Confirmada', 'Rechazada', 'Todas'].map((e) => `<button aria-pressed="${f === e}" data-propfilter="${e}">${e}${e !== 'Todas' ? ` (${cnt(e)})` : ''}</button>`).join('')}</div></div>
    <p class="muted">Las propuestas están separadas del calendario oficial y no cuentan en los indicadores hasta que las confirmes. Al confirmar se crea una sola capacitación con el nombre, la fecha y la región propuestos; el resto queda “Por confirmar”.</p>`;
  if (!S.regs.length && !list.length) h += '<div class="empty"><b>Aún no hay Regionales habilitados</b>Regístralos en Configuración → Accesos de Regionales.</div>';
  else if (!shown.length) h += `<div class="empty"><b>Sin propuestas ${f === 'Todas' ? '' : f.toLowerCase() + 's'}</b>Cuando un Regional envíe una propuesta aparecerá aquí.</div>`;
  else {
    h += `<div class="tablewrap"><table><thead><tr><th>Capacitación</th><th>Fecha propuesta</th><th>Región</th><th>Regional</th><th>Enviada</th><th>Estado</th><th></th></tr></thead><tbody>`;
    shown.forEach((p) => {
      const e = p.estado; const reg = regOf(p.email);
      const warn = [];
      if (!reg || !reg.activo) warn.push('Regional sin acceso activo');
      else if (!(reg.regiones || []).includes(p.region)) warn.push('Región no autorizada para este Regional');
      if (PL.holidayInfo(p.fecha, extras())) warn.push('Fecha en día de descanso obligatorio');
      if (e === 'Pendiente' && p.fecha < S.today) warn.push('La fecha propuesta ya pasó');
      const cls = e === 'Confirmada' ? 'Realizada' : e === 'Rechazada' ? 'Cancelada' : 'Por';
      h += `<tr><td><b>${esc(p.nombre)}</b>${warn.length && e === 'Pendiente' ? `<div class="rev" style="display:inline-block;margin-top:4px">${esc(warn.join(' · '))}</div>` : ''}</td><td class="tabnum">${esc(fmtFecha(p.fecha))}</td><td><span class="tag pub">${esc(p.region)}</span></td><td>${esc(p.email)}</td><td class="tabnum">${esc(fmtTS(p.enviado))}</td>
        <td><span class="st st-${cls}">${esc(e)}</span>${p.decision ? `<div class="muted" style="font-size:12px">${esc(fmtTS(p.decision))}</div>` : ''}${p.motivo ? `<div class="muted" style="font-size:12px">${esc(p.motivo)}</div>` : ''}</td>
        <td>${e === 'Pendiente' ? `<div class="row" style="flex-wrap:nowrap"><button class="btn sm ok" data-confirm="${esc(p.id)}" ${warn.length ? 'disabled title="Corrige o rechaza: ' + esc(warn.join(', ')) + '"' : ''}>Confirmar</button><button class="btn sm danger" data-reject="${esc(p.id)}">Rechazar</button></div>` : e === 'Confirmada' && p.calId && S.cal.has(p.calId) ? `<button class="btn sm" data-open="${esc(p.calId)}">Ver en calendario</button>` : ''}</td></tr>`;
    });
    h += '</tbody></table></div>';
  }
  return h + '</section>';
}
async function confirmProp(pid, btn) {
  const key = 'cp' + pid; if (!isAdmin() || S.busy.has(key)) return; S.busy.add(key); if (btn) btn.disabled = true;
  const calId = 'p-' + pid; // id determinista: una propuesta sólo puede generar una capacitación
  try {
    S.today = PL.todayMX();
    const res = await S.db.runTransaction(async (tx) => {
      const pref = S.db.doc(P.props + '/' + pid); const ps = await tx.get(pref);
      if (!ps.exists) throw { msg: 'La propuesta ya no existe.' };
      const p = ps.data();
      if (p.estado !== 'Pendiente') return { ya: p.estado };
      const rs = await tx.get(S.db.doc(P.regs + '/' + p.email)); const reg = rs.exists ? rs.data() : null;
      const errs = PL.validateProposal(p, { today: S.today, extras: extras(), regiones: reg && reg.activo ? reg.regiones : [] });
      if (Object.keys(errs).length) throw { msg: 'No se puede confirmar: ' + Object.values(errs).join(' ') };
      const cref = S.db.doc(P.cal + '/' + calId); const cs = await tx.get(cref);
      if (!cs.exists) tx.set(cref, { nombre: p.nombre, fecha: p.fecha, publicos: [p.region], estado: 'Por confirmar', programa: '', tema: '', tipo: '', modalidad: '', area: '', facilitador: '', perfil: '', clubApertura: '', clubes: '', ciudad: '', sede: '', horaInicio: '', horaFin: '', numDia: '', enlace: '', origen: 'propuesta', propuesta: { id: pid, email: p.email, enviado: p.enviado || '', region: p.region }, revision: [], cierreAuto: null, creado: nowISO(), actualizado: nowISO() });
      tx.update(pref, { estado: 'Confirmada', decision: nowISO(), calId, decididoPor: S.email });
      return { p };
    });
    if (res.ya) { toast(`Esta propuesta ya está ${res.ya.toLowerCase()}.`); return; }
    await addHist({ accion: 'Propuesta confirmada', calId, nombre: res.p.nombre, detalle: `${res.p.region} · ${res.p.fecha} · enviada por ${res.p.email}` }, 'prop-' + pid);
    toast('Propuesta confirmada y agregada al calendario como “Por confirmar”. Completa sus datos cuando los tengas.', 'ok');
  } catch (e) { toast(e.msg || dbErr(e), 'bad'); } finally { S.busy.delete(key); render(); }
}
function askReject(pid) {
  const p = S.props.find((x) => x.id === pid); if (!p) return;
  openModal(`<div class="modal-h"><h2>Rechazar propuesta</h2><button class="iconbtn" data-act="close" aria-label="Cerrar">×</button></div><div class="modal-b"><p>“${esc(p.nombre)}” · ${esc(p.region)} · ${esc(fmtFecha(p.fecha, true))}</p><div class="field"><label for="rj-motivo">Motivo (opcional, lo verá el Regional)</label><textarea id="rj-motivo"></textarea></div><p class="muted">La propuesta se conserva como rechazada y no se agrega al calendario.</p></div><div class="modal-f"><button class="btn" data-act="close">Cancelar</button><button class="btn danger" data-dorej="${esc(pid)}">Rechazar propuesta</button></div>`, 'sm');
}
async function doReject(pid, btn) {
  const key = 'rj' + pid; if (!isAdmin() || S.busy.has(key)) return; S.busy.add(key); btn.disabled = true;
  try {
    const motivo = ($('#rj-motivo').value || '').trim();
    const p = await S.db.runTransaction(async (tx) => {
      const ref = S.db.doc(P.props + '/' + pid); const s = await tx.get(ref);
      if (!s.exists || s.data().estado !== 'Pendiente') throw { msg: 'Esta propuesta ya fue decidida.' };
      tx.update(ref, { estado: 'Rechazada', decision: nowISO(), motivo, decididoPor: S.email }); return s.data();
    });
    await addHist({ accion: 'Propuesta rechazada', nombre: p.nombre, detalle: `${p.region} · ${p.fecha} · ${p.email}${motivo ? ' · ' + motivo : ''}` }, 'prop-' + pid);
    toast('Propuesta rechazada.', 'ok'); closeModal();
  } catch (e) { toast(e.msg || dbErr(e), 'bad'); btn.disabled = false; } finally { S.busy.delete(key); }
}

/* ---------- Portal de Regionales ---------- */
function renderRegTab() {
  const regs = (S.myAuth && S.myAuth.regiones) || [];
  let h = `<section class="panel"><div class="sec-title"><h2>Proponer una capacitación</h2></div>
    <p class="muted">Tu propuesta llega a la coordinación de capacitación. No forma parte del calendario oficial hasta que la confirmen.</p>
    <form id="pform" class="fgrid" novalidate>
      <div class="field wide" data-f="p-nombre"><label for="p-nombre">Nombre de la capacitación *</label><input id="p-nombre" maxlength="160" required><span class="err" id="err-p-nombre"></span></div>
      <div class="field" data-f="p-fecha"><label for="p-fecha">Día propuesto *</label><input id="p-fecha" type="date" min="${S.today}" required><span class="err" id="err-p-fecha"></span></div>
      <div class="field" data-f="p-region"><label for="p-region">Región *</label><select id="p-region">${regs.length > 1 ? '<option value="">Elige una región</option>' : ''}${regs.map((r) => `<option>${esc(r)}</option>`).join('')}</select><span class="err" id="err-p-region"></span></div>
      <div class="field wide"><button class="btn primary" id="btnProp" type="submit" ${regs.length ? '' : 'disabled'}>Enviar propuesta</button></div>
    </form>${regs.length ? `<p class="muted" style="font-size:13px">Regiones autorizadas: ${regs.map((r) => `<span class="tag pub">${esc(r)}</span>`).join(' ')}</p>` : '<div class="alert warn">No tienes regiones autorizadas. Pide a la coordinación que te las asigne.</div>'}</section>`;
  const mine = [...S.myProps].sort((a, b) => (b.enviado || '').localeCompare(a.enviado || ''));
  h += `<section class="panel"><div class="sec-title"><h2>Mis propuestas</h2></div>`;
  if (!mine.length) h += '<div class="empty"><b>Aún no has enviado propuestas</b>Usa el formulario de arriba para proponer una fecha.</div>';
  else h += `<div class="tablewrap"><table><thead><tr><th>Capacitación</th><th>Fecha propuesta</th><th>Región</th><th>Enviada</th><th>Estado</th></tr></thead><tbody>${mine.map((p) => { const e = p.estado || 'Pendiente'; return `<tr><td>${esc(p.nombre)}</td><td class="tabnum">${esc(fmtFecha(p.fecha))}</td><td><span class="tag pub">${esc(p.region)}</span></td><td class="tabnum">${esc(fmtTS(p.enviado))}</td><td><span class="st st-${e === 'Confirmada' ? 'Realizada' : e === 'Rechazada' ? 'Cancelada' : 'Por'}">${esc(e)}</span>${p.motivo ? `<div class="muted" style="font-size:12px">${esc(p.motivo)}</div>` : ''}</td></tr>`; }).join('')}</tbody></table></div>`;
  return h + '</section>';
}
async function sendProposal() {
  const btn = $('#btnProp'); if (!btn || btn.disabled) return;
  const p = { nombre: $('#p-nombre').value.trim(), fecha: $('#p-fecha').value, region: $('#p-region').value };
  S.today = PL.todayMX();
  const errs = PL.validateProposal(p, { today: S.today, extras: extras(), regiones: (S.myAuth && S.myAuth.regiones) || [] });
  ['nombre', 'fecha', 'region'].forEach((k) => { $('#err-p-' + k).textContent = errs[k] || ''; $(`[data-f="p-${k}"]`).classList.toggle('invalid', !!errs[k]); });
  if (Object.keys(errs).length) return;
  btn.disabled = true; btn.textContent = 'Enviando…';
  try {
    await retry(() => S.db.collection(P.props).doc(uidGen('p')).set({ ...p, email: S.email, enviado: nowISO(), estado: 'Pendiente' }));
    toast('Propuesta enviada. Queda pendiente de confirmación.', 'ok');
    $('#pform').reset();
  } catch (e) { toast(dbErr(e), 'bad'); }
  finally { btn.disabled = false; btn.textContent = 'Enviar propuesta'; }
}

/* ---------- Historial ---------- */
function renderHistTab() {
  const f = S.histFilter;
  const list = S.hist.filter((h) => f === 'todos' || (f === 'auto' ? h.auto : !h.auto));
  let h = `<section class="panel"><div class="sec-title"><h2>Historial de movimientos</h2><div class="views" role="group">${[['todos', 'Todos'], ['manual', 'Manuales'], ['auto', 'Cierre automático']].map(([k, l]) => `<button aria-pressed="${f === k}" data-histfilter="${k}">${l}</button>`).join('')}</div></div>
  <p class="muted">Los cierres automáticos se registran aparte para distinguirlos de la validación manual de ejecución. Se muestran los últimos 500 movimientos.</p>`;
  if (!list.length) h += '<div class="empty"><b>Sin movimientos registrados</b>Cada alta, edición, duplicado, cambio de estado, cierre y decisión sobre propuestas aparecerá aquí.</div>';
  else h += `<div class="tablewrap"><table><thead><tr><th>Fecha y hora</th><th>Movimiento</th><th>Capacitación</th><th>Detalle</th><th>Por</th></tr></thead><tbody>${list.map((x) => `<tr><td class="tabnum" style="white-space:nowrap">${esc(fmtTS(x.ts))}</td><td>${x.auto ? '<span class="badge-auto">Automático</span> ' : ''}${esc(x.accion)}</td><td>${x.calId && S.cal.has(x.calId) ? `<a href="#" data-open="${esc(x.calId)}">${esc(x.nombre || '')}</a>` : esc(x.nombre || '')}</td><td>${esc(x.detalle || '')}</td><td>${x.por === 'sistema' ? 'Sistema' : esc(x.por === S.email ? 'Tú' : x.por || 'Administradora')}</td></tr>`).join('')}</tbody></table></div>`;
  return h + '</section>';
}

/* ---------- Configuración ---------- */
function renderCfgTab() {
  const year = S.y;
  const hol = PL.holidaysForYear(year);
  const chipList = (arr, attr, vacio) => arr.length ? arr.map((x) => `<div class="item"><span>${esc(x)}${x === S.email ? ' <span class="muted">(tú)</span>' : ''}</span><button class="btn sm danger" ${attr}="${esc(x)}">Quitar</button></div>`).join('') : `<span class="muted">${vacio}</span>`;
  let h = `<section class="panel"><div class="sec-title"><h2>Cómo compartir la aplicación</h2></div>
    <ol style="margin:0;padding-left:20px;display:flex;flex-direction:column;gap:6px">
      <li><b>Gerentes (consulta):</b> comparte el enlace de la app. Pueden entrar quienes tengan un correo de los dominios autorizados o estén en la lista de lectores (abajo). Ven el calendario y los detalles; no pueden editar ni ver notas internas, historial, propuestas o dashboard: el servidor lo bloquea.</li>
      <li><b>Regionales:</b> regístralos abajo con su correo y regiones. Su enlace de ingreso es <code>${esc(location.href.split('#')[0])}#regional</code>.</li>
      <li>Todas las personas entran con un enlace de acceso que llega a su correo; compartir la dirección de la app no da permisos por sí sola.</li>
    </ol></section>`;
  h += `<section class="panel"><div class="sec-title"><h2>Acceso de Gerentes</h2></div>
    <div class="grid2"><div><h3 style="font-size:18px">Dominios autorizados</h3><p class="muted" style="font-size:13px">Cualquier correo verificado de estos dominios puede consultar el calendario.</p>
      <div class="list">${chipList(S.roles.dominios, 'data-deldom', 'Sin dominios autorizados.')}</div>
      <div class="row" style="margin-top:8px"><div class="field" style="flex:1"><label for="dm-nuevo">Agregar dominio</label><input id="dm-nuevo" placeholder="empresa.com.mx"></div><button class="btn primary" data-act="add-dom" style="align-self:flex-end">Agregar</button></div></div>
    <div><h3 style="font-size:18px">Lectores individuales</h3><p class="muted" style="font-size:13px">Correos de otros dominios con permiso de consulta.</p>
      <div class="list">${chipList(S.roles.lectores, 'data-dellec', 'Sin lectores individuales.')}</div>
      <div class="row" style="margin-top:8px"><div class="field" style="flex:1"><label for="lc-nuevo">Agregar correo</label><input id="lc-nuevo" type="email" placeholder="nombre@correo.com"></div><button class="btn primary" data-act="add-lec" style="align-self:flex-end">Agregar</button></div></div></div></section>`;
  h += `<section class="panel"><div class="sec-title"><h2>Accesos de Regionales</h2></div>
    <div class="fgrid"><div class="field"><label for="rg-email">Correo del Regional</label><input id="rg-email" type="email" placeholder="regional@empresa.com"></div>
    <div class="field wide"><span class="lbl2">Regiones autorizadas</span><div class="checks" id="rg-regs">${PL.REGIONES.map((r) => `<label class="chk"><input type="checkbox" value="${r}">${r}</label>`).join('')}</div></div>
    <div class="field"><button class="btn primary" data-act="reg-add">Habilitar Regional</button></div></div>
    <div class="list" style="margin-top:14px">${S.regs.length ? [...S.regs].sort((a, b) => a.id.localeCompare(b.id)).map((r) => `<div class="item"><div><b>${esc(r.id)}</b><div class="row" style="margin-top:4px">${(r.regiones || []).map((x) => `<span class="tag pub">${esc(x)}</span>`).join('')}${r.activo ? '<span class="st st-Realizada">Activo</span>' : '<span class="st st-Cancelada">Acceso retirado</span>'}</div></div>
      <div class="row"><button class="btn sm" data-regedit="${esc(r.id)}">Cambiar regiones</button>${r.activo ? `<button class="btn sm danger" data-regoff="${esc(r.id)}">Retirar acceso</button>` : `<button class="btn sm ok" data-regon="${esc(r.id)}">Habilitar</button>`}</div></div>`).join('') : '<div class="empty"><b>Sin Regionales registrados</b>Escribe su correo, marca sus regiones y pulsa “Habilitar Regional”.</div>'}</div></section>`;
  // Descansos
  h += `<section class="panel"><div class="sec-title"><h2>Días bloqueados ${year}</h2></div>
    <p class="muted">Días de descanso obligatorio del artículo 74 de la Ley Federal del Trabajo (texto vigente, última reforma DOF 14-05-2026), calculados para cada año. Semana Santa y vacaciones escolares no se bloquean porque no son descansos obligatorios por ley.</p>
    <div class="tablewrap"><table><thead><tr><th>Fecha</th><th>Motivo</th><th>Fundamento</th><th></th></tr></thead><tbody>
    ${hol.map((x) => `<tr><td class="tabnum">${esc(fmtFecha(x.fecha))}</td><td>${esc(x.motivo)}</td><td>Art. 74, fr. ${x.fraccion}</td><td></td></tr>`).join('')}
    ${extras().filter((x) => x.fecha.startsWith(String(year))).map((x) => `<tr><td class="tabnum">${esc(fmtFecha(x.fecha))}</td><td>${esc(x.motivo)}</td><td>Art. 74, fr. IX (configurado)</td><td><button class="btn sm danger" data-deldesc="${esc(x.fecha)}">Quitar</button></td></tr>`).join('')}
    </tbody></table></div>
    <p class="muted" style="font-size:13px">${year >= 2024 && (year - 2024) % 6 === 0 ? 'Este año incluye el 1 de octubre por transmisión del Poder Ejecutivo Federal.' : `El 1 de octubre por transmisión del Poder Ejecutivo Federal aplica en ${2024 + Math.ceil((year - 2024) / 6) * 6}.`} Cambia el año en el calendario para consultar otros años.</p>
    <h3 style="font-size:18px;margin-top:10px">Agregar descanso electoral u otro descanso aplicable</h3>
    <div class="fgrid"><div class="field"><label for="ds-fecha">Fecha</label><input id="ds-fecha" type="date"></div><div class="field"><label for="ds-motivo">Motivo</label><input id="ds-motivo" placeholder="Ej. Jornada electoral local (estado)"></div><div class="field"><button class="btn primary" data-act="add-desc">Bloquear fecha</button></div></div>
    <p class="muted" style="font-size:13px">Las capacitaciones que ya existan en una fecha que bloquees se conservan; aparecen con aviso para que las revises.</p></section>`;
  // Áreas
  h += `<section class="panel"><div class="sec-title"><h2>Catálogo de áreas</h2></div>
    <div class="row">${(S.pub.areas || []).length ? S.pub.areas.map((a) => `<span class="tag area" style="font-size:14px;padding:4px 8px"><i style="background:${areaColor(a)}"></i>${esc(a)} <button class="btn sm" style="padding:0 6px;border:0" data-delarea="${esc(a)}" aria-label="Quitar ${esc(a)}">×</button></span>`).join('') : '<span class="muted">Sin áreas registradas. Agrega las áreas que imparten capacitación.</span>'}</div>
    <div class="row" style="margin-top:10px"><div class="field" style="flex:1"><label for="ar-nombre">Nueva área</label><input id="ar-nombre" placeholder="Ej. Mantenimiento"></div><button class="btn primary" data-act="add-area-cfg" style="align-self:flex-end">Agregar</button></div>
    <p class="muted" style="font-size:13px">Quitar un área del catálogo no modifica las capacitaciones que ya la tienen.</p></section>`;
  h += `<section class="panel"><div class="sec-title"><h2>Cuenta de administradora</h2></div>
    <p class="muted">La administradora se identifica con su correo verificado (enlace de acceso). Para cambiar a una cuenta empresarial, agrega el nuevo correo, entra con él y después quita el anterior.</p>
    <div class="list">${S.roles.admins.map((m) => `<div class="item"><span>${esc(m)}${m === S.email ? ' <span class="muted">(tú)</span>' : ''}</span><button class="btn sm danger" data-deladmin="${esc(m)}" ${S.roles.admins.length === 1 ? 'disabled title="Debe quedar al menos un correo"' : ''}>Quitar</button></div>`).join('')}</div>
    <div class="row" style="margin-top:10px"><div class="field" style="flex:1"><label for="ad-email">Agregar correo de administradora</label><input id="ad-email" type="email" placeholder="nombre@empresa.com"></div><button class="btn primary" data-act="add-admin" style="align-self:flex-end">Agregar</button></div></section>`;
  // Importación
  h += `<section class="panel"><div class="sec-title"><h2>Importar información inicial</h2></div>
    <p class="muted">Sube el calendario actual, la calendarización de Bootcamps o el calendario presencial de Mantenimiento (Excel o CSV). Antes de guardar verás una vista previa: los duplicados se omiten y los registros incompletos, contradictorios o en feriado se marcan para revisión. No se inventan datos.</p>
    <div class="fgrid"><div class="field"><label for="im-file">Archivo</label><input id="im-file" type="file" accept=".xlsx,.xls,.csv"></div>
    <div class="field"><label for="im-fuente">Contenido del archivo</label><select id="im-fuente"><option value="general">Calendario general</option><option value="bootcamp">Calendarización de Bootcamps</option><option value="mant">Calendario presencial de Mantenimiento</option></select></div>
    <div class="field"><label for="im-area">Área para filas sin área (opcional)</label><select id="im-area"><option value="">Dejar vacío</option>${(S.pub.areas || []).map((a) => `<option>${esc(a)}</option>`).join('')}</select></div></div>
    <div id="im-out" style="margin-top:12px"></div></section>`;
  return h;
}
/* ---------- Regionales: alta, regiones, retiro ---------- */
S.imp = null;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
async function regAdd(btn) {
  const email = ($('#rg-email').value || '').trim().toLowerCase();
  const regiones = [...document.querySelectorAll('#rg-regs input:checked')].map((x) => x.value);
  if (!EMAIL_RE.test(email)) return toast('Escribe un correo válido para el Regional.', 'bad');
  if (!regiones.length) return toast('Marca al menos una región autorizada.', 'bad');
  if (S.roles.admins.includes(email)) return toast('Ese correo es de administradora; no se registra como Regional.', 'bad');
  btn.disabled = true;
  try {
    await retry(() => S.db.doc(P.regs + '/' + email).set({ regiones, activo: true, alta: nowISO() }));
    await addHist({ accion: 'Regional habilitado', detalle: `${email} · ${regiones.join(', ')}` });
    toast(`Regional habilitado (${regiones.join(', ')}). Envíale el enlace de ingreso para Regionales.`, 'ok');
    $('#rg-email').value = ''; document.querySelectorAll('#rg-regs input').forEach((x) => (x.checked = false));
  } catch (e) { toast(dbErr(e), 'bad'); } finally { btn.disabled = false; }
}
async function regToggle(id, activo) {
  try { await retry(() => S.db.doc(P.regs + '/' + id).update({ activo })); await addHist({ accion: activo ? 'Regional habilitado' : 'Acceso de Regional retirado', detalle: id }); toast(activo ? 'Acceso habilitado.' : 'Acceso retirado. Sus propuestas anteriores se conservan.', 'ok'); }
  catch (e) { toast(dbErr(e), 'bad'); }
}
function regEdit(id) {
  const r = S.regs.find((x) => x.id === id); if (!r) return;
  openModal(`<div class="modal-h"><h2>Regiones autorizadas</h2><button class="iconbtn" data-act="close" aria-label="Cerrar">×</button></div><div class="modal-b"><p>${esc(id)}</p><div class="checks" id="re-regs">${PL.REGIONES.map((x) => `<label class="chk"><input type="checkbox" value="${x}" ${(r.regiones || []).includes(x) ? 'checked' : ''}>${x}</label>`).join('')}</div></div><div class="modal-f"><button class="btn" data-act="close">Cancelar</button><button class="btn primary" data-regsave="${esc(id)}">Guardar</button></div>`, 'sm');
}
async function regSave(id, btn) {
  const regiones = [...document.querySelectorAll('#re-regs input:checked')].map((x) => x.value);
  if (!regiones.length) return toast('Marca al menos una región, o retira el acceso.', 'bad');
  btn.disabled = true;
  try { await retry(() => S.db.doc(P.regs + '/' + id).update({ regiones })); await addHist({ accion: 'Regiones de Regional', detalle: `${id} · ${regiones.join(', ')}` }); toast('Regiones actualizadas.', 'ok'); closeModal(); }
  catch (e) { toast(dbErr(e), 'bad'); btn.disabled = false; }
}
async function saveRoles(patch, accion, detalle) {
  const next = { ...S.roles, ...patch };
  try { await retry(() => S.db.doc(P.roles).set(next)); S.roles = next; await addHist({ accion, detalle }); render(); return true; }
  catch (e) { toast(dbErr(e), 'bad'); return false; }
}

/* ---------- Exportar ---------- */
function saveFile(filename, data) {
  const blob = data instanceof Blob ? data : new Blob([data]);
  const url = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000); toast('Archivo descargado: ' + filename, 'ok');
}
function exportXLS(scope) {
  if (typeof XLSX === 'undefined') return toast('No se cargó el componente de Excel. Recarga la página.', 'bad');
  const pre = scope === 'year' ? String(S.y) : `${S.y}-${PL.pad(S.m)}`;
  const list = (scope === 'year' ? records() : filtered()).filter((r) => r.fecha && r.fecha.startsWith(pre)).sort((a, b) => (a.fecha + (a.horaInicio || '')).localeCompare(b.fecha + (b.horaInicio || '')));
  const rows = list.map((r) => {
    const o = { Fecha: r.fecha, 'Hora inicio': r.horaInicio || '', 'Hora fin': r.horaFin || '', 'Nombre de la capacitación': r.nombre, Programa: r.programa || '', 'Tema o actividad': r.tema || '', Tipo: r.tipo || '', Modalidad: r.modalidad || '', 'Área que imparte': r.area || '', Facilitador: r.facilitador || '', Público: (r.publicos || []).join(', '), 'Perfil de asistentes': r.perfil || '', 'Club que se aperturará': r.clubApertura || '', 'Clubes participantes': r.clubes || '', Ciudad: r.ciudad || '', Sede: r.sede || '', 'Día o sesión': r.numDia || '', Enlace: r.enlace || '', Estado: r.estado || '', 'Tipo de cierre': r.estado === 'Realizada' ? (r.cierreAuto && r.cierreAuto.mes ? 'Cierre automático' : 'Validación manual') : '' };
    if (isAdmin()) { o['Notas internas'] = S.notas[r.id] || ''; o['Revisión'] = (r.revision || []).join('; '); }
    return o;
  });
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ Aviso: 'Sin capacitaciones registradas en el periodo' }]);
  ws['!cols'] = Object.keys(rows[0] || { Aviso: 1 }).map((k) => ({ wch: Math.min(40, Math.max(10, k.length + 2)) }));
  XLSX.utils.book_append_sheet(wb, ws, 'Programación');
  if (isAdmin() && scope === 'year') {
    const D = PL.dashboard(records(), S.y, S.m, S.today);
    const res = [['Dashboard acumulado', `Enero – ${PL.MESES[S.m - 1]} ${S.y}`], ['Fecha de corte', D.corte], ['Sesiones registradas', D.registradas], ['Realizadas', D.realizadas], ['   Validación manual', D.realizadasManual], ['   Cierre automático', D.realizadasAuto], ['Pendientes o programadas', D.pendientes], ['Canceladas', D.canceladas], ['Presenciales', D.presenciales], ['Online', D.online], ['Bootcamps', D.bootcamps], ['Actividades de Bootcamp', D.actividadesBootcamp], ['Horas realizadas', D.realizadas ? D.horasRealizadas : 'Sin información'], ['% de ejecución', D.ejecucion == null ? 'Sin información' : D.ejecucion / 100], ['Cálculo % ejecución', 'Realizadas ÷ sesiones no canceladas con fecha hasta el corte']];
    const ws2 = XLSX.utils.aoa_to_sheet(res); ws2['!cols'] = [{ wch: 30 }, { wch: 50 }];
    XLSX.utils.book_append_sheet(wb, ws2, 'Resumen');
  }
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  saveFile(`Programacion_capacitacion_${pre}.xlsx`, out);
}
function exportPDF() {
  if (!isAdmin()) return;
  const J = window.jspdf && window.jspdf.jsPDF; if (!J) return toast('No se cargó el componente de PDF. Recarga la página.', 'bad');
  const D = PL.dashboard(records(), S.y, S.m, S.today);
  const doc = new J({ orientation: 'landscape', unit: 'pt', format: 'letter' });
  const P = [91, 42, 134];
  doc.setFillColor(...P); doc.rect(0, 0, 792, 64, 'F'); doc.setFillColor(255, 199, 38); doc.rect(0, 64, 792, 5, 'F');
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(20);
  doc.text('Planet · Dashboard de capacitación', 36, 34); doc.setFontSize(11); doc.setFont('helvetica', 'normal');
  doc.text(`Acumulado enero – ${PL.MESES[S.m - 1].toLowerCase()} ${S.y} · Fecha de corte ${D.corte} · Generado ${fmtTS(nowISO())}`, 36, 52);
  doc.setTextColor(29, 20, 48);
  const kp = [['Sesiones registradas', D.registradas], ['Realizadas', `${D.realizadas} (${D.realizadasManual} manual, ${D.realizadasAuto} cierre automático)`], ['Pendientes o programadas', `${D.pendientes} (${D.pendientesFuturas} futuras, ${D.pendientesVencidas} vencidas sin validar)`], ['Canceladas', D.canceladas], ['Presenciales / Online', `${D.presenciales} / ${D.online}`], ['Bootcamps / actividades', `${D.bootcamps} / ${D.actividadesBootcamp}`], ['Horas realizadas', D.realizadas ? `${D.horasRealizadas}${D.realizadasSinHorario ? ` (${D.realizadasSinHorario} sin horario válido)` : ''}` : 'Sin información'], ['% de ejecución', D.ejecucion == null ? 'Sin información' : `${D.ejecucion}% = realizadas ÷ ${D.baseEjecucion} sesiones no canceladas con fecha hasta el corte`]];
  doc.autoTable({ startY: 84, head: [['Indicador', 'Valor']], body: kp, theme: 'grid', headStyles: { fillColor: P }, styles: { fontSize: 10 }, columnStyles: { 0: { cellWidth: 200, fontStyle: 'bold' } }, margin: { left: 36, right: 36 } });
  const ar = Object.entries(D.porArea).map(([k, v]) => [k, v.sesiones, v.realizadas]);
  const pu = Object.entries(D.porPublico).map(([k, v]) => [k, v.sesiones, v.realizadas]);
  let y = doc.lastAutoTable.finalY + 16;
  doc.autoTable({ startY: y, head: [['Área', 'Sesiones', 'Realizadas']], body: ar.length ? ar : [['Sin información', 0, 0]], theme: 'striped', headStyles: { fillColor: P }, styles: { fontSize: 9 }, margin: { left: 36, right: 410 } });
  doc.autoTable({ startY: y, head: [['Público', 'Sesiones', 'Realizadas']], body: pu.length ? pu : [['Sin información', 0, 0]], theme: 'striped', headStyles: { fillColor: P }, styles: { fontSize: 9 }, margin: { left: 410, right: 36 } });
  y = Math.max(doc.lastAutoTable.finalY, y) + 8; doc.setFontSize(8); doc.text('Una sesión con varios públicos cuenta una vez en el total general y aparece en cada público convocado. Sin canceladas.', 36, y + 6);
  doc.autoTable({ startY: y + 16, head: [['Mes', 'Realizadas', 'Pendientes/programadas', 'Canceladas']], body: D.evol.map((e) => [PL.MESES[e.mes - 1], e.realizadas, e.pendientes, e.canceladas]), theme: 'striped', headStyles: { fillColor: P }, styles: { fontSize: 9 }, margin: { left: 36, right: 36 } });
  doc.addPage();
  doc.setFontSize(14); doc.setFont('helvetica', 'bold'); doc.text('Detalle de capacitaciones del acumulado', 36, 40);
  doc.autoTable({ startY: 52, head: [['Fecha', 'Horario', 'Capacitación', 'Tipo', 'Modalidad', 'Área', 'Público', 'Club apertura', 'Estado']], body: D.detalle.map((r) => [r.fecha, r.horaInicio ? horario(r) : 'Sin información', r.nombre, r.tipo || 'Sin información', r.modalidad || 'Sin información', r.area || 'Sin información', (r.publicos || []).join(', ') || 'Sin información', r.tipo === 'Bootcamp' ? r.clubApertura || 'Sin información' : '', r.estado + (r.cierreAuto && r.cierreAuto.mes ? ' (cierre automático)' : r.estado === 'Realizada' ? ' (manual)' : '')]), theme: 'grid', headStyles: { fillColor: P }, styles: { fontSize: 8 }, margin: { left: 36, right: 36 } });
  if (!D.detalle.length) doc.text('Sin capacitaciones registradas en el periodo.', 36, 80);
  saveFile(`Dashboard_capacitacion_${S.y}-${PL.pad(S.m)}.pdf`, doc.output('arraybuffer'));
}

/* ---------- Importar ---------- */
async function readImport(file) {
  const out = $('#im-out');
  if (typeof XLSX === 'undefined') { out.innerHTML = '<div class="alert bad">No se cargó el lector de Excel. Recarga la página.</div>'; return; }
  out.innerHTML = '<div class="loading"><div class="spin"></div>Leyendo archivo…</div>';
  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array', cellDates: false });
    const fuente = $('#im-fuente').value; const areaDef = $('#im-area').value;
    let nuevos = [], duplicados = [], hojas = [];
    for (const name of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' });
      let res = null;
      for (let off = 0; off < Math.min(12, rows.length); off++) { const r = PL.importRows(rows.slice(off), [...records(), ...nuevos], extras(), fuente); if (!r.sinEncabezados) { res = r; break; } }
      if (!res) { hojas.push(`${name}: no se encontró una fila de encabezados reconocible (se necesita al menos “Nombre” o “Tema”)`); continue; }
      res.nuevos.forEach((r) => { r.hoja = name; if (!r.area && areaDef) { r.area = areaDef; r.revision = r.revision.filter((x) => x !== 'Área sin especificar'); } if (fuente === 'mant' && !r.tipo) { r.revision.push('Tipo sin especificar en el archivo de Mantenimiento'); } });
      nuevos = nuevos.concat(res.nuevos); duplicados = duplicados.concat(res.duplicados.map((d) => ({ ...d, hoja: name })));
    }
    S.imp = { nuevos, duplicados, hojas, archivo: file.name };
    paintImport();
  } catch (e) { out.innerHTML = `<div class="alert bad">No se pudo leer el archivo: ${esc(e.message || e)}</div>`; }
}
function paintImport() {
  const out = $('#im-out'); if (!out || !S.imp) return;
  const { nuevos, duplicados, hojas, archivo } = S.imp;
  const rev = nuevos.filter((r) => r.revision.length).length;
  out.innerHTML = `<div class="alert info"><b>${esc(archivo)}</b>: ${nuevos.length} registro(s) por importar · ${rev} marcados para revisión · ${duplicados.length} duplicado(s) omitido(s).</div>
    ${hojas.map((x) => `<div class="alert warn">${esc(x)}</div>`).join('')}
    ${nuevos.length ? `<div class="tablewrap" style="max-height:360px;overflow:auto;margin-top:8px"><table><thead><tr><th>Hoja/fila</th><th>Fecha</th><th>Capacitación</th><th>Tipo</th><th>Público</th><th>Club apertura</th><th>Revisión</th></tr></thead><tbody>${nuevos.slice(0, 300).map((r) => `<tr><td class="tabnum">${esc(r.hoja)} · ${r.fila}</td><td class="tabnum">${esc(r.fecha || 'Sin fecha')}</td><td>${esc(r.nombre)}</td><td>${esc(r.tipo || '—')}</td><td>${esc(r.publicos.join(', ') || '—')}</td><td>${esc(r.clubApertura || '—')}</td><td>${r.revision.length ? `<span class="rev">${esc(r.revision.join(' · '))}</span>` : 'OK'}</td></tr>`).join('')}</tbody></table></div>` : ''}
    ${duplicados.length ? `<details style="margin-top:8px"><summary>Ver duplicados omitidos</summary><ul>${duplicados.map((d) => `<li>${esc(d.hoja)} fila ${d.fila}: ${esc(d.nombre)} (${esc(d.fecha || 'sin fecha')})</li>`).join('')}</ul></details>` : ''}
    <div class="row" style="margin-top:10px">${nuevos.length ? `<button class="btn primary" id="btnImp" data-act="do-import">Importar ${nuevos.length} registro(s)</button>` : ''}<button class="btn" data-act="cancel-import">Descartar</button></div>`;
}
async function doImport(btn) {
  if (!S.imp || !isAdmin()) return; btn.disabled = true;
  const { nuevos, archivo } = S.imp; let ok = 0;
  for (const r of nuevos) {
    const id = uidGen('i'); const { _notas, hoja, fila, ...rec } = r;
    rec.creado = nowISO(); rec.actualizado = nowISO(); rec.cierreAuto = null; rec.importacion = { archivo, hoja, fila };
    try { await retry(() => S.db.doc(P.cal + '/' + id).set(rec)); if (_notas) await retry(() => S.db.doc(P.notas + '/' + id).set({ texto: _notas })); ok++; btn.textContent = `Importando ${ok}/${nuevos.length}…`; }
    catch (e) { toast(`Se detuvo en ${ok} de ${nuevos.length}: ${dbErr(e)}`, 'bad'); break; }
  }
  await addHist({ accion: 'Importación', detalle: `${archivo}: ${ok} registro(s) importados, ${nuevos.filter((r) => r.revision.length).length} para revisión, ${S.imp.duplicados.length} duplicados omitidos` });
  toast(`Importación terminada: ${ok} registro(s). Revisa los marcados con “Revisar”.`, 'ok');
  S.imp = null; render();
  // Los meses ya cerrados se cierran también para lo importado
  S.closureDone = false;
}

/* ---------- Eventos ---------- */
document.addEventListener('click', async (e) => {
  const t = e.target.closest('button,a,[data-open]'); if (!t) return;
  const d = t.dataset;
  if (t.tagName === 'A' && d.open) e.preventDefault();
  if (d.tab) { S.tab = d.tab; render(); window.scrollTo(0, 0); return; }
  if (d.view) { S.view = d.view; lsSet('view', S.view); render(); return; }
  if (d.open) return showDetail(d.open);
  if (d.edit) return openForm('edit', d.edit);
  if (d.dup) return openForm('dup', d.dup);
  if (d.newdate) { const h = PL.holidayInfo(d.newdate, extras()); if (h) return toast(`No se puede programar el ${fmtFecha(d.newdate, true)}: ${h.motivo} es día de descanso obligatorio (${h.fuente}).`, 'bad'); return openForm('new', null, d.newdate); }
  if (d.day) { S.view = 'agenda'; render(); return; }
  if (d.selday) { S.selDay = d.selday; render(); return; }
  if (d.setstatus) return setStatus(d.id, d.setstatus, t);
  if (d.propfilter) { S.propFilter = d.propfilter; render(); return; }
  if (d.histfilter) { S.histFilter = d.histfilter; render(); return; }
  if (d.confirm) return confirmProp(d.confirm, t);
  if (d.reject) return askReject(d.reject);
  if (d.dorej) return doReject(d.dorej, t);
  if (d.deladmin) { if (S.roles.admins.length < 2) return; if (await saveRoles({ admins: S.roles.admins.filter((x) => x !== d.deladmin) }, 'Correo de administradora quitado', d.deladmin)) toast('Correo quitado.', 'ok'); return; }
  if (d.deldom) { await saveRoles({ dominios: S.roles.dominios.filter((x) => x !== d.deldom) }, 'Dominio de Gerentes quitado', d.deldom); return; }
  if (d.dellec) { await saveRoles({ lectores: S.roles.lectores.filter((x) => x !== d.dellec) }, 'Lector quitado', d.dellec); return; }
  if (d.regoff) return regToggle(d.regoff, false);
  if (d.regon) return regToggle(d.regon, true);
  if (d.regedit) return regEdit(d.regedit);
  if (d.regsave) return regSave(d.regsave, t);
  if (d.deldesc) { try { await savePub({ descansos: extras().filter((x) => x.fecha !== d.deldesc) }); await addHist({ accion: 'Descanso adicional quitado', detalle: d.deldesc }); toast('Fecha desbloqueada.', 'ok'); } catch (er) { toast(dbErr(er), 'bad'); } return; }
  if (d.delarea) { try { await savePub({ areas: (S.pub.areas || []).filter((x) => x !== d.delarea) }); await addHist({ accion: 'Catálogo de áreas', detalle: `Baja: ${d.delarea}` }); } catch (er) { toast(dbErr(er), 'bad'); } return; }
  switch (d.act) {
    case 'close': closeModal(); FORM = null; break;
    case 'prev': S.m--; if (S.m < 1) { S.m = 12; S.y--; } render(); break;
    case 'next': S.m++; if (S.m > 12) { S.m = 1; S.y++; } render(); break;
    case 'hoy': { const [y, m] = S.today.split('-').map(Number); S.y = y; S.m = m; S.selDay = S.today; render(); break; }
    case 'new': openForm('new'); break;
    case 'save': saveForm(); break;
    case 'add-area': addAreaInline(); break;
    case 'save-area': saveAreaInline(); break;
    case 'clear-filters': S.filters = {}; lsSet('filters', {}); render(); break;
    case 'preview-on': S.preview = true; S.tab = 'cal'; render(); break;
    case 'preview-off': S.preview = false; render(); break;
    case 'xls-year': exportXLS('year'); break;
    case 'xls-month': exportXLS('month'); break;
    case 'pdf': exportPDF(); break;
    case 'add-desc': {
      const f = $('#ds-fecha').value, mo = $('#ds-motivo').value.trim();
      if (!PL.isDate(f) || !mo) return toast('Indica la fecha y el motivo del descanso.', 'bad');
      if (PL.holidayInfo(f, extras())) return toast('Esa fecha ya está bloqueada.', 'bad');
      try { await savePub({ descansos: [...extras(), { fecha: f, motivo: mo }].sort((a, b) => a.fecha.localeCompare(b.fecha)) }); await addHist({ accion: 'Descanso adicional', detalle: `${f} · ${mo}` }); const n = records().filter((r) => r.fecha === f).length; toast(`Fecha bloqueada.${n ? ` Hay ${n} capacitación(es) ese día: se conservan y aparecen con aviso.` : ''}`, 'ok'); } catch (er) { toast(dbErr(er), 'bad'); }
      break;
    }
    case 'add-area-cfg': { const v = $('#ar-nombre').value.trim(); if (!v) return; try { await savePub({ areas: [...new Set([...(S.pub.areas || []), v])].sort() }); await addHist({ accion: 'Catálogo de áreas', detalle: `Alta: ${v}` }); toast(`Área “${v}” agregada.`, 'ok'); } catch (er) { toast(dbErr(er), 'bad'); } break; }
    case 'add-admin': { const v = $('#ad-email').value.trim().toLowerCase(); if (!EMAIL_RE.test(v)) return toast('Escribe un correo válido.', 'bad'); if (await saveRoles({ admins: [...new Set([...S.roles.admins, v])] }, 'Correo de administradora agregado', v)) toast('Correo agregado. Esa cuenta ya puede entrar como administradora.', 'ok'); break; }
    case 'add-dom': { const v = $('#dm-nuevo').value.trim().toLowerCase().replace(/^@/, ''); if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(v)) return toast('Escribe un dominio válido, por ejemplo empresa.com.mx', 'bad'); if (await saveRoles({ dominios: [...new Set([...S.roles.dominios, v])] }, 'Dominio de Gerentes agregado', v)) toast('Dominio autorizado.', 'ok'); break; }
    case 'add-lec': { const v = $('#lc-nuevo').value.trim().toLowerCase(); if (!EMAIL_RE.test(v)) return toast('Escribe un correo válido.', 'bad'); if (await saveRoles({ lectores: [...new Set([...S.roles.lectores, v])] }, 'Lector agregado', v)) toast('Lector agregado.', 'ok'); break; }
    case 'reg-add': regAdd(t); break;
    case 'logout': S.auth.signOut(); break;
    case 'retry': location.reload(); break;
    case 'google': S.auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()).catch((er) => renderLogin('No se pudo ingresar con Google: ' + er.message, 'bad')); break;
    case 'do-import': doImport(t); break;
    case 'cancel-import': S.imp = null; render(); break;
  }
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.filter && t.tagName === 'SELECT') { S.filters[t.dataset.filter] = t.value; lsSet('filters', S.filters); render(); }
  if (t.id === 'selMes') { S.m = +t.value; render(); }
  if (t.id === 'selAnio') { const v = +t.value; if (v >= 2000 && v <= 2100) { S.y = v; render(); } }
  if (t.id === 'bcAll') { S.bcAll = t.checked; render(); }
  if (t.id === 'im-file' && t.files[0]) readImport(t.files[0]);
});
let qTimer;
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset.filter && t.tagName === 'INPUT') { clearTimeout(qTimer); qTimer = setTimeout(() => { S.filters[t.dataset.filter] = t.value; lsSet('filters', S.filters); render(); }, 250); }
});

document.addEventListener('submit', (e) => {
  e.preventDefault();
  if (e.target.id === 'pform') sendProposal();
  if (e.target.id === 'tform') saveForm();
  if (e.target.id === 'loginForm') { const v = $('#lg-email').value.trim().toLowerCase(); if (!EMAIL_RE.test(v)) return toast('Escribe un correo válido.', 'bad'); sendLink(v); }
});

boot();
