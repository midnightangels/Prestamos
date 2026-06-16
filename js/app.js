// ─── APP PRINCIPAL ────────────────────────────────────────────────────────────

let dashData         = null;
let clientesCache    = [];
let clientesFullData = []; // clientes + prestamos + cuotas cargados
let selectedPrestamo = null;

// ─── INIT ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(console.error);
  }
  const user = await initGoogleAuth();
  if (user && getAccessToken()) showApp(user);
  else showLogin();

  window.addEventListener('auth:login', e => showApp(e.detail));
  window.addEventListener('auth:logout', showLogin);
});

function showLogin() {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app').classList.remove('visible');
}

async function showApp(user) {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').classList.add('visible');
  const avatar = document.getElementById('user-avatar');
  const uname  = document.getElementById('user-name');
  if (avatar && user.picture) avatar.src = user.picture;
  if (uname  && user.name)    uname.textContent = user.name.split(' ')[0];

  setLoading(true, 'Conectando con Google Sheets...');
  const ok = await initSheets();
  setLoading(false);
  if (!ok && !SPREADSHEET_ID.includes('TU_SPREADSHEET_ID'))
    toast('Error conectando con Sheets. Revisá la configuración.', 'error');

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
    renderDashboard({ totalClientes:0, prestamosActivos:0, prestamosMorosos:0, capitalEnCalle:0, gananciaRealizada:0, gananciaEsperada:0, montoPendiente:0, prestamos:[], morosos:[] });
    toast('⚙️ Configurá el Spreadsheet ID para sincronizar datos', 'info');
    return;
  }
  setLoading(true, 'Cargando datos...');
  try {
    dashData = await getDashboardData();
    renderDashboard(dashData);
  } catch(e) { toast('Error cargando datos: ' + e.message, 'error'); }
  setLoading(false);
  updateSyncTime();
}

function renderDashboard(data) {
  const fmt = n => '$' + parseFloat(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 0 });
  document.getElementById('stat-clientes').textContent       = data.totalClientes;
  document.getElementById('stat-activos').textContent        = data.prestamosActivos;
  document.getElementById('stat-morosos').textContent        = data.prestamosMorosos;
  document.getElementById('stat-capital').textContent        = fmt(data.capitalEnCalle);
  document.getElementById('stat-ganancia-real').textContent  = fmt(data.gananciaRealizada);
  document.getElementById('stat-ganancia-esp').textContent   = fmt(data.gananciaEsperada);
  document.getElementById('stat-pendiente').textContent      = fmt(data.montoPendiente);

  const morososEl = document.getElementById('morosos-list');
  morososEl.innerHTML = data.morosos?.length
    ? data.morosos.map(p => prestamoItemHTML(p, 'moroso')).join('')
    : `<div class="empty-state"><div class="empty-state-icon">✅</div><p>Sin morosos</p></div>`;

  const activosEl = document.getElementById('activos-list');
  const activos   = (data.prestamos || []).filter(p => p.Estado === 'activo').slice(0, 8);
  activosEl.innerHTML = activos.length
    ? activos.map(p => prestamoItemHTML(p, 'activo')).join('')
    : `<div class="empty-state"><div class="empty-state-icon">💰</div><p>Sin préstamos activos</p></div>`;
}

