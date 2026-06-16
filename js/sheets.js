// ─── GOOGLE SHEETS API ──────────────────────────────────────────────────────
// Reemplazá SPREADSHEET_ID con el ID de tu Google Sheet
// El ID está en la URL: https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit

const SPREADSHEET_ID = 'TU_SPREADSHEET_ID_AQUI';
const SHEETS_BASE    = 'https://sheets.googleapis.com/v4/spreadsheets';

// Nombres de hojas en el Google Sheet
const SHEET_CLIENTES = 'Clientes';
const SHEET_PRESTAMOS = 'Prestamos';
const SHEET_CUOTAS   = 'Cuotas';

// Cabeceras de cada hoja
const HEADERS = {
  clientes:  ['ID','Nombre','DNI','Telefono','Direccion','FechaAlta'],
  prestamos: ['ID','ClienteID','ClienteNombre','MontoPrestado','TasaInteres','CantCuotas',
               'MontoTotalConInteres','GananciaTotalEsperada','MontoCuota',
               'FechaInicio','Estado','Observaciones'],
  cuotas:    ['ID','PrestamoID','ClienteID','NroCuota','FechaVencimiento',
               'MontoCapital','MontoInteres','MontoTotal','Estado','FechaPago']
};

// ─── INIT ───────────────────────────────────────────────────────────────────
async function initSheets() {
  if (SPREADSHEET_ID.includes('TU_SPREADSHEET_ID')) return false;
  try {
    await ensureSheets();
    return true;
  } catch (e) {
    console.error('Error iniciando sheets:', e);
    return false;
  }
}

async function sheetsRequest(endpoint, method = 'GET', body = null) {
  const token = getAccessToken();
  if (!token) throw new Error('Sin autenticación');

  const opts = {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${SHEETS_BASE}/${SPREADSHEET_ID}${endpoint}`, opts);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error?.message || 'Error en Sheets API');
  }
  return res.json();
}

// ─── ASEGURAR QUE EXISTEN LAS HOJAS ─────────────────────────────────────────
async function ensureSheets() {
  const data = await sheetsRequest('');
  const existing = data.sheets.map(s => s.properties.title);
  const needed   = [SHEET_CLIENTES, SHEET_PRESTAMOS, SHEET_CUOTAS];
  const toCreate = needed.filter(n => !existing.includes(n));

  if (toCreate.length > 0) {
    const requests = toCreate.map(title => ({
      addSheet: { properties: { title } }
    }));
    await sheetsRequest(':batchUpdate', 'POST', { requests });

    // Insertar cabeceras
    const headerData = [];
    if (toCreate.includes(SHEET_CLIENTES))
      headerData.push({ range: `${SHEET_CLIENTES}!A1`, values: [HEADERS.clientes] });
    if (toCreate.includes(SHEET_PRESTAMOS))
      headerData.push({ range: `${SHEET_PRESTAMOS}!A1`, values: [HEADERS.prestamos] });
    if (toCreate.includes(SHEET_CUOTAS))
      headerData.push({ range: `${SHEET_CUOTAS}!A1`, values: [HEADERS.cuotas] });

    if (headerData.length) {
      await sheetsRequest('/values:batchUpdate', 'POST', {
        valueInputOption: 'RAW',
        data: headerData
      });
    }
  }
}

// ─── LEER DATOS ──────────────────────────────────────────────────────────────
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
  } catch (e) {
    console.error(`Error leyendo ${sheet}:`, e);
    return [];
  }
}

async function getClientes()  { return getRows(SHEET_CLIENTES); }
async function getPrestamos() { return getRows(SHEET_PRESTAMOS); }
async function getCuotas()    { return getRows(SHEET_CUOTAS); }

// ─── AGREGAR FILA ─────────────────────────────────────────────────────────────
async function appendRow(sheet, rowArray) {
  return sheetsRequest(`/values/${sheet}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, 'POST', {
    values: [rowArray]
  });
}

// ─── ACTUALIZAR FILA ─────────────────────────────────────────────────────────
async function updateRow(sheet, rowIndex, rowArray) {
  // rowIndex es 1-based, +1 por la cabecera
  const range = `${sheet}!A${rowIndex + 2}`;
  return sheetsRequest(`/values/${range}?valueInputOption=RAW`, 'PUT', {
    values: [rowArray]
  });
}

// ─── GENERAR ID ÚNICO ─────────────────────────────────────────────────────────
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ─── GUARDAR CLIENTE ─────────────────────────────────────────────────────────
async function guardarCliente(datos) {
  const id = genId();
  const row = [id, datos.nombre, datos.dni, datos.telefono, datos.direccion, new Date().toLocaleDateString('es-AR')];
  await appendRow(SHEET_CLIENTES, row);
  return { ID: id, ...datos };
}

