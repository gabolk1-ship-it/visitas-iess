// Prueba de extremo a extremo del backend de Apps Script con una hoja de cálculo simulada en memoria.
// Ejecutar: node pruebas/backend.test.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import assert from 'node:assert';

// ---------- Simulación mínima de los servicios de Google ----------
class Rango {
  constructor(h, f, c, nf, nc) { Object.assign(this, { h, f, c, nf, nc }); }
  celdas(fn) { const out = []; for (let i = 0; i < this.nf; i++) { const fila = []; for (let j = 0; j < this.nc; j++) fila.push(fn(this.f + i, this.c + j)); out.push(fila); } return out; }
  getDisplayValues() { return this.celdas((r, c) => { const v = this.h.datos[r - 1]?.[c - 1]; return v === undefined || v === null ? '' : String(v); }); }
  getValues() { return this.getDisplayValues(); }
  getDisplayValue() { return this.getDisplayValues()[0][0]; }
  getValue() { return this.getDisplayValue(); }
  setValues(vals) { vals.forEach((fila, i) => fila.forEach((v, j) => this.h.poner(this.f + i, this.c + j, v))); return this; }
  setValue(v) { this.h.poner(this.f, this.c, v); return this; }
  setNumberFormat() { return this; }
  setFontWeight() { return this; }
  setDataValidation() { return this; }
  getRow() { return this.f; }
  createTextFinder() { return { matchEntireCell: () => ({ findNext: () => null }) }; }
}
class Hoja {
  constructor(nombre) { this.nombre = nombre; this.datos = []; }
  poner(r, c, v) { while (this.datos.length < r) this.datos.push([]); this.datos[r - 1][c - 1] = v; }
  getName() { return this.nombre; }
  getLastRow() { let n = this.datos.length; while (n > 0 && !(this.datos[n - 1] || []).some((x) => x !== undefined && x !== '')) n--; return n; }
  getMaxRows() { return 1000; }
  getRange(f, c, nf = 1, nc = 1) { return new Rango(this, f, c, nf, nc); }
  getDataRange() { const nc = Math.max(0, ...this.datos.map((r) => r.length)); return new Rango(this, 1, 1, this.getLastRow(), nc); }
  appendRow(fila) { this.poner(this.getLastRow() + 1, 1, fila[0]); fila.forEach((v, j) => this.poner(this.getLastRow(), j + 1, v)); }
  setFrozenRows() {}
  clear() { this.datos = []; }
}
const hojas = new Map();
const libro = {
  getSheetByName: (n) => hojas.get(n) || null,
  insertSheet: (n) => { const h = new Hoja(n); hojas.set(n, h); return h; },
  getSheets: () => [...hojas.values()],
  deleteSheet: (h) => hojas.delete(h.nombre),
  getId: () => 'libro-prueba'
};
const aF = (b) => Array.from(b, (x) => (x > 127 ? x - 256 : x));
const aB = (a) => Buffer.from(a.map((x) => (x + 256) % 256));
const enviados = { telegram: [], correo: [] };
let relojFalso = null;
const RealDate = Date;
class FakeDate extends RealDate { constructor(...a) { if (a.length === 0 && relojFalso) super(relojFalso); else super(...a); } static now() { return relojFalso ? new RealDate(relojFalso).getTime() : RealDate.now(); } }