function prestamoItemHTML(p, estado) {
  const fmt = n => '$' + parseFloat(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 0 });
  const badgeClass = { activo:'badge-activo', moroso:'badge-moroso', cancelado:'badge-cancelado' }[estado] || 'badge-activo';
  const label      = { activo:'Activo', moroso:'Moroso', cancelado:'Cancelado' }[estado] || estado;
  return `
    <div class="prestamo-item" onclick="verDetallePrestamo('${p.ID}')">
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

// ─── DETALLE PRÉSTAMO (desde dashboard o ficha cliente) ───────────────────────
async function verDetallePrestamo(prestamoId, data) {
  const source   = data || dashData;
  if (!source) return;
  const prestamo = source.prestamos.find(p => p.ID === prestamoId);
  if (!prestamo) return;
  selectedPrestamo = prestamo;

  const cuotas = source.cuotas.filter(c => c.PrestamoID === prestamoId);
  const fmt    = n => '$' + parseFloat(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 });
  const hoy    = new Date();

  // Calcular cuotas pendientes y su total
  const pendientes      = cuotas.filter(c => c.Estado !== 'pagada');
  const totalPendiente  = pendientes.reduce((s, c) => s + parseFloat(c.MontoTotal || 0), 0);
  const cuotasPagadas   = cuotas.filter(c => c.Estado === 'pagada').length;

  const cuotasHTML = cuotas.map(c => {
    const [d, m, y]  = c.FechaVencimiento.split('/');
    const fecha       = new Date(`${y}-${m}-${d}`);
    let estadoClass   = 'cuota-pendiente';
    let estadoLabel   = 'Pendiente';
    let accion        = '';

    if (c.Estado === 'pagada') {
      estadoClass = 'cuota-pagada';
      estadoLabel = `✓ ${c.FechaPago}`;
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

  // Botón cancelación anticipada solo si hay cuotas pendientes y el préstamo está activo
  const btnCancelar = (prestamo.Estado === 'activo' && pendientes.length > 0) ? `
    <div style="margin-top:1rem;padding-top:1rem;border-top:1px solid var(--border)">
      <div style="font-size:0.78rem;color:var(--text-secondary);margin-bottom:0.5rem">
        ⚡ Quedan <strong style="color:var(--warning)">${pendientes.length} cuota${pendientes.length > 1 ? 's' : ''}</strong>
        por cobrar · Total: <strong style="color:var(--warning)">${fmt(totalPendiente)}</strong>
      </div>
      <button class="btn btn-danger" onclick="cancelarTodo('${prestamo.ID}')">
        💰 Cobrar todas las cuotas restantes juntas
      </button>
    </div>` : '';

  document.getElementById('detail-nombre').textContent = prestamo.ClienteNombre;
  document.getElementById('detail-estado').innerHTML   = `<span class="badge badge-${prestamo.Estado}">${prestamo.Estado}</span>`;
  document.getElementById('detail-info').innerHTML = `
    <div class="ganancia-preview">
      <div class="ganancia-row"><span>Monto prestado</span><span>${fmt(prestamo.MontoPrestado)}</span></div>
      <div class="ganancia-row"><span>Tasa por cuota</span><span>${prestamo.TasaInteres}%</span></div>
      <div class="ganancia-row"><span>Cuotas pagadas</span><span>${cuotasPagadas} de ${prestamo.CantCuotas}</span></div>
      <div class="ganancia-row"><span>Valor cuota</span><span>${fmt(prestamo.MontoCuota)}</span></div>
      <div class="ganancia-row"><span>Ganancia esperada</span><span style="color:var(--success)">${fmt(prestamo.GananciaTotalEsperada)}</span></div>
      <div class="ganancia-row total"><span>TOTAL A COBRAR</span><span>${fmt(prestamo.MontoTotalConInteres)}</span></div>
    </div>
    ${btnCancelar}`;

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
  } catch(e) { toast('Error: ' + e.message, 'error'); }
  setLoading(false);
}

async function cancelarTodo(prestamoId) {
  const prestamo = (dashData?.prestamos || clientesFullData?.prestamos || []).find(p => p.ID === prestamoId);
  const nombre   = prestamo?.ClienteNombre || 'este cliente';
  if (!confirm(`¿Confirmar cancelación anticipada?\n\n${nombre} pagará TODAS las cuotas restantes juntas.\n\nEsto marcará el préstamo como CANCELADO.`)) return;

  setLoading(true, 'Registrando cancelación...');
  try {
    const cuotasCobradas = await cancelarPrestamoTotal(prestamoId);
    toast(`✓ ${cuotasCobradas} cuota${cuotasCobradas > 1 ? 's' : ''} cobrada${cuotasCobradas > 1 ? 's' : ''}. Préstamo cancelado.`, 'success');
    closeDetail();
    await loadDashboard();
    // Si estamos en la pestaña de clientes, recargar
    if (document.getElementById('view-clientes')?.classList.contains('active')) {
      await loadClientes();
    }
  } catch(e) { toast('Error: ' + e.message, 'error'); }
  setLoading(false);
}

// ─── CLIENTES ─────────────────────────────────────────────────────────────────
let todosClientes  = [];
let todosPrestamos = [];
let todasCuotas   = [];

async function loadClientes() {
  if (SPREADSHEET_ID.includes('TU_SPREADSHEET_ID')) {
    document.getElementById('clientes-list').innerHTML =
      `<div class="empty-state"><div class="empty-state-icon">⚙️</div><p>Configurá el Spreadsheet ID primero</p></div>`;
    return;
  }
  setLoading(true, 'Cargando clientes...');
  try {
    [todosClientes, todosPrestamos, todasCuotas] = await Promise.all([getClientes(), getPrestamos(), getCuotas()]);
    renderListaClientes(todosClientes);
  } catch(e) { toast('Error cargando clientes: ' + e.message, 'error'); }
  setLoading(false);
}

function renderListaClientes(clientes) {
  const el = document.getElementById('clientes-list');
  if (!clientes.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-state-icon">👥</div><p>Sin clientes aún.</p></div>`;
    return;
  }
  el.innerHTML = clientes.map(c => {
    const cprestamos = todosPrestamos.filter(p => p.ClienteID === c.ID);
    const activos    = cprestamos.filter(p => p.Estado === 'activo').length;
    const moroso     = cprestamos.some(p => {
      if (p.Estado !== 'activo') return false;
      const hoy = new Date();
      return todasCuotas.some(cu => {
        if (cu.ClienteID !== c.ID || cu.Estado === 'pagada') return false;
        const [d, m, y] = cu.FechaVencimiento.split('/');
        return new Date(`${y}-${m}-${d}`) < hoy;
      });
    });
    return `
      <div class="prestamo-item" onclick="verFichaCliente('${c.ID}')">
        <div>
          <div class="prestamo-nombre">${c.Nombre}</div>
          <div class="prestamo-meta">DNI: ${c.DNI}${c.Telefono ? ' · Tel: ' + c.Telefono : ''}</div>
          <div class="prestamo-meta">Alta: ${c.FechaAlta}</div>
          ${moroso ? '<span class="badge badge-moroso">⚠️ Moroso</span>' : ''}
        </div>
        <div class="prestamo-monto">
          <div style="font-size:0.72rem;color:var(--text-secondary)">Préstamos</div>
          <div style="font-family:var(--font-data);font-size:1.2rem">${cprestamos.length}</div>
          <div style="font-size:0.72rem;color:var(--accent)">${activos} activos</div>
        </div>
      </div>`;
  }).join('');
}