// ─── GUARDAR PRÉSTAMO Y SUS CUOTAS ───────────────────────────────────────────
async function guardarPrestamo(datos) {
  const idPrestamo = genId();
  const monto      = parseFloat(datos.monto);
  const tasa       = parseFloat(datos.tasa);    // % por cuota
  const cuotas     = parseInt(datos.cuotas);
  const clienteId  = datos.clienteId;
  const clienteNombre = datos.clienteNombre;
  const fechaInicio = datos.fechaInicio;

  // Calcular montos
  const interesTotal    = monto * (tasa / 100) * cuotas;
  const totalConInteres = monto + interesTotal;
  const montoCuota      = totalConInteres / cuotas;
  const gananciaTotal   = interesTotal;

  // Fila de préstamo
  const rowPrestamo = [
    idPrestamo, clienteId, clienteNombre,
    monto.toFixed(2), tasa.toFixed(2), cuotas,
    totalConInteres.toFixed(2), gananciaTotal.toFixed(2), montoCuota.toFixed(2),
    fechaInicio, 'activo', datos.observaciones || ''
  ];
  await appendRow(SHEET_PRESTAMOS, rowPrestamo);

  // Generar cuotas
  const fechaBase = new Date(fechaInicio + 'T00:00:00');
  const rowsCuotas = [];
  for (let i = 1; i <= cuotas; i++) {
    const fechaVenc = new Date(fechaBase);
    fechaVenc.setMonth(fechaVenc.getMonth() + i);
    const capitalCuota  = (monto / cuotas).toFixed(2);
    const interesCuota  = (monto * tasa / 100).toFixed(2);
    rowsCuotas.push([
      genId(), idPrestamo, clienteId,
      i, fechaVenc.toLocaleDateString('es-AR'),
      capitalCuota, interesCuota, montoCuota.toFixed(2),
      'pendiente', ''
    ]);
  }

  // Insertar cuotas en batch
  for (const row of rowsCuotas) {
    await appendRow(SHEET_CUOTAS, row);
  }

  return {
    id: idPrestamo, monto, tasa, cuotas, montoCuota,
    totalConInteres, gananciaTotal, clienteNombre, fechaInicio,
    estado: 'activo'
  };
}

// ─── MARCAR CUOTA COMO PAGADA ─────────────────────────────────────────────────
async function pagarCuota(cuotaId) {
  const allCuotas = await getCuotas();
  const idx = allCuotas.findIndex(c => c.ID === cuotaId);
  if (idx === -1) throw new Error('Cuota no encontrada');

  const cuota = allCuotas[idx];
  const row = [
    cuota.ID, cuota.PrestamoID, cuota.ClienteID,
    cuota.NroCuota, cuota.FechaVencimiento,
    cuota.MontoCapital, cuota.MontoInteres, cuota.MontoTotal,
    'pagada', new Date().toLocaleDateString('es-AR')
  ];
  await updateRow(SHEET_CUOTAS, idx, row);

  // Verificar si todas las cuotas del préstamo están pagadas
  const cuotasPrestamo = allCuotas.filter(c => c.PrestamoID === cuota.PrestamoID);
  const todasPagadas = cuotasPrestamo.every(c => c.ID === cuotaId || c.Estado === 'pagada');
  if (todasPagadas) {
    await cerrarPrestamo(cuota.PrestamoID);
  }
}

async function cerrarPrestamo(prestamoId) {
  const prestamos = await getPrestamos();
  const idx = prestamos.findIndex(p => p.ID === prestamoId);
  if (idx === -1) return;
  const p = prestamos[idx];
  const row = [
    p.ID, p.ClienteID, p.ClienteNombre, p.MontoPrestado,
    p.TasaInteres, p.CantCuotas, p.MontoTotalConInteres,
    p.GananciaTotalEsperada, p.MontoCuota, p.FechaInicio,
    'cancelado', p.Observaciones
  ];
  await updateRow(SHEET_PRESTAMOS, idx, row);
}

// ─── CALCULAR DASHBOARD ───────────────────────────────────────────────────────
async function getDashboardData() {
  const [prestamos, cuotas] = await Promise.all([getPrestamos(), getCuotas()]);

  const activos    = prestamos.filter(p => p.Estado === 'activo');
  const cancelados = prestamos.filter(p => p.Estado === 'cancelado');
  const morosos    = [];

  const hoy = new Date();
  let capitalEnCalle  = 0;
  let gananciaEsperada = 0;
  let gananciaRealizada = 0;
  let montoPendiente = 0;

  // Detectar morosos
  const prestamosMorosos = new Set();
  cuotas.forEach(c => {
    if (c.Estado === 'pendiente') {
      const partes = c.FechaVencimiento.split('/');
      const fecha  = new Date(`${partes[2]}-${partes[1]}-${partes[0]}`);
      if (fecha < hoy) prestamosMorosos.add(c.PrestamoID);
    }
    if (c.Estado === 'pagada') {
      gananciaRealizada += parseFloat(c.MontoInteres || 0);
    }
    if (c.Estado === 'pendiente') {
      montoPendiente += parseFloat(c.MontoTotal || 0);
    }
  });

  activos.forEach(p => {
    capitalEnCalle  += parseFloat(p.MontoPrestado || 0);
    gananciaEsperada += parseFloat(p.GananciaTotalEsperada || 0);
    if (prestamosMorosos.has(p.ID)) morosos.push(p);
  });

  return {
    totalClientes: [...new Set(prestamos.map(p => p.ClienteID))].length,
    prestamosActivos: activos.length,
    prestamosCancelados: cancelados.length,
    prestamosMorosos: morosos.length,
    capitalEnCalle,
    gananciaEsperada,
    gananciaRealizada,
    montoPendiente,
    prestamos,
    cuotas,
    morosos
  };
}
