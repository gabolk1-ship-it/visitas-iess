/**
 * Estructura de la hoja de cálculo: una pestaña por tabla.
 * La primera columna de cada pestaña es siempre el identificador único.
 */
const ESQUEMA = {
  Config: ['clave', 'valor', 'descripcion'],
  Usuarios: ['id', 'nombre', 'correo', 'rol', 'codigo_activacion', 'activo'],
  Dispositivos: ['token_hash', 'usuario_id', 'plataforma', 'modelo', 'creado', 'ultimo_sync', 'activo'],
  Pacientes: ['id', 'codigo_afiliado', 'nombre', 'sector', 'direccion', 'lat', 'lon', 'radio_m', 'qr_codigo', 'telefono_contacto'],
  Cuidadores: ['id', 'paciente_id', 'nombre', 'cedula', 'parentesco', 'autorizado_controlados'],
  Agenda: ['id', 'fecha', 'medico_id', 'paciente_id', 'ventana', 'estado'],
  Ordenes: ['orden_id', 'codigo_afiliado', 'medicamento_codigo', 'medicamento', 'cantidad', 'desde', 'hasta', 'controlado', 'receta_especial', 'importado'],
  Bolsas: ['id', 'fecha', 'medico_id', 'paciente_id', 'estado', 'foto_key', 'foto_llave', 'foto_hash', 'preparado_por', 'creado'],
  Preparaciones: ['id', 'bolsa_id', 'orden_id', 'medicamento_codigo', 'medicamento', 'lote', 'vencimiento', 'cantidad', 'controlado', 'receta_especial', 'receta_foto_key', 'receta_foto_llave', 'foto_key', 'foto_llave', 'foto_hash', 'ocr_confirmado', 'creado'],
  Movimientos: ['id', 'fecha', 'medico_id', 'tipo', 'bolsa_id', 'preparacion_id', 'medicamento_codigo', 'lote', 'cantidad', 'visita_id', 'registrado_por', 'firma_key', 'firma_llave', 'creado'],
  Visitas: ['id', 'agenda_id', 'medico_id', 'paciente_id', 'estado', 'inicio', 'cierre', 'duracion_min', 'distancia_inicio_m', 'puntaje', 'banderas', 'motivo_fallida', 'actualizado'],
  Eventos: ['id', 'visita_id', 'tipo', 'lat', 'lon', 'precision_m', 'lecturas', 'hora_tel', 'hora_real', 'hora_servidor', 'desfase_s', 'qr_ok', 'foto_key', 'foto_llave', 'foto_hash', 'foto_medico_key', 'foto_medico_llave', 'foto_medico_hash', 'usuario_id', 'dispositivo'],
  Entregas: ['id', 'visita_id', 'paciente_id', 'bolsa_id', 'preparacion_id', 'orden_id', 'medicamento_codigo', 'lote_leido', 'venc_leido', 'lote_ok', 'cantidad', 'motivo', 'foto_key', 'foto_llave', 'foto_hash', 'ocr_confirmado', 'creado'],
  Actas: ['id', 'visita_id', 'receptor_nombre', 'receptor_cedula', 'parentesco', 'receptor_autorizado', 'firma_key', 'firma_llave', 'foto_key', 'foto_llave', 'foto_hash', 'creado'],
  Alertas: ['id', 'creada', 'tipo', 'severidad', 'visita_id', 'usuario_id', 'detalle', 'estado', 'responsable', 'justificacion'],
  Llamadas: ['visita_id', 'fecha', 'resultado', 'observacion', 'quien'],
  Auditoria: ['fecha', 'usuario_id', 'accion', 'detalle'],
  Importar_Ordenes: []
};