function buscarCliente() {
  const q = document.getElementById('buscador-cliente').value.trim().toLowerCase();
  if (!q) { renderListaClientes(todosClientes); return; }
  const filtrados = todosClientes.filter(c =>
    c.Nombre.toLowerCase().includes(q) || c.DNI.includes(q)
  );
  renderListaClientes(filtrados);
}

// ─── FICHA COMPLETA DEL CLIENTE ───────────────────────────────────────────────
function verFichaCliente(clienteId) {
  const cliente   = todosClientes.find(c => c.ID === clienteId);
  if (!cliente) return;

  const prestamos = todosPrestamos.filter(p => p.ClienteID === clienteId);
  const cuotas    = todasCuotas.filter(c => c.ClienteID === clienteId);

  const fmt = n => '$' + parseFloat(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 });
  const hoy = new Date();

  // Calcular resumen financiero del cliente
  let totalPrestado = 0, totalDeuda = 0, totalGanancia = 0;
  prestamos.forEach(p => {
    totalPrestado += parseFloat(p.MontoPrestado || 0);
    if (p.Estado === 'activo') {
      const pendientes = cuotas.filter(c => c.PrestamoID === p.ID && c.Estado !== 'pagada');
      totalDeuda += pendientes.reduce((s, c) => s + parseFloat(c.MontoTotal || 0), 0);
      totalGanancia += parseFloat(p.GananciaTotalEsperada || 0);
    }
  });

  const activos    = prestamos.filter(p => p.Estado === 'activo');
  const cancelados = prestamos.filter(p => p.Estado === 'cancelado');

  // HTML de cada préstamo
  const prestamosHTML = prestamos.length ? prestamos.map(p => {
    const cuotasPrestamo = cuotas.filter(c => c.PrestamoID === p.ID);
    const pagadas    = cuotasPrestamo.filter(c => c.Estado === 'pagada').length;
    const pendientes = cuotasPrestamo.filter(c => c.Estado !== 'pagada');
    const deudaP     = pendientes.reduce((s, c) => s + parseFloat(c.MontoTotal || 0), 0);
    const esMoroso   = p.Estado === 'activo' && pendientes.some(c => {
      const [d, m, y] = c.FechaVencimiento.split('/');
      return new Date(`${y}-${m}-${d}`) < hoy;
    });
    const badgeClass = esMoroso ? 'badge-moroso' : (p.Estado === 'activo' ? 'badge-activo' : 'badge-cancelado');
    const badgeLabel = esMoroso ? '⚠️ Moroso' : (p.Estado === 'activo' ? 'Activo' : 'Cancelado');

    return `
      <div class="prestamo-item" style="flex-direction:column;gap:0.6rem" onclick="verDetallePrestamo('${p.ID}', {prestamos: todosPrestamos, cuotas: todasCuotas})">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div>
            <div style="font-size:0.82rem;color:var(--text-secondary)">Préstamo del ${p.FechaInicio}</div>
            <div style="font-family:var(--font-data);font-size:1rem;margin-top:0.2rem">${fmt(p.MontoPrestado)} prestados</div>
            <span class="badge ${badgeClass}" style="margin-top:0.3rem">${badgeLabel}</span>
          </div>
          <div style="text-align:right">
            <div style="font-size:0.72rem;color:var(--text-secondary)">Cuotas</div>
            <div style="font-family:var(--font-data)">${pagadas}/${p.CantCuotas}</div>
          </div>
        </div>
        ${p.Estado === 'activo' ? `
        <div style="display:flex;justify-content:space-between;font-size:0.8rem;background:rgba(251,191,36,0.08);border-radius:8px;padding:0.5rem 0.75rem">
          <span style="color:var(--text-secondary)">Debe todavía:</span>
          <span style="font-family:var(--font-data);color:var(--warning);font-weight:600">${fmt(deudaP)}</span>
        </div>` : ''}
        <div style="font-size:0.72rem;color:var(--accent)">Tocá para ver cuotas y cobrar →</div>
      </div>`;
  }).join('') : `<div class="empty-state" style="padding:1.5rem"><p>Sin préstamos registrados</p></div>`;

  document.getElementById('ficha-nombre').textContent = cliente.Nombre;
  document.getElementById('ficha-subtitulo').textContent = `DNI: ${cliente.DNI}${cliente.Telefono ? '  ·  Tel: ' + cliente.Telefono : ''}`;

  document.getElementById('ficha-body').innerHTML = `
    <!-- Resumen financiero -->
    <div class="ganancia-preview" style="margin-bottom:1rem">
      <div class="ganancia-row"><span>Total prestado (histórico)</span><span>${fmt(totalPrestado)}</span></div>
      <div class="ganancia-row"><span>Préstamos activos</span><span>${activos.length}</span></div>
      <div class="ganancia-row"><span>Préstamos cancelados</span><span>${cancelados.length}</span></div>
      <div class="ganancia-row"><span>Ganancia esperada (activos)</span><span style="color:var(--success)">${fmt(totalGanancia)}</span></div>
      <div class="ganancia-row total"><span>DEUDA TOTAL ACTUAL</span><span style="color:var(--warning)">${fmt(totalDeuda)}</span></div>
    </div>

    <!-- Lista de préstamos -->
    <div class="section-title" style="margin-bottom:0.6rem">Historial de préstamos</div>
    <div class="prestamo-list">${prestamosHTML}</div>
  `;

  document.getElementById('ficha-overlay').classList.add('open');
}

