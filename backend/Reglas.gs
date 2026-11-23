/**
 * Reglas antifraude y de calidad. Cada bandera resta puntos al puntaje de confianza
 * de la visita (0–100) y, según su severidad, abre una alerta.
 */

const BANDERAS = {
  fuera_geocerca: { peso: 40, severidad: 'alta' },
  velocidad_imposible: { peso: 40, severidad: 'alta' },
  foto_duplicada: { peso: 40, severidad: 'alta' },
  gps_estatico: { peso: 30, severidad: 'media' },
  coordenadas_repetidas: { peso: 30, severidad: 'media' },
  mismo_punto: { peso: 20, severidad: 'media' },
  qr_no_coincide: { peso: 20, severidad: 'media' },
  reloj_desfasado: { peso: 15, severidad: 'media' },
  gps_impreciso: { peso: 15, severidad: 'baja' },
  visita_corta: { peso: 15, severidad: 'media' },
  fuera_de_horario: { peso: 5, severidad: 'baja' }
};

function distanciaM_(lat1, lon1, lat2, lon2) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.asin(Math.sqrt(a));
}

function normalizarLote_(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
}

function hashUsado_(hash, idPropio) {
  if (!hash) return false;
  const tablas = [['Eventos', ['foto_hash', 'foto_medico_hash']], ['Entregas', ['foto_hash']], ['Actas', ['foto_hash']]];
  return tablas.some(function (t) {
    return tabla_(t[0]).some(function (f) {
      return f.id !== idPropio && t[1].some(function (c) { return f[c] === hash; });
    });
  });
}

/**
 * Procesa un evento de visita ya guardado: crea o actualiza la visita y evalúa banderas.
 * @param ev evento con campos extra: agenda_id, paciente_id, motivo
 * @param usuario usuario autenticado
 * @param desfaseS diferencia reloj servidor − reloj teléfono, en segundos
 */
function procesarEvento_(ev, usuario, desfaseS) {
  const banderas = [];
  const paciente = tabla_('Pacientes').find(function (p) { return p.id === String(ev.paciente_id); });
  const lat = parseFloat(ev.lat), lon = parseFloat(ev.lon), prec = parseFloat(ev.precision_m);
  const horaReal = new Date(new Date(ev.hora_tel).getTime() + desfaseS * 1000);
  let distancia = '';

  if (Math.abs(desfaseS) > num_('DESFASE_RELOJ_MIN', 5) * 60) banderas.push('reloj_desfasado');
  if (!(prec <= num_('PRECISION_MAX_M', 100))) banderas.push('gps_impreciso');

  if (paciente && !isNaN(lat)) {
    const pLat = parseFloat(paciente.lat), pLon = parseFloat(paciente.lon);
    if (isNaN(pLat) || isNaN(pLon)) {
      // Primera visita: el domicilio se registra con esta lectura, si es precisa.
      if (ev.tipo === 'inicio' && prec <= num_('PRECISION_MAX_M', 100)) {
        actualizar_('Pacientes', paciente.id, { lat: lat.toFixed(6), lon: lon.toFixed(6) });
        auditar_(usuario.id, 'domicilio_registrado', { paciente: paciente.id, lat: lat, lon: lon });
      }
    } else {
      distancia = Math.round(distanciaM_(lat, lon, pLat, pLon));
      const radio = Math.max(num_('GEOCERCA_M', 200), parseFloat(paciente.radio_m) || 0);
      if (distancia > radio) banderas.push('fuera_geocerca');
    }
    if (paciente.qr_codigo && String(ev.qr_ok) !== 'SI' && ev.tipo !== 'cierre') banderas.push('qr_no_coincide');
  }

  // Lecturas idénticas al séptimo decimal: señal típica de ubicación simulada.
  try {
    const lecturas = typeof ev.lecturas === 'string' ? JSON.parse(ev.lecturas || '[]') : (ev.lecturas || []);
    if (lecturas.length >= 3) {
      const unicas = new Set(lecturas.map(function (l) { return l.lat.toFixed(7) + ',' + l.lon.toFixed(7); }));
      const precisiones = new Set(lecturas.map(function (l) { return l.precision; }));
      if (unicas.size === 1 && precisiones.size === 1) banderas.push('gps_estatico');
    }
  } catch (e) { /* lecturas mal formadas: se ignoran */ }

  // Comparación con eventos anteriores del mismo usuario.
  const previos = tabla_('Eventos').filter(function (e) { return e.usuario_id === usuario.id && e.id !== ev.id && e.lat; });
  const hoy = fechaLocal_(horaReal);
  let anterior = null;
  previos.forEach(function (e) {
    const t = new Date(e.hora_real || e.hora_tel).getTime();
    if (t < horaReal.getTime() && (!anterior || t > anterior.t)) anterior = { e: e, t: t };
    if (e.lat === String(ev.lat) && e.lon === String(ev.lon) && e.visita_id !== ev.visita_id) {
      if (banderas.indexOf('coordenadas_repetidas') < 0) banderas.push('coordenadas_repetidas');
    }
  });
  if (anterior && !isNaN(lat)) {
    const horas = (horaReal.getTime() - anterior.t) / 3600000;
    const km = distanciaM_(lat, lon, parseFloat(anterior.e.lat), parseFloat(anterior.e.lon)) / 1000;
    if (horas > 0 && km > 1 && km / horas > num_('VELOCIDAD_MAX_KMH', 120)) banderas.push('velocidad_imposible');
  }
  if (ev.tipo === 'inicio' && !isNaN(lat)) {
    const mismoPunto = tabla_('Visitas').some(function (v) {
      if (v.medico_id !== usuario.id || v.id === ev.visita_id || v.paciente_id === String(ev.paciente_id)) return false;
      if (v.inicio.slice(0, 10) !== hoy) return false;
      const ini = tabla_('Eventos').find(function (e) { return e.visita_id === v.id && e.tipo === 'inicio'; });
      return ini && distanciaM_(lat, lon, parseFloat(ini.lat), parseFloat(ini.lon)) < num_('MISMO_PUNTO_M', 30);
    });
    if (mismoPunto) banderas.push('mismo_punto');
  }

  if (hashUsado_(ev.foto_hash, ev.id) || hashUsado_(ev.foto_medico_hash, ev.id)) banderas.push('foto_duplicada');

  const hhmm = Utilities.formatDate(horaReal, 'America/Guayaquil', 'HH:mm');
  if (hhmm < String(config_().HORA_INICIO || '07:00') || hhmm > String(config_().HORA_FIN || '19:00')) banderas.push('fuera_de_horario');

  actualizarVisita_(ev, usuario, horaReal, distancia, banderas);
  banderas.forEach(function (b) {
    const def = BANDERAS[b];
    if (def && def.severidad !== 'baja') crearAlerta_(b, def.severidad, ev.visita_id, usuario.id, 'Evento ' + ev.tipo);
  });
  return banderas;
}

