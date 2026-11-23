/**
 * API v1 de Visitas IESS. Un solo punto de entrada (doPost) que recibe
 * { accion, token, datos, reloj } como texto JSON y responde JSON.
 * Se usa Content-Type text/plain desde la app para evitar la verificación previa de CORS.
 */

const VERSION_API = '1.0.0';

function doGet() {
  return json_({ ok: true, servicio: 'visitas-iess', version: VERSION_API });
}

function doPost(e) {
  let peticion;
  try {
    peticion = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'Petición mal formada' });
  }
  try {
    const accion = peticion.accion;
    if (accion === 'activar') return json_(conBloqueo_(function () { return activar_(peticion.datos || {}); }));
    const usuario = autenticar_(peticion.token);
    const datos = peticion.datos || {};
    const rutas = {
      config: function () { return { ok: true, config: configPublica_(usuario) }; },
      agenda: function () { return agendaMedico_(usuario, datos); },
      farmacia_dia: function () { exigirRol_(usuario, ['farmacia', 'admin']); return farmaciaDia_(datos); },
      sync: function () { return conBloqueo_(function () { return sincronizar_(usuario, datos, peticion.reloj); }); },
      firmar: function () { return firmarR2_(usuario, datos); },
      visor: function () { exigirRol_(usuario, ['supervisor', 'admin']); return visor_(datos); }
    };
    if (!rutas[accion]) return json_({ ok: false, error: 'Acción desconocida' });
    return json_(rutas[accion]());
  } catch (err) {
    console.error(err && err.stack || err);
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function conBloqueo_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function exigirRol_(usuario, roles) {
  if (roles.indexOf(usuario.rol) < 0) throw new Error('Sin permiso para esta acción');
}

function autenticar_(token) {
  if (!token) throw new Error('Falta token');
  const hash = sha256Hex_(String(token));
  const disp = tabla_('Dispositivos').find(function (d) { return d.token_hash === hash && d.activo === 'SI'; });
  if (!disp) throw new Error('Teléfono no autorizado');
  const u = tabla_('Usuarios').find(function (x) { return x.id === disp.usuario_id && x.activo === 'SI'; });
  if (!u) throw new Error('Usuario inactivo');
  return { id: u.id, nombre: u.nombre, rol: u.rol, dispositivo: hash.slice(0, 12), _disp: disp };
}

function activar_(d) {
  const codigo = String(d.codigo || '').trim().toUpperCase();
  if (codigo.length < 6) return { ok: false, error: 'Código inválido' };
  const u = tabla_('Usuarios').find(function (x) { return x.codigo_activacion.toUpperCase() === codigo && x.activo === 'SI'; });
  if (!u) return { ok: false, error: 'Código inválido o ya usado' };
  const activos = tabla_('Dispositivos').filter(function (x) { return x.usuario_id === u.id && x.activo === 'SI'; });
  if (activos.length >= 2) return { ok: false, error: 'El usuario ya tiene 2 teléfonos activos. Pida al administrador que desactive uno.' };
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  agregar_('Dispositivos', [{
    token_hash: sha256Hex_(token), usuario_id: u.id, plataforma: String(d.plataforma || '').slice(0, 60),
    modelo: String(d.modelo || '').slice(0, 120), creado: new Date().toISOString(), ultimo_sync: new Date().toISOString(), activo: 'SI'
  }]);
  actualizar_('Usuarios', u.id, { codigo_activacion: '' });
  auditar_(u.id, 'activar_telefono', d.plataforma);
  const usuario = { id: u.id, nombre: u.nombre, rol: u.rol };
  return { ok: true, token: token, usuario: usuario, config: configPublica_(usuario) };
}

function configPublica_(usuario) {
  const c = config_();
  return {
    version: VERSION_API,
    usuario: { id: usuario.id, nombre: usuario.nombre, rol: usuario.rol },
    geocercaM: num_('GEOCERCA_M', 200),
    precisionMaxM: num_('PRECISION_MAX_M', 100),
    visitaMinMin: num_('VISITA_MIN_MIN', 5),
    llavePublica: c.LLAVE_PUBLICA ? JSON.parse(c.LLAVE_PUBLICA) : null
  };
}

function hoyLocal_(fecha) {
  return fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : fechaLocal_(new Date());
}

function ordenesVigentes_(codigoAfiliado, fecha) {
  return tabla_('Ordenes').filter(function (o) {
    return o.codigo_afiliado === String(codigoAfiliado) && (!o.desde || o.desde <= fecha) && (!o.hasta || o.hasta >= fecha);
  }).map(function (o) {
    return { orden_id: o.orden_id, medicamento_codigo: o.medicamento_codigo, medicamento: o.medicamento, cantidad: Number(o.cantidad), controlado: o.controlado === 'SI', receta_especial: o.receta_especial };
  });
}

function pacientePublico_(p) {
  return {
    id: p.id, codigo_afiliado: p.codigo_afiliado, nombre: p.nombre, sector: p.sector, direccion: p.direccion,
    lat: p.lat ? Number(p.lat) : null, lon: p.lon ? Number(p.lon) : null, radio_m: Number(p.radio_m) || null,
    qr_codigo: p.qr_codigo || null, telefono_contacto: p.telefono_contacto
  };
}

function bolsasDe_(filtro) {
  const preps = tabla_('Preparaciones');
  return tabla_('Bolsas').filter(filtro).map(function (b) {
    return {
      id: b.id, fecha: b.fecha, medico_id: b.medico_id, paciente_id: b.paciente_id, estado: b.estado,
      items: preps.filter(function (p) { return p.bolsa_id === b.id; }).map(function (p) {
        return { id: p.id, orden_id: p.orden_id, medicamento_codigo: p.medicamento_codigo, medicamento: p.medicamento, lote: p.lote, vencimiento: p.vencimiento, cantidad: Number(p.cantidad), controlado: p.controlado === 'SI' };
      })
    };
  });
}

/** Agenda del médico para una fecha, con pacientes, receptores autorizados y bolsas preparadas. */
function agendaMedico_(usuario, d) {
  const fecha = hoyLocal_(d.fecha);
  const medicoId = usuario.rol === 'medico' ? usuario.id : String(d.medico_id || usuario.id);
  const agenda = tabla_('Agenda').filter(function (a) { return a.fecha === fecha && a.medico_id === medicoId; });
  const idsPac = new Set(agenda.map(function (a) { return a.paciente_id; }));
  const pacientes = tabla_('Pacientes').filter(function (p) { return idsPac.has(p.id); }).map(pacientePublico_);
  const cuidadores = tabla_('Cuidadores').filter(function (c) { return idsPac.has(c.paciente_id); }).map(function (c) {
    return { id: c.id, paciente_id: c.paciente_id, nombre: c.nombre, cedula: c.cedula, parentesco: c.parentesco, autorizado_controlados: c.autorizado_controlados === 'SI' };
  });
  const bolsas = bolsasDe_(function (b) { return b.medico_id === medicoId && b.fecha === fecha && idsPac.has(b.paciente_id); });
  return {
    ok: true, fecha: fecha,
    agenda: agenda.map(function (a) { return { id: a.id, paciente_id: a.paciente_id, ventana: a.ventana, estado: a.estado }; }),
    pacientes: pacientes, cuidadores: cuidadores, bolsas: bolsas
  };
}

/** Datos para que farmacia prepare las bolsas de un médico en una fecha. */
function farmaciaDia_(d) {
  const fecha = hoyLocal_(d.fecha);
  const medicos = tabla_('Usuarios').filter(function (u) { return u.rol === 'medico' && u.activo === 'SI'; })
    .map(function (u) { return { id: u.id, nombre: u.nombre }; });
  if (!d.medico_id) return { ok: true, fecha: fecha, medicos: medicos };
  const agenda = tabla_('Agenda').filter(function (a) { return a.fecha === fecha && a.medico_id === String(d.medico_id); });
  const idsPac = new Set(agenda.map(function (a) { return a.paciente_id; }));
  const pacientes = tabla_('Pacientes').filter(function (p) { return idsPac.has(p.id); }).map(function (p) {
    const pub = pacientePublico_(p);
    pub.ordenes = ordenesVigentes_(p.codigo_afiliado, fecha);
    return pub;
  });
  const bolsas = bolsasDe_(function (b) { return b.medico_id === String(d.medico_id) && b.fecha === fecha; });
  return { ok: true, fecha: fecha, medicos: medicos, agenda: agenda, pacientes: pacientes, bolsas: bolsas };
}

/**
 * Recibe un lote de registros creados sin conexión. Cada registro trae su propio id (UUID);
 * si ya existe se ignora, así un reenvío nunca duplica.
 */
function sincronizar_(usuario, lote, relojTelefono) {
  const ahora = new Date();
  const desfaseS = relojTelefono ? Math.round((ahora.getTime() - new Date(relojTelefono).getTime()) / 1000) : 0;
  const hoy = fechaLocal_(ahora);
  const aceptados = {};
  const rechazados = [];
  const marcar = function (tabla, ids) { aceptados[tabla] = (aceptados[tabla] || []).concat(ids); };

  // 1. Farmacia: bolsas y preparaciones.
  if ((lote.bolsas || []).length || (lote.preparaciones || []).length) {
    if (['farmacia', 'admin'].indexOf(usuario.rol) < 0) throw new Error('Solo farmacia registra preparaciones');
    agregar_('Bolsas', (lote.bolsas || []).map(function (b) {
      return Object.assign({}, b, { estado: 'preparada', preparado_por: usuario.id, creado: ahora.toISOString() });
    }));
    marcar('bolsas', (lote.bolsas || []).map(function (b) { return b.id; }));
    agregar_('Preparaciones', (lote.preparaciones || []).map(function (p) {
      return Object.assign({}, p, { controlado: p.controlado ? 'SI' : 'NO', ocr_confirmado: p.ocr_confirmado ? 'SI' : 'NO', creado: ahora.toISOString() });
    }));
    marcar('preparaciones', (lote.preparaciones || []).map(function (p) { return p.id; }));
  }

  // 2. Movimientos de maletín: retiro (médico) y devolución (farmacia).
  (lote.movimientos || []).forEach(function (m) {
    if (m.tipo === 'retiro' && usuario.rol !== 'medico' && usuario.rol !== 'admin') { rechazados.push({ id: m.id, motivo: 'rol' }); return; }
    if (m.tipo === 'devolucion' && ['farmacia', 'admin'].indexOf(usuario.rol) < 0) { rechazados.push({ id: m.id, motivo: 'rol' }); return; }
    if (['retiro', 'devolucion'].indexOf(m.tipo) < 0) { rechazados.push({ id: m.id, motivo: 'tipo' }); return; }
    const prep = tabla_('Preparaciones').find(function (p) { return p.id === String(m.preparacion_id); });
    if (!prep) { rechazados.push({ id: m.id, motivo: 'preparación desconocida' }); return; }
    const bolsa = tabla_('Bolsas').find(function (b) { return b.id === prep.bolsa_id; });
    const nuevo = agregar_('Movimientos', [Object.assign({}, m, {
      fecha: bolsa ? bolsa.fecha : hoy, medico_id: m.tipo === 'retiro' ? usuario.id : (bolsa ? bolsa.medico_id : m.medico_id),
      bolsa_id: prep.bolsa_id, medicamento_codigo: prep.medicamento_codigo, lote: prep.lote,
      registrado_por: usuario.id, creado: ahora.toISOString()
    })]);
    if (nuevo.length && bolsa) actualizar_('Bolsas', bolsa.id, { estado: m.tipo === 'retiro' ? 'retirada' : 'devuelta' });
    marcar('movimientos', [m.id]);
  });

  // 3. Eventos de visita (inicio, cierre, fallida), ordenados por hora del teléfono.
  const eventos = (lote.eventos || []).slice().sort(function (a, b) { return String(a.hora_tel).localeCompare(String(b.hora_tel)); });
  eventos.forEach(function (ev) {
    if (['inicio', 'cierre', 'fallida'].indexOf(ev.tipo) < 0) { rechazados.push({ id: ev.id, motivo: 'tipo' }); return; }
    const horaReal = new Date(new Date(ev.hora_tel).getTime() + desfaseS * 1000);
    const fila = Object.assign({}, ev, {
      lecturas: JSON.stringify(ev.lecturas || []), hora_real: horaReal.toISOString(), hora_servidor: ahora.toISOString(),
      desfase_s: desfaseS, qr_ok: ev.qr_ok ? 'SI' : 'NO', usuario_id: usuario.id, dispositivo: usuario.dispositivo
    });
    const nuevo = agregar_('Eventos', [fila]);
    if (nuevo.length) procesarEvento_(fila, usuario, desfaseS);
    marcar('eventos', [ev.id]);
  });

  // 4. Entregas y actas.
  (lote.entregas || []).forEach(function (en) {
    const nuevo = agregar_('Entregas', [Object.assign({}, en, { ocr_confirmado: en.ocr_confirmado ? 'SI' : 'NO', creado: ahora.toISOString() })]);
    if (nuevo.length) procesarEntrega_(en, usuario, hoy);
    marcar('entregas', [en.id]);
  });
  (lote.actas || []).forEach(function (a) {
    const nuevo = agregar_('Actas', [Object.assign({}, a, { creado: ahora.toISOString() })]);
    if (nuevo.length) procesarActa_(a, usuario);
    marcar('actas', [a.id]);
  });

  actualizar_('Dispositivos', usuario._disp.token_hash, { ultimo_sync: ahora.toISOString() });
  return { ok: true, aceptados: aceptados, rechazados: rechazados, desfase_s: desfaseS };
}

/** Enlace firmado de 15 minutos para subir (PUT) o, solo supervisión, descargar (GET) una foto cifrada. */
function firmarR2_(usuario, d) {
  const metodo = d.metodo === 'GET' ? 'GET' : 'PUT';
  if (metodo === 'GET') exigirRol_(usuario, ['supervisor', 'admin']);
  const claves = [].concat(d.claves || d.clave || []);
  if (!claves.length || claves.length > 50) throw new Error('Claves inválidas');
  const c = r2Credenciales_();
  const urls = {};
  claves.forEach(function (k) {
    if (!r2ClaveValida_(k)) throw new Error('Clave inválida: ' + k);
    urls[k] = r2UrlFirmada_({ cuenta: c.cuenta, bucket: c.bucket, accessKey: c.accessKey, secretKey: c.secretKey, metodo: metodo, clave: k, expira: 900 });
  });
  return { ok: true, urls: urls };
}

/** Datos para el visor de supervisión: visitas del rango con sus fotos (cifradas) y la llave privada cifrada. */
function visor_(d) {
  const desde = hoyLocal_(d.desde), hasta = hoyLocal_(d.hasta || d.desde);
  const visitas = tabla_('Visitas').filter(function (v) { const f = v.inicio.slice(0, 10); return f >= desde && f <= hasta; });
  const ids = new Set(visitas.map(function (v) { return v.id; }));
  const quitar = function (o) { const c = Object.assign({}, o); delete c._fila; return c; };
  const entregas = tabla_('Entregas').filter(function (e) { return ids.has(e.visita_id); });
  const idsPrep = new Set(entregas.map(function (e) { return e.preparacion_id; }));
  const idsBolsa = new Set(entregas.map(function (e) { return e.bolsa_id; }));
  const usuarios = {};
  tabla_('Usuarios').forEach(function (u) { usuarios[u.id] = u.nombre; });
  const pacientes = {};
  tabla_('Pacientes').forEach(function (p) { pacientes[p.id] = { nombre: p.nombre, codigo_afiliado: p.codigo_afiliado, lat: p.lat, lon: p.lon }; });
  return {
    ok: true,
    llavePrivadaCifrada: config_().LLAVE_PRIVADA_CIFRADA ? JSON.parse(config_().LLAVE_PRIVADA_CIFRADA) : null,
    visitas: visitas.map(function (v) {
      const c = quitar(v);
      c.medico = usuarios[v.medico_id] || v.medico_id;
      c.paciente = pacientes[v.paciente_id] || null;
      return c;
    }),
    eventos: tabla_('Eventos').filter(function (e) { return ids.has(e.visita_id); }).map(quitar),
    entregas: entregas.map(quitar),
    actas: tabla_('Actas').filter(function (a) { return ids.has(a.visita_id); }).map(quitar),
    alertas: tabla_('Alertas').filter(function (a) { return ids.has(a.visita_id); }).map(quitar),
    preparaciones: tabla_('Preparaciones').filter(function (p) { return idsPrep.has(p.id); }).map(quitar),
    bolsas: tabla_('Bolsas').filter(function (b) { return idsBolsa.has(b.id); }).map(quitar)
  };
}
