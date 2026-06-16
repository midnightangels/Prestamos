// ─── GOOGLE SHEETS API ──────────────────────────────────────────────────────
const SPREADSHEET_ID = '1B7xBgeREBaJSggmbjgxMUbpUuy9RL7aoLN_ANE9T43U';
const SHEETS_BASE    = 'https://sheets.googleapis.com/v4/spreadsheets';

const SHEET_CLIENTES  = 'Clientes';
const SHEET_PRESTAMOS = 'Prestamos';
const SHEET_CUOTAS    = 'Cuotas';
const SHEET_HISTORIAL = 'Historial';

const HEADERS = {
  clientes:  ['ID','Nombre','DNI','Telefono','Direccion','FechaAlta'],
  prestamos: ['ID','ClienteID','ClienteNombre','MontoPrestado','TasaInteres','CantCuotas',
               'MontoTotalConInteres','GananciaTotalEsperada','MontoCuota',
               'FechaInicio','Estado','Observaciones','TasaMora'],
  cuotas:    ['ID','PrestamoID','ClienteID','NroCuota','FechaVencimiento',
               'MontoCapital','MontoInteres','MontoTotal','Estado','FechaPago','RecargoMora'],
  historial: ['Fecha','ClienteNombre','Accion']
};

async function initSheets() {
  if (SPREADSHEET_ID.includes('TU_SPREADSHEET_ID')) return false;
  try { await ensureSheets(); return true; }
  catch (e) { console.error('Error iniciando sheets:', e); return false; }
}

async function sheetsRequest(endpoint, method = 'GET', body = null) {
  const token = getAccessToken();
  if (!token) throw new Error('Sin autenticación');
  const opts = {
    method,
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${SHEETS_BASE}/${SPREADSHEET_ID}${endpoint}`, opts);
  if (!res.ok) { const err = await res.json(); throw new Error(err.error?.message || 'Error en Sheets API'); }
  return res.json();
}

async function ensureSheets() {
  const data     = await sheetsRequest('');
  const existing = data.sheets.map(s => s.properties.title);
  const needed   = [SHEET_CLIENTES, SHEET_PRESTAMOS, SHEET_CUOTAS, SHEET_HISTORIAL];
  const toCreate = needed.filter(n => !existing.includes(n));
  if (toCreate.length > 0) {
    const requests = toCreate.map(title => ({ addSheet: { properties: { title } } }));
    await sheetsRequest(':batchUpdate', 'POST', { requests });
    const headerData = [];
    if (toCreate.includes(SHEET_CLIENTES))  headerData.push({ range: `${SHEET_CLIENTES}!A1`,  values: [HEADERS.clientes] });
    if (toCreate.includes(SHEET_PRESTAMOS)) headerData.push({ range: `${SHEET_PRESTAMOS}!A1`, values: [HEADERS.prestamos] });
    if (toCreate.includes(SHEET_CUOTAS))    headerData.push({ range: `${SHEET_CUOTAS}!A1`,    values: [HEADERS.cuotas] });
    if (toCreate.includes(SHEET_HISTORIAL)) headerData.push({ range: `${SHEET_HISTORIAL}!A1`, values: [HEADERS.historial] });
    if (headerData.length) await sheetsRequest('/values:batchUpdate', 'POST', { valueInputOption: 'RAW', data: headerData });
  }
}

async function getRows(sheet) {
  try {
    const data = await sheetsRequest(`/values/${sheet}`);
    const rows = data.values || [];
    if (rows.length < 2) return [];
    const headers = rows[0];
    return rows.slice(1).map(row => {
      const obj = {};
      headers.forEach((h, i) => obj[h] = row[i] || '');
      return obj;
    });
  } catch (e) { console.error(`Error leyendo ${sheet}:`, e); return []; }
}

async function getClientes()  { return getRows(SHEET_CLIENTES); }
async function getPrestamos() { return getRows(SHEET_PRESTAMOS); }
async function getCuotas()    { return getRows(SHEET_CUOTAS); }
async function getHistorial() { return getRows(SHEET_HISTORIAL); }

async function appendRow(sheet, rowArray) {
  return sheetsRequest(`/values/${sheet}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, 'POST', { values: [rowArray] });
}