function actualizarVisita_(ev, usuario, horaReal, distancia, banderasNuevas) {
  const local = fechaLocal_(horaReal) + ' ' + horaLocal_(horaReal);
  const existente = tabla_('Visitas').find(function (v) { return v.id === String(ev.visita_id); });
  if (!existente) {
    agregar_('Visitas', [{
      id: ev.visita_id, agenda_id: ev.agenda_id || '', medico_id: usuario.id, paciente_id: ev.paciente_id || '',
      estado: ev.tipo === 'fallida' ? 'fallida' : 'en curso', inicio: local, cierre: ev.tipo === 'fallida' ? local : '',
      duracion_min: '', distancia_inicio_m: distancia, puntaje: '', banderas: '', motivo_fallida: ev.motivo || '', actualizado: local
    }]);
  }
  const v = tabla_('Visitas').find(function (x) { return x.id === String(ev.visita_id); });
  const todas = (v.banderas ? v.banderas.split(',') : []).concat(banderasNuevas).filter(function (b, i, a) { return b && a.indexOf(b) === i; });
  const cambios = { actualizado: local };

  if (ev.tipo === 'cierre') {
    const inicio = new Date(v.inicio.replace(' ', 'T') + '-05:00');
    const min = Math.round((horaReal.getTime() - inicio.getTime()) / 60000);
    cambios.cierre = local;
    cambios.duracion_min = min;
    cambios.estado = 'realizada';
    if (min < num_('VISITA_MIN_MIN', 5) && todas.indexOf('visita_corta') < 0) {
      todas.push('visita_corta');
      crearAlerta_('visita_corta', 'media', ev.visita_id, usuario.id, min + ' min');
    }
    if (Math.random() < num_('MUESTREO_LLAMADAS', 0.1)) marcarLlamada_(ev.visita_id);
  }
  if (ev.tipo === 'fallida') {
    cambios.estado = 'fallida';
    cambios.motivo_fallida = ev.motivo || '';
  }
  if (ev.tipo === 'inicio' && distancia !== '') cambios.distancia_inicio_m = distancia;

  cambios.banderas = todas.join(',');
  cambios.puntaje = Math.max(0, 100 - todas.reduce(function (s, b) { return s + ((BANDERAS[b] && BANDERAS[b].peso) || 0); }, 0));
  actualizar_('Visitas', ev.visita_id, cambios);
  if (ev.agenda_id) actualizar_('Agenda', ev.agenda_id, { estado: cambios.estado || v.estado });
  if (todas.some(function (b) { return BANDERAS[b] && BANDERAS[b].severidad === 'alta'; })) marcarLlamada_(ev.visita_id);
}