/** Valores por defecto de la pestaña Config (umbrales y nombres de columnas del CSV de AS400). */
const CONFIG_INICIAL = [
  ['GEOCERCA_M', 200, 'Distancia máxima al domicilio (metros)'],
  ['PRECISION_MAX_M', 100, 'Precisión GPS mínima aceptable (metros)'],
  ['VELOCIDAD_MAX_KMH', 120, 'Velocidad máxima creíble entre dos eventos'],
  ['VISITA_MIN_MIN', 5, 'Duración mínima de una visita (minutos)'],
  ['VISITA_MAX_H', 4, 'Horas máximas con una visita abierta'],
  ['DESFASE_RELOJ_MIN', 5, 'Diferencia máxima entre reloj del teléfono y servidor (minutos)'],
  ['SIN_SYNC_H', 24, 'Horas sin sincronizar antes de alertar'],
  ['MISMO_PUNTO_M', 30, 'Distancia para considerar "mismo punto" entre pacientes distintos'],
  ['HORA_INICIO', '07:00', 'Inicio del horario laboral'],
  ['HORA_FIN', '19:00', 'Fin del horario laboral'],
  ['MUESTREO_LLAMADAS', 0.1, 'Fracción de visitas que se marcan para llamada de verificación'],
  ['CORREO_ALERTAS', '', 'Correos que reciben alertas (separados por coma)'],
  ['LLAVE_PUBLICA', '', 'Llave pública de supervisión (JWK). La genera tools/generar-llaves.html'],
  ['LLAVE_PRIVADA_CIFRADA', '', 'Llave privada cifrada con la frase secreta de supervisión'],
  ['CSV_ORDEN', 'ORDEN', 'Nombre de columna en el CSV de AS400: número de orden'],
  ['CSV_AFILIADO', 'AFILIADO', 'Columna: código o cédula del afiliado'],
  ['CSV_MED_CODIGO', 'COD_MEDICAMENTO', 'Columna: código del medicamento'],
  ['CSV_MED_NOMBRE', 'MEDICAMENTO', 'Columna: nombre del medicamento'],
  ['CSV_CANTIDAD', 'CANTIDAD', 'Columna: cantidad autorizada'],
  ['CSV_DESDE', 'FECHA_DESDE', 'Columna: inicio de vigencia'],
  ['CSV_HASTA', 'FECHA_HASTA', 'Columna: fin de vigencia'],
  ['CSV_CONTROLADO', 'CONTROLADO', 'Columna: S/N si es psicotrópico o estupefaciente (vacío si no existe)'],
  ['CSV_RECETA', 'RECETA_ESPECIAL', 'Columna: número de receta especial (vacío si no existe)']
];

const OPCIONES_ESTADO_ALERTA = ['abierta', 'en revisión', 'justificada', 'confirmada'];

function libro_() {
  return SpreadsheetApp.getActive();
}

function hoja_(nombre) {
  const h = libro_().getSheetByName(nombre);
  if (!h) throw new Error('Falta la pestaña ' + nombre + '. Ejecute "Configurar hojas".');
  return h;
}

/** Crea las pestañas que falten, con encabezados, sin tocar las que ya existen. */
function configurarHojas() {
  const libro = libro_();
  Object.keys(ESQUEMA).forEach(function (nombre) {
    let h = libro.getSheetByName(nombre);
    const cols = ESQUEMA[nombre];
    if (!h) {
      h = libro.insertSheet(nombre);
      if (cols.length) {
        h.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
        h.setFrozenRows(1);
        // Texto plano en todo: evita que Sheets convierta cédulas, lotes o fechas.
        h.getRange(1, 1, h.getMaxRows(), cols.length).setNumberFormat('@');
      }
    }
  });
  const conf = libro.getSheetByName('Config');
  if (conf.getLastRow() < 2) {
    conf.getRange(2, 1, CONFIG_INICIAL.length, 3).setValues(CONFIG_INICIAL);
  }
  const alertas = libro.getSheetByName('Alertas');
  const regla = SpreadsheetApp.newDataValidation().requireValueInList(OPCIONES_ESTADO_ALERTA, true).build();
  alertas.getRange(2, ESQUEMA.Alertas.indexOf('estado') + 1, alertas.getMaxRows() - 1, 1).setDataValidation(regla);
  const roles = SpreadsheetApp.newDataValidation().requireValueInList(['medico', 'farmacia', 'supervisor', 'admin'], true).build();
  const usuarios = libro.getSheetByName('Usuarios');
  usuarios.getRange(2, ESQUEMA.Usuarios.indexOf('rol') + 1, usuarios.getMaxRows() - 1, 1).setDataValidation(roles);
  const hoja1 = libro.getSheetByName('Hoja 1') || libro.getSheetByName('Sheet1');
  if (hoja1 && hoja1.getLastRow() === 0 && libro.getSheets().length > 1) libro.deleteSheet(hoja1);
}