async function updateRow(sheet, rowIndex, rowArray) {
  const range = `${sheet}!A${rowIndex + 2}`;
  return sheetsRequest(`/values/${range}?valueInputOption=RAW`, 'PUT', { values: [rowArray] });
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ─── HISTORIAL / AUDITORÍA ────────────────────────────────────────────────────
async function registrarHistorial(clienteNombre, accion) {
  try {
    const fecha = new Date().toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
    await appendRow(SHEET_HISTORIAL, [fecha, clienteNombre, accion]);
  } catch (e) {
    console.error('No se pudo registrar en historial:', e);
  }
}

async function guardarCliente(datos) {
  const id  = genId();
  const row = [id, datos.nombre, datos.dni, datos.telefono, datos.direccion, new Date().toLocaleDateString('es-AR')];
  await appendRow(SHEET_CLIENTES, row);
  await registrarHistorial(datos.nombre, 'Cliente creado');
  return { ID: id, ...datos };
}

async function guardarPrestamo(datos) {
  const idPrestamo    = genId();
  const monto         = parseFloat(datos.monto);
  const tasa          = parseFloat(datos.tasa);
  const tasaMora      = parseFloat(datos.tasaMora) || 0;
  const cuotas        = parseInt(datos.cuotas);
  const clienteId     = datos.clienteId;
  const clienteNombre = datos.clienteNombre;
  const fechaInicio   = datos.fechaInicio;

  // Interés simple: se calcula una sola vez sobre el monto prestado
  const interesTotal    = monto * (tasa / 100);
  const totalConInteres = monto + interesTotal;
  const montoCuota      = totalConInteres / cuotas;
  const gananciaTotal   = interesTotal;

  const rowPrestamo = [
    idPrestamo, clienteId, clienteNombre,
    monto.toFixed(2), tasa.toFixed(2), cuotas,
    totalConInteres.toFixed(2), gananciaTotal.toFixed(2), montoCuota.toFixed(2),
    fechaInicio, 'activo', datos.observaciones || '', tasaMora.toFixed(2)
  ];
  await appendRow(SHEET_PRESTAMOS, rowPrestamo);

  const fechaBase = new Date(fechaInicio + 'T00:00:00');
  for (let i = 1; i <= cuotas; i++) {
    const fechaVenc    = new Date(fechaBase);
    fechaVenc.setMonth(fechaVenc.getMonth() + i);
    const capitalCuota = (monto / cuotas).toFixed(2);
    const interesCuota = (interesTotal / cuotas).toFixed(2);
    await appendRow(SHEET_CUOTAS, [
      genId(), idPrestamo, clienteId,
      i, fechaVenc.toLocaleDateString('es-AR'),
      capitalCuota, interesCuota, montoCuota.toFixed(2),
      'pendiente', '', '0.00'
    ]);
  }

  await registrarHistorial(clienteNombre, `Préstamo nuevo creado por $${monto.toLocaleString('es-AR')} en ${cuotas} cuotas`);

  return { id: idPrestamo, monto, tasa, cuotas, montoCuota, totalConInteres, gananciaTotal, clienteNombre, fechaInicio, estado: 'activo' };
}

// ─── CÁLCULO DE MORA COMPUESTA ────────────────────────────────────────────────
// Calcula meses completos de atraso y aplica interés compuesto sobre el monto de la cuota
function calcularMora(montoCuota, tasaMoraPct, fechaVencimiento) {
  if (!tasaMoraPct) return { meses: 0, recargo: 0, totalConMora: montoCuota };
  const [d, m, y] = fechaVencimiento.split('/');
  const venc = new Date(`${y}-${m}-${d}`);
  const hoy  = new Date();
  if (venc >= hoy) return { meses: 0, recargo: 0, totalConMora: montoCuota };

  let meses = (hoy.getFullYear() - venc.getFullYear()) * 12 + (hoy.getMonth() - venc.getMonth());
  if (hoy.getDate() < venc.getDate()) meses -= 1;
  meses = Math.max(0, meses) + 1; // al vencerse ya cuenta como 1 mes de atraso

  const totalConMora = montoCuota * Math.pow(1 + tasaMoraPct / 100, meses);
  const recargo = totalConMora - montoCuota;
  return { meses, recargo, totalConMora };
}

// Recalcula y persiste el recargo por mora de todas las cuotas vencidas de un préstamo
async function actualizarMoraPrestamo(prestamoId, tasaMoraPct) {
  if (!tasaMoraPct) return;
  const allCuotas = await getCuotas();
  const cuotasPrestamo = allCuotas
    .map((c, i) => ({ ...c, _idx: i }))
    .filter(c => c.PrestamoID === prestamoId && c.Estado !== 'pagada');

  for (const cuota of cuotasPrestamo) {
    const { recargo, totalConMora } = calcularMora(parseFloat(cuota.MontoTotal), tasaMoraPct, cuota.FechaVencimiento);
    const recargoActual = parseFloat(cuota.RecargoMora || 0);
    // Solo actualizar si cambió, para no gastar cuota de API innecesariamente
    if (Math.abs(recargo - recargoActual) > 0.01) {
      const row = [
        cuota.ID, cuota.PrestamoID, cuota.ClienteID,
        cuota.NroCuota, cuota.FechaVencimiento,
        cuota.MontoCapital, cuota.MontoInteres, cuota.MontoTotal,
        cuota.Estado, cuota.FechaPago, recargo.toFixed(2)
      ];
      await updateRow(SHEET_CUOTAS, cuota._idx, row);
    }
  }
}

// ─── PAGAR UNA CUOTA ─────────────────────────────────────────────────────────
async function pagarCuota(cuotaId) {
  const allCuotas = await getCuotas();
  const idx       = allCuotas.findIndex(c => c.ID === cuotaId);
  if (idx === -1) throw new Error('Cuota no encontrada');
  const cuota = allCuotas[idx];
  const row = [
    cuota.ID, cuota.PrestamoID, cuota.ClienteID,
    cuota.NroCuota, cuota.FechaVencimiento,
    cuota.MontoCapital, cuota.MontoInteres, cuota.MontoTotal,
    'pagada', new Date().toLocaleDateString('es-AR'), cuota.RecargoMora || '0.00'
  ];
  await updateRow(SHEET_CUOTAS, idx, row);

  const prestamos = await getPrestamos();
  const prestamo  = prestamos.find(p => p.ID === cuota.PrestamoID);
  if (prestamo) await registrarHistorial(prestamo.ClienteNombre, `Cuota ${cuota.NroCuota} cobrada`);

  const cuotasPrestamo = allCuotas.filter(c => c.PrestamoID === cuota.PrestamoID);
  const todasPagadas   = cuotasPrestamo.every(c => c.ID === cuotaId || c.Estado === 'pagada');
  if (todasPagadas) await cerrarPrestamo(cuota.PrestamoID);
}

// ─── CANCELACIÓN ANTICIPADA (pago de todas las cuotas restantes) ─────────────
async function cancelarPrestamoTotal(prestamoId) {
  const allCuotas  = await getCuotas();
  const pendientes = allCuotas
    .map((c, i) => ({ ...c, _idx: i }))
    .filter(c => c.PrestamoID === prestamoId && c.Estado !== 'pagada');

  const hoy = new Date().toLocaleDateString('es-AR');
  for (const cuota of pendientes) {
    const row = [
      cuota.ID, cuota.PrestamoID, cuota.ClienteID,
      cuota.NroCuota, cuota.FechaVencimiento,
      cuota.MontoCapital, cuota.MontoInteres, cuota.MontoTotal,
      'pagada', hoy, cuota.RecargoMora || '0.00'
    ];
    await updateRow(SHEET_CUOTAS, cuota._idx, row);
  }
  await cerrarPrestamo(prestamoId);

  const prestamos = await getPrestamos();
  const prestamo  = prestamos.find(p => p.ID === prestamoId);
  if (prestamo) await registrarHistorial(prestamo.ClienteNombre, `Préstamo cancelado anticipadamente (${pendientes.length} cuotas)`);

  return pendientes.length;
}

async function cerrarPrestamo(prestamoId) {
  const prestamos = await getPrestamos();
  const idx = prestamos.findIndex(p => p.ID === prestamoId);
  if (idx === -1) return;
  const p   = prestamos[idx];
  const row = [
    p.ID, p.ClienteID, p.ClienteNombre, p.MontoPrestado,
    p.TasaInteres, p.CantCuotas, p.MontoTotalConInteres,
    p.GananciaTotalEsperada, p.MontoCuota, p.FechaInicio,
    'cancelado', p.Observaciones, p.TasaMora || '0'
  ];
  await updateRow(SHEET_PRESTAMOS, idx, row);
}

// ─── DASHBOARD DATA ───────────────────────────────────────────────────────────
async function getDashboardData() {
  const [prestamos, cuotas] = await Promise.all([getPrestamos(), getCuotas()]);

  const activos    = prestamos.filter(p => p.Estado === 'activo');
  const cancelados = prestamos.filter(p => p.Estado === 'cancelado');
  const hoy        = new Date();
  let capitalEnCalle = 0, gananciaEsperada = 0, gananciaRealizada = 0, montoPendiente = 0, moraAcumulada = 0;

  const prestamosMorososSet = new Set();
  cuotas.forEach(c => {
    if (c.Estado === 'pendiente') {
      const [d, m, y] = c.FechaVencimiento.split('/');
      const fecha = new Date(`${y}-${m}-${d}`);
      if (fecha < hoy) prestamosMorososSet.add(c.PrestamoID);
      montoPendiente += parseFloat(c.MontoTotal || 0) + parseFloat(c.RecargoMora || 0);
      moraAcumulada   += parseFloat(c.RecargoMora || 0);
    }
    if (c.Estado === 'pagada') gananciaRealizada += parseFloat(c.MontoInteres || 0) + parseFloat(c.RecargoMora || 0);
  });

  const morosos = [];
  activos.forEach(p => {
    capitalEnCalle   += parseFloat(p.MontoPrestado || 0);
    gananciaEsperada += parseFloat(p.GananciaTotalEsperada || 0);
    if (prestamosMorososSet.has(p.ID)) morosos.push(p);
  });

  return {
    totalClientes: [...new Set(prestamos.map(p => p.ClienteID))].length,
    prestamosActivos: activos.length,
    prestamosCancelados: cancelados.length,
    prestamosMorosos: morosos.length,
    capitalEnCalle, gananciaEsperada, gananciaRealizada, montoPendiente, moraAcumulada,
    prestamos, cuotas, morosos
  };
}

// ─── GANANCIA POR MES (para gráfico) ──────────────────────────────────────────
async function getGananciaPorMes() {
  const cuotas = await getCuotas();
  const pagadas = cuotas.filter(c => c.Estado === 'pagada' && c.FechaPago);
  const porMes = {};

  pagadas.forEach(c => {
    const [d, m, y] = c.FechaPago.split('/');
    const key = `${y}-${m.padStart(2,'0')}`;
    const ganancia = parseFloat(c.MontoInteres || 0) + parseFloat(c.RecargoMora || 0);
    porMes[key] = (porMes[key] || 0) + ganancia;
  });

  return Object.entries(porMes)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, total]) => {
      const [y, m] = key.split('-');
      const nombres = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
      return { mes: `${nombres[parseInt(m)-1]} ${y}`, total };
    });
}

// ─── CUOTAS PRÓXIMAS A VENCER ─────────────────────────────────────────────────
async function getProximasAVencer(dias = 7) {
  const cuotas = await getCuotas();
  const hoy    = new Date();
  const limite = new Date();
  limite.setDate(limite.getDate() + dias);

  return cuotas.filter(c => {
    if (c.Estado === 'pagada') return false;
    const [d, m, y] = c.FechaVencimiento.split('/');
    const fecha = new Date(`${y}-${m}-${d}`);
    return fecha >= hoy && fecha <= limite;
  }).sort((a, b) => {
    const [d1,m1,y1] = a.FechaVencimiento.split('/');
    const [d2,m2,y2] = b.FechaVencimiento.split('/');
    return new Date(`${y1}-${m1}-${d1}`) - new Date(`${y2}-${m2}-${d2}`);
  });
}