function marcarLlamada_(visitaId) {
  const ya = tabla_('Llamadas').some(function (l) { return l.visita_id === String(visitaId); });
  if (!ya) agregar_('Llamadas', [{ visita_id: visitaId, fecha: fechaLocal_(new Date()), resultado: 'pendiente' }]);
}

/** Valida una entrega contra lo preparado y la orden. */
function procesarEntrega_(en, usuario, hoy) {
  const prep = tabla_('Preparaciones').find(function (p) { return p.id === String(en.preparacion_id); });
  const alertas = [];
  if (!prep) {
    crearAlerta_('entrega_sin_preparacion', 'alta', en.visita_id, usuario.id, String(en.medicamento_codigo));
    return;
  }
  const ok = normalizarLote_(en.lote_leido) === normalizarLote_(prep.lote);
  actualizar_('Entregas', en.id, { lote_ok: ok ? 'SI' : 'NO' });
  if (!ok) alertas.push(['lote_distinto', 'alta', 'Leído ' + en.lote_leido + ' / preparado ' + prep.lote]);
  if (en.venc_leido && String(en.venc_leido) < hoy) alertas.push(['producto_vencido', 'crítica', String(en.venc_leido)]);
  if (Number(en.cantidad) > Number(prep.cantidad)) alertas.push(['cantidad_excedida', 'alta', en.cantidad + ' > ' + prep.cantidad]);

  // Entrega repetida: lo ya entregado de esa orden supera lo autorizado.
  const orden = tabla_('Ordenes').find(function (o) { return o.orden_id === String(prep.orden_id) && o.medicamento_codigo === String(prep.medicamento_codigo); });
  if (orden) {
    const entregado = tabla_('Entregas').filter(function (e) {
      return e.orden_id === String(prep.orden_id) && e.medicamento_codigo === String(prep.medicamento_codigo);
    }).reduce(function (s, e) { return s + Number(e.cantidad || 0); }, 0);
    if (entregado > Number(orden.cantidad)) alertas.push(['entrega_repetida', 'alta', entregado + ' entregadas de ' + orden.cantidad + ' autorizadas']);
  }
  if (prep.controlado === 'SI') alertas.forEach(function (a) { a[1] = 'crítica'; });
  alertas.forEach(function (a) { crearAlerta_(a[0], a[1], en.visita_id, usuario.id, a[2]); });

  agregar_('Movimientos', [{
    id: 'M-' + en.id, fecha: hoy, medico_id: usuario.id, tipo: 'entrega', bolsa_id: prep.bolsa_id, preparacion_id: prep.id,
    medicamento_codigo: prep.medicamento_codigo, lote: prep.lote, cantidad: en.cantidad, visita_id: en.visita_id,
    registrado_por: usuario.id, creado: new Date().toISOString()
  }]);
  actualizar_('Bolsas', prep.bolsa_id, { estado: 'entregada' });
}

/** Si la visita incluyó controlados, el receptor debe estar autorizado. */
function procesarActa_(acta, usuario) {
  const visita = tabla_('Visitas').find(function (v) { return v.id === String(acta.visita_id); });
  const pacienteId = visita ? visita.paciente_id : acta.paciente_id;
  const paciente = tabla_('Pacientes').find(function (p) { return p.id === String(pacienteId); });
  const cedula = String(acta.receptor_cedula || '').replace(/\D/g, '');
  const esPaciente = paciente && String(paciente.codigo_afiliado).replace(/\D/g, '') === cedula;
  const cuidador = tabla_('Cuidadores').find(function (c) {
    return c.paciente_id === String(pacienteId) && String(c.cedula).replace(/\D/g, '') === cedula;
  });
  const autorizadoControlados = esPaciente || (cuidador && cuidador.autorizado_controlados === 'SI');
  actualizar_('Actas', acta.id, { receptor_autorizado: esPaciente ? 'PACIENTE' : (cuidador ? 'CUIDADOR' : 'NO REGISTRADO') });

  if (hashUsado_(acta.foto_hash, acta.id)) crearAlerta_('foto_duplicada', 'alta', acta.visita_id, usuario.id, 'Foto de entrega');
  const llevaControlados = tabla_('Entregas').some(function (e) {
    if (e.visita_id !== String(acta.visita_id)) return false;
    const p = tabla_('Preparaciones').find(function (x) { return x.id === e.preparacion_id; });
    return p && p.controlado === 'SI';
  });
  if (llevaControlados && !autorizadoControlados) {
    crearAlerta_('receptor_no_autorizado_controlados', 'crítica', acta.visita_id, usuario.id, 'Parentesco: ' + acta.parentesco);
  }
}

