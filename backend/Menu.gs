/** Menú "Visitas IESS" dentro de la hoja de cálculo. */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Visitas IESS')
    .addItem('1. Configurar hojas', 'configurarHojas')
    .addItem('2. Instalar activadores (alertas y respaldo)', 'instalarActivadores')
    .addSeparator()
    .addItem('Generar código de activación (fila seleccionada en Usuarios)', 'generarCodigoActivacion')
    .addItem('Desactivar teléfonos del usuario seleccionado', 'desactivarTelefonos')
    .addItem('Procesar órdenes importadas (pestaña Importar_Ordenes)', 'procesarOrdenesImportadas')
    .addSeparator()
    .addItem('Revisar alertas ahora', 'reglasPeriodicas')
    .addItem('Cuadre del día ahora', 'cuadreDiario')
    .addItem('Reporte de controlados', 'generarReporteControlados')
    .addItem('Respaldo ahora', 'respaldoNocturno')
    .addToUi();
}

function instalarActivadores() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('reglasPeriodicas').timeBased().everyMinutes(15).create();
  ScriptApp.newTrigger('cuadreDiario').timeBased().atHour(21).everyDays(1).inTimezone('America/Guayaquil').create();
  ScriptApp.newTrigger('respaldoNocturno').timeBased().atHour(23).everyDays(1).inTimezone('America/Guayaquil').create();
  SpreadsheetApp.getUi().alert('Activadores instalados: alertas cada 15 min, cuadre a las 21:00 y respaldo a las 23:00.');
}

function filaSeleccionada_(nombreHoja) {
  const h = SpreadsheetApp.getActiveSheet();
  if (h.getName() !== nombreHoja) throw new Error('Seleccione una fila en la pestaña ' + nombreHoja);
  const fila = h.getActiveRange().getRow();
  if (fila < 2) throw new Error('Seleccione una fila de datos');
  return fila;
}

function generarCodigoActivacion() {
  const ui = SpreadsheetApp.getUi();
  try {
    const fila = filaSeleccionada_('Usuarios');
    const h = hoja_('Usuarios');
    const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin 0/O ni 1/I para dictarlo sin errores
    let codigo = '';
    for (let i = 0; i < 8; i++) codigo += alfabeto[Math.floor(Math.random() * alfabeto.length)];
    h.getRange(fila, ESQUEMA.Usuarios.indexOf('codigo_activacion') + 1).setValue(codigo);
    const nombre = h.getRange(fila, ESQUEMA.Usuarios.indexOf('nombre') + 1).getValue();
    auditar_(Session.getActiveUser().getEmail(), 'codigo_activacion', nombre);
    ui.alert('Código para ' + nombre + ': ' + codigo + '\n\nSe usa una sola vez. Entréguelo en persona.');
  } catch (e) {
    ui.alert(String(e.message || e));
  }
}

function desactivarTelefonos() {
  const ui = SpreadsheetApp.getUi();
  try {
    const fila = filaSeleccionada_('Usuarios');
    const id = hoja_('Usuarios').getRange(fila, 1).getDisplayValue();
    let n = 0;
    tabla_('Dispositivos').forEach(function (d) {
      if (d.usuario_id === id && d.activo === 'SI') { actualizar_('Dispositivos', d.token_hash, { activo: 'NO' }); n++; }
    });
    auditar_(Session.getActiveUser().getEmail(), 'desactivar_telefonos', id);
    ui.alert(n + ' teléfono(s) desactivado(s) para el usuario ' + id + '.');
  } catch (e) {
    ui.alert(String(e.message || e));
  }
}

/**
 * Convierte el CSV de AS400 (importado con Archivo > Importar > Reemplazar hoja actual
 * en la pestaña Importar_Ordenes) a la pestaña Ordenes, según los nombres de columna de Config.
 */
function procesarOrdenesImportadas() {
  const ui = SpreadsheetApp.getUi();
  const h = hoja_('Importar_Ordenes');
  const datos = h.getDataRange().getDisplayValues();
  if (datos.length < 2) { ui.alert('La pestaña Importar_Ordenes está vacía.'); return; }
  const enc = datos[0].map(function (x) { return String(x).trim().toUpperCase(); });
  const c = config_();
  const col = function (clave, obligatoria) {
    const nombre = String(c[clave] || '').trim().toUpperCase();
    const i = nombre ? enc.indexOf(nombre) : -1;
    if (i < 0 && obligatoria) throw new Error('No encuentro la columna "' + nombre + '" (' + clave + ' en Config). Columnas del archivo: ' + enc.join(', '));
    return i;
  };
  try {
    const iOrden = col('CSV_ORDEN', true), iAfi = col('CSV_AFILIADO', true), iCod = col('CSV_MED_CODIGO', true),
      iNom = col('CSV_MED_NOMBRE', true), iCant = col('CSV_CANTIDAD', true), iDesde = col('CSV_DESDE', false),
      iHasta = col('CSV_HASTA', false), iCtrl = col('CSV_CONTROLADO', false), iRec = col('CSV_RECETA', false);
    const ahora = new Date().toISOString();
    const fecha = function (v) {
      const s = String(v || '').trim();
      let m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
      if (m) return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
      m = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
      if (m) return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
      m = s.match(/^(\d{4})(\d{2})(\d{2})$/); // formato AS400 AAAAMMDD
      if (m) return m[1] + '-' + m[2] + '-' + m[3];
      return s;
    };
    const filas = datos.slice(1).filter(function (f) { return f[iOrden] && f[iCod]; }).map(function (f) {
      const ctrl = iCtrl >= 0 ? String(f[iCtrl]).trim().toUpperCase() : '';
      return {
        orden_id: String(f[iOrden]).trim() + '|' + String(f[iCod]).trim(),
        codigo_afiliado: String(f[iAfi]).trim(), medicamento_codigo: String(f[iCod]).trim(), medicamento: String(f[iNom]).trim(),
        cantidad: String(f[iCant]).replace(',', '.').trim(), desde: iDesde >= 0 ? fecha(f[iDesde]) : '', hasta: iHasta >= 0 ? fecha(f[iHasta]) : '',
        controlado: ['S', 'SI', 'Y', '1', 'TRUE'].indexOf(ctrl) >= 0 ? 'SI' : 'NO', receta_especial: iRec >= 0 ? String(f[iRec]).trim() : '', importado: ahora
      };
    });
    const nuevos = agregar_('Ordenes', filas);
    auditar_(Session.getActiveUser().getEmail(), 'importar_ordenes', nuevos.length + ' nuevas de ' + filas.length);
    ui.alert('Órdenes procesadas: ' + nuevos.length + ' nuevas, ' + (filas.length - nuevos.length) + ' ya existían.');
  } catch (e) {
    ui.alert(String(e.message || e));
  }
}

/** Copia la hoja a la carpeta "Respaldos Visitas IESS" y conserva las 30 copias más recientes. */
function respaldoNocturno() {
  const nombreCarpeta = 'Respaldos Visitas IESS';
  const it = DriveApp.getFoldersByName(nombreCarpeta);
  const carpeta = it.hasNext() ? it.next() : DriveApp.createFolder(nombreCarpeta);
  const archivo = DriveApp.getFileById(libro_().getId());
  archivo.makeCopy('Respaldo ' + Utilities.formatDate(new Date(), 'America/Guayaquil', 'yyyy-MM-dd HHmm'), carpeta);
  const copias = [];
  const archivos = carpeta.getFiles();
  while (archivos.hasNext()) copias.push(archivos.next());
  copias.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
  copias.slice(30).forEach(function (f) { f.setTrashed(true); });
}