function closeFicha() {
  document.getElementById('ficha-overlay').classList.remove('open');
}

// ─── NUEVO PRÉSTAMO ────────────────────────────────────────────────────────────
async function loadClientesSelect() {
  const sel = document.getElementById('select-cliente');
  if (SPREADSHEET_ID.includes('TU_SPREADSHEET_ID')) {
    sel.innerHTML = '<option value="">⚠️ Falta configurar Spreadsheet ID</option>';
    return;
  }
  sel.innerHTML = '<option value="">Cargando clientes...</option>';
  try {
    clientesCache = await getClientes();
    console.log('[PrestaPro] Clientes obtenidos:', clientesCache);
    if (!clientesCache.length) {
      sel.innerHTML = '<option value="">No hay clientes — creá uno nuevo abajo</option>';
      return;
    }
    sel.innerHTML = '<option value="">Seleccioná un cliente...</option>' +
      clientesCache.map(c => `<option value="${c.ID}" data-nombre="${c.Nombre}">${c.Nombre} (DNI: ${c.DNI})</option>`).join('');
  } catch(e) {
    console.error('[PrestaPro] Error cargando clientes para el select:', e);
    sel.innerHTML = `<option value="">❌ Error: ${e.message}</option>`;
    toast('No se pudieron cargar los clientes: ' + e.message, 'error');
  }
}

