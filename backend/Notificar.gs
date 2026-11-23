/**
 * Alertas: se guardan en la pestaña Alertas y, si son altas o críticas,
 * se avisa por Telegram (sin datos personales) y por correo institucional.
 *
 * Propiedades del script: TELEGRAM_TOKEN, TELEGRAM_CHAT_ID (opcionales)
 */

const SEVERIDAD_INMEDIATA = ['alta', 'crítica'];

function crearAlerta_(tipo, severidad, visitaId, usuarioId, detalle) {
  // No duplica la misma alerta abierta para la misma visita/usuario en el mismo día.
  const hoy = fechaLocal_(new Date());
  const repetida = tabla_('Alertas').some(function (a) {
    return a.tipo === tipo && a.visita_id === String(visitaId || '') && a.usuario_id === String(usuarioId || '') &&
      a.creada.slice(0, 10) === hoy && a.estado !== 'justificada';
  });
  if (repetida) return null;
  const id = 'A-' + Utilities.getUuid().slice(0, 8).toUpperCase();
  agregar_('Alertas', [{
    id: id, creada: hoy + ' ' + horaLocal_(new Date()), tipo: tipo, severidad: severidad,
    visita_id: visitaId || '', usuario_id: usuarioId || '', detalle: detalle || '', estado: 'abierta'
  }]);
  if (SEVERIDAD_INMEDIATA.indexOf(severidad) >= 0) {
    avisarTelegram_('Alerta ' + severidad + ' ' + id + ': ' + tipo.replace(/_/g, ' ') + '. Revisar la hoja de seguimiento.');
    avisarCorreo_('[Visitas IESS] Alerta ' + severidad + ' ' + id,
      'Tipo: ' + tipo + '\nSeveridad: ' + severidad + '\nVisita: ' + (visitaId || '-') + '\nUsuario: ' + (usuarioId || '-') +
      '\nDetalle: ' + (detalle || '-') + '\n\nRevise y actualice el estado en la pestaña Alertas.');
  }
  return id;
}

function avisarTelegram_(texto) {
  const p = PropertiesService.getScriptProperties();
  const token = p.getProperty('TELEGRAM_TOKEN');
  const chat = p.getProperty('TELEGRAM_CHAT_ID');
  if (!token || !chat) return;
  try {
    UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      payload: JSON.stringify({ chat_id: chat, text: texto })
    });
  } catch (e) {
    console.error('Telegram: ' + e);
  }
}

function avisarCorreo_(asunto, cuerpo) {
  const dest = String(config_().CORREO_ALERTAS || '').trim();
  if (!dest) return;
  try {
    MailApp.sendEmail(dest, asunto, cuerpo);
  } catch (e) {
    console.error('Correo: ' + e);
  }
}

/** Resumen diario por correo (lo llama el activador de la noche). */
function resumenDiario_() {
  const hoy = fechaLocal_(new Date());
  const visitas = tabla_('Visitas').filter(function (v) { return v.inicio.slice(0, 10) === hoy || v.actualizado.slice(0, 10) === hoy; });
  const alertas = tabla_('Alertas').filter(function (a) { return a.creada.slice(0, 10) === hoy; });
  const porSev = {};
  alertas.forEach(function (a) { porSev[a.severidad] = (porSev[a.severidad] || 0) + 1; });
  const realizadas = visitas.filter(function (v) { return v.estado === 'realizada'; }).length;
  const fallidas = visitas.filter(function (v) { return v.estado === 'fallida'; }).length;
  const confiables = visitas.filter(function (v) { return Number(v.puntaje) >= 80; }).length;
  avisarCorreo_('[Visitas IESS] Resumen ' + hoy,
    'Visitas realizadas: ' + realizadas + '\nVisitas fallidas: ' + fallidas +
    '\nVisitas con puntaje ≥ 80: ' + confiables + ' de ' + visitas.length +
    '\nAlertas nuevas: ' + alertas.length + ' ' + JSON.stringify(porSev) +
    '\n\nDetalle en la hoja de seguimiento.');
}

function fechaLocal_(d) {
  return Utilities.formatDate(d, 'America/Guayaquil', 'yyyy-MM-dd');
}

function horaLocal_(d) {
  return Utilities.formatDate(d, 'America/Guayaquil', 'HH:mm:ss');
}