/** Lee una pestaña completa como lista de objetos {encabezado: valor}. Cachea por ejecución. */
const CACHE_TABLAS_ = {};
function tabla_(nombre) {
  if (CACHE_TABLAS_[nombre]) return CACHE_TABLAS_[nombre];
  const h = hoja_(nombre);
  const cols = ESQUEMA[nombre];
  const n = h.getLastRow() - 1;
  const filas = n > 0 ? h.getRange(2, 1, n, cols.length).getDisplayValues() : [];
  const datos = filas.map(function (f, i) {
    const o = { _fila: i + 2 };
    cols.forEach(function (c, j) { o[c] = f[j]; });
    return o;
  });
  CACHE_TABLAS_[nombre] = datos;
  return datos;
}

function invalidar_(nombre) {
  delete CACHE_TABLAS_[nombre];
}

/** Conjunto de identificadores existentes (primera columna). */
function ids_(nombre) {
  const h = hoja_(nombre);
  const n = h.getLastRow() - 1;
  if (n <= 0) return new Set();
  return new Set(h.getRange(2, 1, n, 1).getDisplayValues().map(function (f) { return f[0]; }));
}

/** Agrega filas a partir de objetos; ignora las que ya existen por id. Devuelve los ids agregados. */
function agregar_(nombre, objetos) {
  if (!objetos || !objetos.length) return [];
  const cols = ESQUEMA[nombre];
  const existentes = ids_(nombre);
  const nuevos = objetos.filter(function (o) { return o[cols[0]] && !existentes.has(String(o[cols[0]])); });
  if (!nuevos.length) return [];
  const filas = nuevos.map(function (o) {
    return cols.map(function (c) {
      const v = o[c];
      if (v === undefined || v === null) return '';
      if (typeof v === 'object') return JSON.stringify(v);
      return String(v);
    });
  });
  const h = hoja_(nombre);
  h.getRange(h.getLastRow() + 1, 1, filas.length, cols.length).setNumberFormat('@').setValues(filas);
  invalidar_(nombre);
  return nuevos.map(function (o) { return String(o[cols[0]]); });
}

/** Actualiza columnas de una fila identificada por id. */
function actualizar_(nombre, id, cambios) {
  const fila = tabla_(nombre).find(function (o) { return o[ESQUEMA[nombre][0]] === String(id); });
  if (!fila) return false;
  const h = hoja_(nombre);
  Object.keys(cambios).forEach(function (c) {
    const j = ESQUEMA[nombre].indexOf(c);
    if (j >= 0) h.getRange(fila._fila, j + 1).setNumberFormat('@').setValue(String(cambios[c] === null || cambios[c] === undefined ? '' : cambios[c]));
  });
  invalidar_(nombre);
  return true;
}

function config_() {
  if (CACHE_TABLAS_._config) return CACHE_TABLAS_._config;
  const c = {};
  tabla_('Config').forEach(function (f) { c[f.clave] = f.valor; });
  CACHE_TABLAS_._config = c;
  return c;
}

function num_(clave, defecto) {
  const v = parseFloat(String(config_()[clave]).replace(',', '.'));
  return isNaN(v) ? defecto : v;
}

function auditar_(usuarioId, accion, detalle) {
  hoja_('Auditoria').appendRow([new Date().toISOString(), usuarioId || '', accion, typeof detalle === 'string' ? detalle : JSON.stringify(detalle)]);
}