function resetForm() {
  ['inp-monto','inp-tasa','inp-cuotas','inp-obs','inp-nombre','inp-dni','inp-tel','inp-dir'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('ganancia-preview').style.display = 'none';
  document.getElementById('inp-fecha').value = new Date().toISOString().slice(0,10);
  loadClientesSelect();
}

function calcularGanancia() {
  const monto  = parseFloat(document.getElementById('inp-monto').value) || 0;
  const tasa   = parseFloat(document.getElementById('inp-tasa').value)  || 0;
  const cuotas = parseInt(document.getElementById('inp-cuotas').value)  || 0;
  const fmt    = n => '$' + n.toLocaleString('es-AR', { minimumFractionDigits: 2 });

  if (!monto || !tasa || !cuotas) { document.getElementById('ganancia-preview').style.display = 'none'; return; }

  // Tasa sobre el total prestado (interés simple, una sola vez)
  const interesTotal    = monto * (tasa / 100);
  const totalConInteres = monto + interesTotal;
  const montoCuota      = totalConInteres / cuotas;

  document.getElementById('prev-capital').textContent       = fmt(monto);
  document.getElementById('prev-interes-cuota').textContent = fmt(interesTotal);
  document.getElementById('prev-cuota').textContent         = fmt(montoCuota);
  document.getElementById('prev-ganancia-total').textContent= fmt(interesTotal);
  document.getElementById('prev-total').textContent         = fmt(totalConInteres);
  document.getElementById('ganancia-preview').style.display = 'block';
}

let nuevoClienteMode = false;
function toggleNuevoCliente() {
  nuevoClienteMode = !nuevoClienteMode;
  document.getElementById('seccion-cliente-existente').style.display = nuevoClienteMode ? 'none' : 'block';
  document.getElementById('seccion-cliente-nuevo').style.display     = nuevoClienteMode ? 'block' : 'none';
  document.getElementById('btn-toggle-cliente').textContent =
    nuevoClienteMode ? '← Usar cliente existente' : '+ Crear cliente nuevo';
}

async function submitPrestamo() {
  if (SPREADSHEET_ID.includes('TU_SPREADSHEET_ID')) { toast('Configurá el Spreadsheet ID primero', 'error'); return; }

  const monto  = parseFloat(document.getElementById('inp-monto').value);
  const tasa   = parseFloat(document.getElementById('inp-tasa').value);
  const cuotas = parseInt(document.getElementById('inp-cuotas').value);
  const fecha  = document.getElementById('inp-fecha').value;
  const obs    = document.getElementById('inp-obs').value;

  if (!monto || !tasa || !cuotas || !fecha) { toast('Completá todos los campos obligatorios', 'error'); return; }

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
      clienteId = nuevo.ID; clienteNombre = nombre;
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
  } catch(e) { toast('Error: ' + e.message, 'error'); }
  setLoading(false);
}

// ─── UTILIDADES ───────────────────────────────────────────────────────────────
function setLoading(show, msg = 'Cargando...') {
  const el = document.getElementById('loading-overlay');
  if (show) { el.querySelector('span').textContent = msg; el.classList.add('show'); }
  else el.classList.remove('show');
}

function toast(msg, type = 'info') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className   = `toast ${type} show`;
  setTimeout(() => el.classList.remove('show'), 3500);
}

function updateSyncTime() {
  const el = document.getElementById('sync-time');
  if (el) el.textContent = new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}
