// ─── APP PRINCIPAL ───────────────────────────────────────────────────────────

let dashData    = null;
let selectedPrestamo = null;

// ─── INIT ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(console.error);
  }

  const user = await initGoogleAuth();
  if (user && getAccessToken()) {
    showApp(user);
  } else {
    showLogin();
  }

  window.addEventListener('auth:login', e => showApp(e.detail));
  window.addEventListener('auth:logout', showLogin);
});

// ─── LOGIN / APP ──────────────────────────────────────────────────────────────
function showLogin() {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app').classList.remove('visible');
}

async function showApp(user) {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').classList.add('visible');

  // Mostrar info usuario
  const avatar = document.getElementById('user-avatar');
  const uname  = document.getElementById('user-name');
  if (avatar && user.picture) avatar.src = user.picture;
  if (uname  && user.name)    uname.textContent = user.name.split(' ')[0];

  setLoading(true, 'Conectando con Google Sheets...');
  const ok = await initSheets();
  setLoading(false);

  if (!ok && !SPREADSHEET_ID.includes('TU_SPREADSHEET_ID')) {
    toast('Error conectando con Sheets. Revisá la configuración.', 'error');
  }

  navigateTo('dashboard');
}

// ─── NAVEGACIÓN ───────────────────────────────────────────────────────────────
function navigateTo(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));

  document.getElementById(`view-${view}`)?.classList.add('active');
  document.querySelector(`[data-view="${view}"]`)?.classList.add('active');

  if (view === 'dashboard') loadDashboard();
  if (view === 'clientes')  loadClientes();
  if (view === 'nuevo')     resetForm();
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
async function loadDashboard() {
  if (SPREADSHEET_ID.includes('TU_SPREADSHEET_ID')) {
    renderDashboardDemo();
    return;
  }
  setLoading(true, 'Cargando datos...');
  try {
    dashData = await getDashboardData();
    renderDashboard(dashData);
  } catch(e) {
    toast('Error cargando datos: ' + e.message, 'error');
  }
  setLoading(false);
  updateSyncTime();
}

function renderDashboardDemo() {
  const demo = {
    totalClientes: 0, prestamosActivos: 0, prestamosMorosos: 0,
    capitalEnCalle: 0, gananciaRealizada: 0, gananciaEsperada: 0,
    montoPendiente: 0, prestamos: [], morosos: []
  };
  renderDashboard(demo);
  toast('⚙️ Configurá el Spreadsheet ID para sincronizar datos', 'info');
}

function renderDashboard(data) {
  const fmt = n => '$' + parseFloat(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 0 });

  document.getElementById('stat-clientes').textContent   = data.totalClientes;
  document.getElementById('stat-activos').textContent    = data.prestamosActivos;
  document.getElementById('stat-morosos').textContent    = data.prestamosMorosos;
  document.getElementById('stat-capital').textContent    = fmt(data.capitalEnCalle);
  document.getElementById('stat-ganancia-real').textContent  = fmt(data.gananciaRealizada);
  document.getElementById('stat-ganancia-esp').textContent   = fmt(data.gananciaEsperada);
  document.getElementById('stat-pendiente').textContent  = fmt(data.montoPendiente);

  // Morosos
  const morososEl = document.getElementById('morosos-list');
  if (data.morosos?.length) {
    morososEl.innerHTML = data.morosos.map(p => prestamoItemHTML(p, 'moroso')).join('');
  } else {
    morososEl.innerHTML = `<div class="empty-state"><div class="empty-state-icon">✅</div><p>Sin morosos</p></div>`;
  }

  // Activos recientes
  const activosEl = document.getElementById('activos-list');
  const activos = (data.prestamos || []).filter(p => p.Estado === 'activo').slice(0, 8);
  if (activos.length) {
    activosEl.innerHTML = activos.map(p => prestamoItemHTML(p, 'activo')).join('');
  } else {
    activosEl.innerHTML = `<div class="empty-state"><div class="empty-state-icon">💰</div><p>Sin préstamos activos</p></div>`;
  }
}