const ctx = {
  console: { ...console, error: () => {} }, JSON, Math, Set, Object, Array, String, Number, parseFloat, parseInt, isNaN, encodeURIComponent, Date: FakeDate,
  SpreadsheetApp: { getActive: () => libro, newDataValidation: () => ({ requireValueInList: () => ({ build: () => ({}) }) }), getUi: () => ({ alert: () => {} }) },
  Utilities: {
    getUuid: () => crypto.randomUUID(),
    DigestAlgorithm: { SHA_256: 1 }, Charset: { UTF_8: 1 },
    computeDigest: (_, t) => aF(crypto.createHash('sha256').update(String(t), 'utf8').digest()),
    computeHmacSha256Signature: (v, k) => aF(crypto.createHmac('sha256', aB(k)).update(aB(v)).digest()),
    newBlob: (s) => ({ getBytes: () => aF(Buffer.from(s, 'utf8')) }),
    formatDate: (d, tz, fmt) => {
      const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(d).map((x) => [x.type, x.value]));
      return fmt.replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day).replace('HH', p.hour === '24' ? '00' : p.hour).replace('mm', p.minute).replace('ss', p.second);
    }
  },
  LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => ({ R2_ACCOUNT_ID: 'cuenta', R2_BUCKET: 'fotos', R2_ACCESS_KEY_ID: 'AK', R2_SECRET_ACCESS_KEY: 'SK', TELEGRAM_TOKEN: 't', TELEGRAM_CHAT_ID: '1' })[k] || null }) },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ setMimeType: () => ({ texto: t }) }) },
  UrlFetchApp: { fetch: (url, o) => { enviados.telegram.push(JSON.parse(o.payload).text); } },
  MailApp: { sendEmail: (d, a, c) => enviados.correo.push({ d, a, c }) },
  Session: { getActiveUser: () => ({ getEmail: () => 'admin@iess.gob.ec' }) }
};
vm.createContext(ctx);
for (const f of ['Hojas.gs', 'R2.gs', 'Notificar.gs', 'Reglas.gs', 'Codigo.gs', 'Menu.gs']) {
  vm.runInContext(fs.readFileSync(new URL('../../backend/' + f, import.meta.url), 'utf8'), ctx, { filename: f });
}
const limpiarCache = () => vm.runInContext('Object.keys(CACHE_TABLAS_).forEach(function(k){ delete CACHE_TABLAS_[k]; })', ctx);
const api = (accion, datos, token, reloj) => {
  limpiarCache();
  const r = ctx.doPost({ postData: { contents: JSON.stringify({ accion, datos, token, reloj: reloj || new FakeDate().toISOString() }) } });
  return JSON.parse(r.texto);
};
const filas = (n) => { limpiarCache(); return vm.runInContext(`tabla_('${n}')`, ctx); };
const llenar = (n, objs) => { limpiarCache(); vm.runInContext(`agregar_('${n}', ${JSON.stringify(objs)})`, ctx); };

// ---------- Escenario ----------
relojFalso = '2026-11-24T14:00:00Z'; // 09:00 en Ecuador
ctx.configurarHojas();
llenar('Config', []);
hojas.get('Config').datos.find((f) => f[0] === 'CORREO_ALERTAS')[1] = 'supervision@iess.gob.ec';
hojas.get('Config').datos.find((f) => f[0] === 'MUESTREO_LLAMADAS')[1] = '0';
llenar('Usuarios', [
  { id: 'M1', nombre: 'Dra. Prueba', correo: 'm1@iess.gob.ec', rol: 'medico', codigo_activacion: 'MEDICO01', activo: 'SI' },
  { id: 'F1', nombre: 'Farmacia Uno', correo: 'f1@iess.gob.ec', rol: 'farmacia', codigo_activacion: 'FARMA001', activo: 'SI' },
  { id: 'S1', nombre: 'Supervisión', correo: 's1@iess.gob.ec', rol: 'supervisor', codigo_activacion: 'SUPERV01', activo: 'SI' }
]);
llenar('Pacientes', [
  { id: 'P1', codigo_afiliado: '1712345678', nombre: 'Paciente Ficticio Uno', sector: 'Cotocollao', lat: '-0.110500', lon: '-78.498300', radio_m: '', qr_codigo: 'QR-P1' },
  { id: 'P2', codigo_afiliado: '1798765432', nombre: 'Paciente Ficticio Dos', sector: 'La Ofelia', lat: '', lon: '', radio_m: '', qr_codigo: '' }
]);
llenar('Cuidadores', [{ id: 'C1', paciente_id: 'P1', nombre: 'Hija Ficticia', cedula: '1700000001', parentesco: 'hija', autorizado_controlados: 'NO' }]);
llenar('Agenda', [
  { id: 'AG1', fecha: '2026-11-24', medico_id: 'M1', paciente_id: 'P1', ventana: 'mañana', estado: 'pendiente' },
  { id: 'AG2', fecha: '2026-11-24', medico_id: 'M1', paciente_id: 'P2', ventana: 'tarde', estado: 'pendiente' }
]);
llenar('Ordenes', [
  { orden_id: 'O1|MED01', codigo_afiliado: '1712345678', medicamento_codigo: 'MED01', medicamento: 'Losartán 50 mg', cantidad: '30', desde: '2026-11-01', hasta: '2026-11-30', controlado: 'NO' },
  { orden_id: 'O1|MED02', codigo_afiliado: '1712345678', medicamento_codigo: 'MED02', medicamento: 'Clonazepam 2 mg', cantidad: '10', desde: '2026-11-01', hasta: '2026-11-30', controlado: 'SI', receta_especial: 'RE-555' }
]);