/** Revisión cada 15 minutos: visitas abiertas demasiado tiempo y teléfonos sin sincronizar. */
function reglasPeriodicas() {
  const ahora = new Date();
  const maxH = num_('VISITA_MAX_H', 4);
  tabla_('Visitas').forEach(function (v) {
    if (v.estado !== 'en curso') return;
    const ini = new Date(v.inicio.replace(' ', 'T') + '-05:00');
    if ((ahora - ini) / 3600000 > maxH) crearAlerta_('visita_abierta', 'media', v.id, v.medico_id, 'Iniciada ' + v.inicio);
  });
  const sinSyncH = num_('SIN_SYNC_H', 24);
  const hoy = fechaLocal_(ahora);
  const conAgenda = new Set(tabla_('Agenda').filter(function (a) { return a.fecha <= hoy; }).map(function (a) { return a.medico_id; }));
  tabla_('Dispositivos').forEach(function (d) {
    if (d.activo !== 'SI' || !d.ultimo_sync || !conAgenda.has(d.usuario_id)) return;
    if ((ahora - new Date(d.ultimo_sync)) / 3600000 > sinSyncH) {
      crearAlerta_('sin_sincronizar', 'media', '', d.usuario_id, 'Último envío ' + d.ultimo_sync);
    }
  });
}

/** Cierre del día: cuadre del maletín por preparación (retiro − entrega − devolución). */
function cuadreDiario() {
  const hoy = fechaLocal_(new Date());
  const movs = tabla_('Movimientos').filter(function (m) { return m.fecha === hoy; });
  const saldo = {};
  movs.forEach(function (m) {
    const k = m.preparacion_id;
    if (!saldo[k]) saldo[k] = { retiro: 0, entrega: 0, devolucion: 0, medico: m.medico_id };
    saldo[k][m.tipo] = (saldo[k][m.tipo] || 0) + Number(m.cantidad || 0);
  });
  Object.keys(saldo).forEach(function (k) {
    const s = saldo[k];
    const dif = s.retiro - s.entrega - s.devolucion;
    if (dif !== 0) {
      const prep = tabla_('Preparaciones').find(function (p) { return p.id === k; });
      const sev = prep && prep.controlado === 'SI' ? 'crítica' : 'alta';
      crearAlerta_('descuadre_maletin', sev, '', s.medico, 'Preparación ' + k + ': diferencia ' + dif);
    }
  });
  resumenDiario_();
}

/** Reporte de ingresos, egresos y saldos de controlados (para farmacia). */
function generarReporteControlados() {
  const prepCtrl = {};
  tabla_('Preparaciones').forEach(function (p) { if (p.controlado === 'SI') prepCtrl[p.id] = p; });
  const filas = {};
  tabla_('Movimientos').forEach(function (m) {
    const p = prepCtrl[m.preparacion_id];
    if (!p) return;
    const k = m.fecha + '|' + p.medicamento_codigo + '|' + p.lote;
    if (!filas[k]) filas[k] = [m.fecha, p.medicamento_codigo, p.medicamento, p.lote, p.receta_especial, 0, 0, 0];
    if (m.tipo === 'retiro') filas[k][5] += Number(m.cantidad);
    if (m.tipo === 'entrega') filas[k][6] += Number(m.cantidad);
    if (m.tipo === 'devolucion') filas[k][7] += Number(m.cantidad);
  });
  const libro = libro_();
  let h = libro.getSheetByName('Reporte_Controlados');
  if (!h) h = libro.insertSheet('Reporte_Controlados');
  h.clear();
  const datos = [['fecha', 'medicamento_codigo', 'medicamento', 'lote', 'receta_especial', 'salida_farmacia', 'entregado', 'devuelto', 'saldo']]
    .concat(Object.keys(filas).sort().map(function (k) { const f = filas[k]; return f.concat([f[5] - f[6] - f[7]]); }));
  h.getRange(1, 1, datos.length, datos[0].length).setValues(datos);
  h.getRange(1, 1, 1, datos[0].length).setFontWeight('bold');
}