function prestamoItemHTML(p, estado) {
  const fmt = n => '$' + parseFloat(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 0 });
  const badgeClass = { activo: 'badge-activo', moroso: 'badge-moroso', cancelado: 'badge-cancelado' }[estado] || 'badge-activo';
  const label = { activo: 'Activo', moroso: 'Moroso', cancelado: 'Cancelado' }[estado] || estado;

  return `
    <div class="prestamo-item" onclick="verDetalle('${p.ID}')">
      <div>
        <div class="prestamo-nombre">${p.ClienteNombre}</div>
        <div class="prestamo-meta">${p.CantCuotas} cuotas · ${fmt(p.MontoCuota)}/mes</div>
        <span class="badge ${badgeClass}">${label}</span>
      </div>
      <div class="prestamo-monto">
        <div class="prestamo-deuda">${fmt(p.MontoTotalConInteres)}</div>
        <div class="prestamo-meta" style="font-size:0.7rem">Ganancia: ${fmt(p.GananciaTotalEsperada)}</div>
      </div>
    </div>`;
}

// ─── DETALLE PRÉSTAMO ─────────────────────────────────────────────────────────
async function verDetalle(prestamoId) {
  if (!dashData) return;
  const prestamo = dashData.prestamos.find(p => p.ID === prestamoId);
  if (!prestamo) return;
  selectedPrestamo = prestamo;

  const cuotas = dashData.cuotas.filter(c => c.PrestamoID === prestamoId);
  const fmt = n => '$' + parseFloat(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 });

  const hoy = new Date();

  const cuotasHTML = cuotas.map(c => {
    const partes = c.FechaVencimiento.split('/');
    const fecha  = new Date(`${partes[2]}-${partes[1]}-${partes[0]}`);
    let estadoClass = 'cuota-pendiente';
    let estadoLabel = 'Pendiente';
    let accion = '';

    if (c.Estado === 'pagada') {
      estadoClass = 'cuota-pagada';
      estadoLabel = `Pagada ${c.FechaPago}`;
    } else if (fecha < hoy) {
      estadoClass = 'cuota-vencida';
      estadoLabel = '⚠️ Vencida';
      accion = `<button class="btn-pagar" onclick="registrarPago('${c.ID}')">Cobrar</button>`;
    } else {
      accion = `<button class="btn-pagar" onclick="registrarPago('${c.ID}')">Cobrar</button>`;
    }

    return `<tr>
      <td>${c.NroCuota}</td>
      <td>${c.FechaVencimiento}</td>
      <td>${fmt(c.MontoTotal)}</td>
      <td class="${estadoClass}">${estadoLabel}</td>
      <td>${accion}</td>
    </tr>`;
  }).join('');

  document.getElementById('detail-nombre').textContent = prestamo.ClienteNombre;
  document.getElementById('detail-estado').innerHTML   = `<span class="badge badge-${prestamo.Estado}">${prestamo.Estado}</span>`;
  document.getElementById('detail-info').innerHTML = `
    <div class="ganancia-preview">
      <div class="ganancia-row"><span>Monto prestado</span><span>${fmt(prestamo.MontoPrestado)}</span></div>
      <div class="ganancia-row"><span>Tasa por cuota</span><span>${prestamo.TasaInteres}%</span></div>
      <div class="ganancia-row"><span>Cuotas</span><span>${prestamo.CantCuotas}</span></div>
      <div class="ganancia-row"><span>Valor cuota</span><span>${fmt(prestamo.MontoCuota)}</span></div>
      <div class="ganancia-row"><span>Ganancia esperada</span><span style="color:var(--success)">${fmt(prestamo.GananciaTotalEsperada)}</span></div>
      <div class="ganancia-row total"><span>TOTAL A COBRAR</span><span>${fmt(prestamo.MontoTotalConInteres)}</span></div>
    </div>`;

  document.getElementById('detail-cuotas').innerHTML = `
    <table class="cuotas-table">
      <thead><tr><th>#</th><th>Vencimiento</th><th>Monto</th><th>Estado</th><th></th></tr></thead>
      <tbody>${cuotasHTML}</tbody>
    </table>`;

  document.getElementById('detail-overlay').classList.add('open');
}