// Activación
let r = api('activar', { codigo: 'medico01', plataforma: 'Android 14' });
assert.ok(r.ok, JSON.stringify(r)); const tM = r.token;
assert.strictEqual(api('activar', { codigo: 'MEDICO01' }).ok, false, 'el código es de un solo uso');
const tF = api('activar', { codigo: 'FARMA001' }).token;
const tS = api('activar', { codigo: 'SUPERV01' }).token;
assert.strictEqual(api('agenda', {}, 'token-falso').ok, false);
console.log('✔ activación de un solo uso y tokens');

// Farmacia prepara
r = api('farmacia_dia', { fecha: '2026-11-24', medico_id: 'M1' }, tF);
assert.ok(r.ok); assert.strictEqual(r.pacientes.find((p) => p.id === 'P1').ordenes.length, 2);
assert.strictEqual(api('farmacia_dia', {}, tM).ok, false, 'médico no accede a farmacia');
const foto = () => ({ foto_key: `f/2026-11/${crypto.randomUUID()}.bin`, foto_llave: '{}', foto_hash: crypto.randomBytes(8).toString('hex') });
r = api('sync', {
  bolsas: [{ id: 'B1', fecha: '2026-11-24', medico_id: 'M1', paciente_id: 'P1', ...foto() }],
  preparaciones: [
    { id: 'PR1', bolsa_id: 'B1', orden_id: 'O1|MED01', medicamento_codigo: 'MED01', medicamento: 'Losartán 50 mg', lote: 'AB1234', vencimiento: '2027-08-31', cantidad: 30, controlado: false, ...foto() },
    { id: 'PR2', bolsa_id: 'B1', orden_id: 'O1|MED02', medicamento_codigo: 'MED02', medicamento: 'Clonazepam 2 mg', lote: 'CZ0099', vencimiento: '2027-02-28', cantidad: 10, controlado: true, receta_especial: 'RE-555', ...foto() }
  ]
}, tF);
assert.ok(r.ok, JSON.stringify(r));
assert.strictEqual(api('sync', { bolsas: [{ id: 'B9' }] }, tM).ok, false, 'médico no puede preparar');
console.log('✔ farmacia prepara bolsa con controlado');

// Médico: agenda y retiro
r = api('agenda', { fecha: '2026-11-24' }, tM);
assert.strictEqual(r.agenda.length, 2); assert.strictEqual(r.bolsas[0].items.length, 2);
r = api('sync', { movimientos: [
  { id: 'MV1', tipo: 'retiro', preparacion_id: 'PR1', cantidad: 30 },
  { id: 'MV2', tipo: 'retiro', preparacion_id: 'PR2', cantidad: 10 }
] }, tM);
assert.deepStrictEqual(r.aceptados.movimientos, ['MV1', 'MV2']);
assert.strictEqual(filas('Bolsas')[0].estado, 'retirada');
console.log('✔ retiro del maletín');

// Visita 1 (P1): teléfono con reloj 2 minutos atrasado, GPS dentro de la geocerca, receptor hija NO autorizada para controlados.
relojFalso = '2026-11-24T14:30:00Z';
const relojTel = new FakeDate(new FakeDate().getTime() - 120000).toISOString();
const lect = (lat, lon) => [{ lat, lon, precision: 12, t: 1 }, { lat: lat + 0.00001, lon, precision: 9, t: 2 }, { lat, lon: lon + 0.00001, precision: 8, t: 3 }];
r = api('sync', {
  eventos: [{ id: 'E1', visita_id: 'V1', agenda_id: 'AG1', paciente_id: 'P1', tipo: 'inicio', lat: -0.11055, lon: -78.49835, precision_m: 8, lecturas: lect(-0.11055, -78.49835), hora_tel: relojTel, qr_ok: true, ...foto(), foto_medico_key: `f/2026-11/${crypto.randomUUID()}.bin`, foto_medico_hash: 'hm1' }],
  entregas: [
    { id: 'EN1', visita_id: 'V1', paciente_id: 'P1', bolsa_id: 'B1', preparacion_id: 'PR1', orden_id: 'O1|MED01', medicamento_codigo: 'MED01', lote_leido: 'AB-l234', venc_leido: '2027-08-31', cantidad: 30, ...foto() },
    { id: 'EN2', visita_id: 'V1', paciente_id: 'P1', bolsa_id: 'B1', preparacion_id: 'PR2', orden_id: 'O1|MED02', medicamento_codigo: 'MED02', lote_leido: 'ZZ0000', venc_leido: '2027-02-28', cantidad: 10, motivo: 'otra caja', ...foto() }
  ],
  actas: [{ id: 'AC1', visita_id: 'V1', receptor_nombre: 'Hija Ficticia', receptor_cedula: '1700000001', parentesco: 'hija', ...foto() }]
}, tM, relojTel);
assert.ok(r.ok, JSON.stringify(r));
assert.ok(Math.abs(r.desfase_s - 120) <= 1, 'desfase de reloj medido: ' + r.desfase_s);
let v1 = filas('Visitas').find((v) => v.id === 'V1');
assert.strictEqual(v1.estado, 'en curso'); assert.ok(Number(v1.distancia_inicio_m) < 200, 'distancia ' + v1.distancia_inicio_m);
assert.strictEqual(filas('Entregas').find((e) => e.id === 'EN1').lote_ok, 'SI', 'AB-l234 ≈ AB1234 (confusión de OCR)');
assert.strictEqual(filas('Entregas').find((e) => e.id === 'EN2').lote_ok, 'NO');
const tipos = () => filas('Alertas').map((a) => a.tipo + '/' + a.severidad);
assert.ok(tipos().includes('lote_distinto/crítica'), tipos());
assert.ok(tipos().includes('receptor_no_autorizado_controlados/crítica'), tipos());
assert.ok(enviados.telegram.length >= 2 && enviados.telegram.every((t) => !/Ficticia|1700000001/.test(t)), 'Telegram sin datos personales');
console.log('✔ lote leído con confusión O/0 e I/1 aceptado; lote distinto y receptor no autorizado → alertas críticas; Telegram sin datos personales');

// Reenvío idéntico: no duplica
const antes = filas('Entregas').length;
r = api('sync', { entregas: [{ id: 'EN1', visita_id: 'V1', preparacion_id: 'PR1', cantidad: 30 }] }, tM);
assert.strictEqual(filas('Entregas').length, antes); assert.deepStrictEqual(r.aceptados.entregas, ['EN1']);
console.log('✔ reenvío idempotente');

// Cierre a los 3 minutos → visita corta
relojFalso = '2026-11-24T14:33:00Z';
api('sync', { eventos: [{ id: 'E2', visita_id: 'V1', agenda_id: 'AG1', paciente_id: 'P1', tipo: 'cierre', lat: -0.11056, lon: -78.49836, precision_m: 9, lecturas: lect(-0.11056, -78.49836), hora_tel: new FakeDate().toISOString(), ...foto() }] }, tM);
v1 = filas('Visitas').find((v) => v.id === 'V1');
assert.strictEqual(v1.estado, 'realizada'); assert.ok(v1.banderas.includes('visita_corta'), v1.banderas);
assert.strictEqual(filas('Agenda').find((a) => a.id === 'AG1').estado, 'realizada');
console.log('✔ cierre, duración', v1.duracion_min, 'min, puntaje', v1.puntaje, 'banderas', v1.banderas);

// Visita 2 (P2, sin domicilio): registra domicilio. Luego un evento falso: GPS estático, a 15 km, 5 minutos después.
relojFalso = '2026-11-24T15:00:00Z';
api('sync', { eventos: [{ id: 'E3', visita_id: 'V2', agenda_id: 'AG2', paciente_id: 'P2', tipo: 'inicio', lat: -0.1200, lon: -78.5000, precision_m: 10, lecturas: lect(-0.12, -78.5), hora_tel: new FakeDate().toISOString(), ...foto() }] }, tM);
assert.strictEqual(filas('Pacientes').find((p) => p.id === 'P2').lat, '-0.120000', 'domicilio registrado en primera visita');
relojFalso = '2026-11-24T15:05:00Z';
const estatico = [1, 2, 3].map((t) => ({ lat: -0.25, lon: -78.52, precision: 5, t }));
api('sync', { eventos: [{ id: 'E4', visita_id: 'V2', agenda_id: 'AG2', paciente_id: 'P2', tipo: 'cierre', lat: -0.25, lon: -78.52, precision_m: 5, lecturas: estatico, hora_tel: new FakeDate().toISOString(), ...foto() }] }, tM);
const v2 = filas('Visitas').find((v) => v.id === 'V2');
for (const b of ['gps_estatico', 'velocidad_imposible', 'fuera_geocerca']) assert.ok(v2.banderas.includes(b), b + ' en ' + v2.banderas);
assert.ok(Number(v2.puntaje) < 30, 'puntaje ' + v2.puntaje);
console.log('✔ domicilio registrado; GPS simulado detectado (estático + velocidad imposible + fuera de geocerca), puntaje', v2.puntaje);