function closeDetail() {
  document.getElementById('detail-overlay').classList.remove('open');
}

async function registrarPago(cuotaId) {
  if (!confirm('¿Confirmar pago de esta cuota?')) return;
  setLoading(true, 'Registrando pago...');
  try {
    await pagarCuota(cuotaId);
    toast('Pago registrado ✓', 'success');
    closeDetail();
    await loadDashboard();
  } catch(e) {
    toast('Error: ' + e.message, 'error');
  }
  setLoading(false);
}

// ─── CLIENTES ─────────────────────────────────────────────────────────────────
async function loadClientes() {
  if (SPREADSHEET_ID.includes('TU_SPREADSHEET_ID')) {
    document.getElementById('clientes-list').innerHTML =
      `<div class="empty-state"><div class="empty-state-icon">⚙️</div><p>Configurá el Spreadsheet ID primero</p></div>`;
    return;
  }
  setLoading(true, 'Cargando clientes...');
  try {
    const clientes  = await getClientes();
    const prestamos = await getPrestamos();
    const el = document.getElementById('clientes-list');

    if (!clientes.length) {
      el.innerHTML = `<div class="empty-state"><div class="empty-state-icon">👥</div><p>Sin clientes aún. Agregá el primero.</p></div>`;
    } else {
      el.innerHTML = clientes.map(c => {
        const cprestamos = prestamos.filter(p => p.ClienteID === c.ID);
        const activos    = cprestamos.filter(p => p.Estado === 'activo').length;
        return `
          <div class="prestamo-item">
            <div>
              <div class="prestamo-nombre">${c.Nombre}</div>
              <div class="prestamo-meta">DNI: ${c.DNI} · Tel: ${c.Telefono}</div>
              <div class="prestamo-meta">Alta: ${c.FechaAlta}</div>
            </div>
            <div class="prestamo-monto">
              <div style="font-size:0.82rem;color:var(--text-secondary)">Préstamos</div>
              <div style="font-family:var(--font-data);font-size:1.1rem">${cprestamos.length}</div>
              <div style="font-size:0.72rem;color:var(--accent)">${activos} activos</div>
            </div>
          </div>`;
      }).join('');
    }
  } catch(e) {
    toast('Error cargando clientes: ' + e.message, 'error');
  }
  setLoading(false);
}

// ─── NUEVO PRÉSTAMO ────────────────────────────────────────────────────────────
let clientesCache = [];

async function loadClientesSelect() {
  if (SPREADSHEET_ID.includes('TU_SPREADSHEET_ID')) return;
  try {
    clientesCache = await getClientes();
    const sel = document.getElementById('select-cliente');
    if (!clientesCache.length) {
      sel.innerHTML = '<option value="">Primero agregá un cliente</option>';
      return;
    }
    sel.innerHTML = '<option value="">Seleccioná un cliente...</option>' +
      clientesCache.map(c =>
        `<option value="${c.ID}" data-nombre="${c.Nombre}">${c.Nombre} (DNI: ${c.DNI})</option>`
      ).join('');
  } catch(e) { console.error(e); }
}

function resetForm() {
  document.getElementById('form-prestamo').reset();
  document.getElementById('ganancia-preview').style.display = 'none';
  loadClientesSelect();
}

function calcularGanancia() {
  const monto  = parseFloat(document.getElementById('inp-monto').value) || 0;
  const tasa   = parseFloat(document.getElementById('inp-tasa').value)  || 0;
  const cuotas = parseInt(document.getElementById('inp-cuotas').value)  || 0;
  const fmt    = n => '$' + n.toLocaleString('es-AR', { minimumFractionDigits: 2 });

  if (!monto || !tasa || !cuotas) {
    document.getElementById('ganancia-preview').style.display = 'none';
    return;
  }

  const interesTotal    = monto * (tasa / 100) * cuotas;
  const totalConInteres = monto + interesTotal;
  const montoCuota      = totalConInteres / cuotas;
  const gananciaTotal   = interesTotal;
  const gananciaCuota   = monto * tasa / 100;

  document.getElementById('prev-capital').textContent    = fmt(monto);
  document.getElementById('prev-interes-cuota').textContent = fmt(gananciaCuota);
  document.getElementById('prev-cuota').textContent      = fmt(montoCuota);
  document.getElementById('prev-ganancia-total').textContent = fmt(gananciaTotal);
  document.getElementById('prev-total').textContent      = fmt(totalConInteres);
  document.getElementById('ganancia-preview').style.display = 'block';
}

// Tab para agregar cliente nuevo
let nuevoClienteMode = false;
function toggleNuevoCliente() {
  nuevoClienteMode = !nuevoClienteMode;
  document.getElementById('seccion-cliente-existente').style.display = nuevoClienteMode ? 'none' : 'block';
  document.getElementById('seccion-cliente-nuevo').style.display     = nuevoClienteMode ? 'block' : 'none';
  document.getElementById('btn-toggle-cliente').textContent =
    nuevoClienteMode ? '← Usar cliente existente' : '+ Crear cliente nuevo';
}

async function submitPrestamo() {
  if (SPREADSHEET_ID.includes('TU_SPREADSHEET_ID')) {
    toast('Configurá el Spreadsheet ID primero', 'error');
    return;
  }

  const monto   = parseFloat(document.getElementById('inp-monto').value);
  const tasa    = parseFloat(document.getElementById('inp-tasa').value);
  const cuotas  = parseInt(document.getElementById('inp-cuotas').value);
  const fecha   = document.getElementById('inp-fecha').value;
  const obs     = document.getElementById('inp-obs').value;

  if (!monto || !tasa || !cuotas || !fecha) {
    toast('Completá todos los campos obligatorios', 'error');
    return;
  }

  let clienteId = '', clienteNombre = '';

  if (nuevoClienteMode) {
    const nombre   = document.getElementById('inp-nombre').value.trim();
    const dni      = document.getElementById('inp-dni').value.trim();
    const telefono = document.getElementById('inp-tel').value.trim();
    const dir      = document.getElementById('inp-dir').value.trim();
    if (!nombre || !dni) { toast('Nombre y DNI son obligatorios', 'error'); return; }
    setLoading(true, 'Guardando cliente...');
    try {
      const nuevo = await guardarCliente({ nombre, dni, telefono, direccion: dir });
      clienteId     = nuevo.ID;
      clienteNombre = nombre;
    } catch(e) { toast('Error guardando cliente: ' + e.message, 'error'); setLoading(false); return; }
  } else {
    const sel = document.getElementById('select-cliente');
    clienteId = sel.value;
    clienteNombre = sel.options[sel.selectedIndex]?.dataset.nombre || '';
    if (!clienteId) { toast('Seleccioná un cliente', 'error'); return; }
  }

  setLoading(true, 'Guardando préstamo y cuotas...');
  try {
    await guardarPrestamo({ clienteId, clienteNombre, monto, tasa, cuotas, fechaInicio: fecha, observaciones: obs });
    toast('Préstamo guardado en Google Sheets ✓', 'success');
    navigateTo('dashboard');
  } catch(e) {
    toast('Error: ' + e.message, 'error');
  }
  setLoading(false);
}

// ─── UTILIDADES ───────────────────────────────────────────────────────────────
function setLoading(show, msg = 'Cargando...') {
  const el = document.getElementById('loading-overlay');
  if (show) {
    el.querySelector('span').textContent = msg;
    el.classList.add('show');
  } else {
    el.classList.remove('show');
  }
}

function toast(msg, type = 'info') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className   = `toast ${type} show`;
  setTimeout(() => el.classList.remove('show'), 3000);
}

function updateSyncTime() {
  const el = document.getElementById('sync-time');
  if (el) el.textContent = new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}