// Foto reutilizada
const hashRepetido = filas('Eventos').find((e) => e.id === 'E3').foto_hash;
relojFalso = '2026-11-24T16:00:00Z';
api('sync', { eventos: [{ id: 'E5', visita_id: 'V3', agenda_id: '', paciente_id: 'P1', tipo: 'fallida', motivo: 'Paciente ausente', lat: -0.11055, lon: -78.49835, precision_m: 10, lecturas: lect(-0.11055, -78.49835), hora_tel: new FakeDate().toISOString(), foto_key: `f/2026-11/${crypto.randomUUID()}.bin`, foto_hash: hashRepetido }] }, tM);
assert.ok(filas('Visitas').find((v) => v.id === 'V3').banderas.includes('foto_duplicada'));
console.log('✔ foto reutilizada detectada');

// Devolución y cuadre: se retiraron 10 clonazepam, se entregaron 10, farmacia cuenta 2 devueltos → descuadre crítico.
api('sync', { movimientos: [{ id: 'MV3', tipo: 'devolucion', preparacion_id: 'PR2', cantidad: 2 }] }, tF);
relojFalso = '2026-11-25T02:00:00Z'; // 21:00 del 24 en Ecuador
limpiarCache(); ctx.cuadreDiario();
assert.ok(tipos().includes('descuadre_maletin/crítica'), tipos());
assert.ok(enviados.correo.some((c) => c.a.includes('Resumen 2026-11-24')), 'resumen diario enviado');
console.log('✔ cuadre diario: descuadre de controlado → alerta crítica; resumen por correo');

limpiarCache(); ctx.generarReporteControlados();
const rep = hojas.get('Reporte_Controlados').datos;
assert.deepStrictEqual(rep[1].slice(1, 9).map(String), ['MED02', 'Clonazepam 2 mg', 'CZ0099', 'RE-555', '10', '10', '2', '-2']);
console.log('✔ reporte de controlados: salida 10, entregado 10, devuelto 2, saldo -2');

// Visor y firmas
assert.strictEqual(api('visor', { desde: '2026-11-24' }, tM).ok, false, 'médico no ve el visor');
r = api('visor', { desde: '2026-11-24' }, tS);
assert.ok(r.ok && r.visitas.length === 3 && r.preparaciones.length === 2 && r.bolsas.length === 1, JSON.stringify(Object.keys(r)));
assert.strictEqual(api('firmar', { metodo: 'GET', claves: [r.eventos[0].foto_key] }, tM).ok, false, 'médico no descarga fotos');
const g = api('firmar', { metodo: 'GET', claves: [r.eventos[0].foto_key] }, tS);
assert.ok(g.ok && g.urls[r.eventos[0].foto_key].startsWith('https://cuenta.r2.cloudflarestorage.com/fotos/f/2026-11/'));
assert.strictEqual(api('firmar', { metodo: 'PUT', claves: ['../../otro'] }, tM).ok, false);
console.log('✔ visor y descargas solo para supervisión; claves de objeto validadas');

// Importación del CSV de AS400
const imp = hojas.get('Importar_Ordenes');
imp.datos = [['ORDEN', 'AFILIADO', 'COD_MEDICAMENTO', 'MEDICAMENTO', 'CANTIDAD', 'FECHA_DESDE', 'FECHA_HASTA', 'CONTROLADO', 'RECETA_ESPECIAL'],
  ['900', '1798765432', 'MED03', 'Metformina 850 mg', '60', '20261201', '31/12/2026', 'N', ''],
  ['900', '1798765432', 'MED04', 'Tramadol 50 mg', '20', '2026-12-01', '2026-12-31', 'S', 'RE-777']];
limpiarCache(); ctx.procesarOrdenesImportadas();
const o = filas('Ordenes').filter((x) => x.orden_id.startsWith('900|'));
assert.strictEqual(o.length, 2); assert.strictEqual(o[0].desde, '2026-12-01'); assert.strictEqual(o[0].hasta, '2026-12-31'); assert.strictEqual(o[1].controlado, 'SI');
limpiarCache(); ctx.procesarOrdenesImportadas();
assert.strictEqual(filas('Ordenes').filter((x) => x.orden_id.startsWith('900|')).length, 2, 'reimportar no duplica');
console.log('✔ importación del CSV de AS400 (fechas AAAAMMDD y DD/MM/AAAA, controlados, sin duplicar)');

console.log('\nTodas las pruebas del backend pasaron.');
