// Servidor local para probar la app completa: sirve dist/, ejecuta el backend de Apps Script
// en una hoja simulada (/api) y simula R2 (/r2). Solo para pruebas.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';

const src = fs.readFileSync(new URL('./backend.test.mjs', import.meta.url), 'utf8');
// Reutiliza la simulación de servicios de Google de la prueba del backend (todo antes del escenario).
const simulacion = src.split('// ---------- Escenario ----------')[0].replace(/^import .*$/mg, '');
const modulo = new Function('fs', 'vm', 'crypto', 'assert', 'URL_BASE', simulacion.replace(/new URL\('\.\.\/\.\.\/backend\/' \+ f, import\.meta\.url\)/, "new URL('../../backend/' + f, URL_BASE)") +
  '\nreturn { ctx, api, filas, llenar, hojas, limpiarCache, fijarReloj: (r) => { relojFalso = r; } };');
const S = modulo(fs, vm, crypto, null, import.meta.url);
S.fijarReloj(null);
const objetos = new Map();
S.ctx.r2UrlFirmada_ = (o) => `http://localhost:8787/r2/${o.clave}?m=${o.metodo}`;

// Datos de prueba
S.ctx.configurarHojas();
const set = (k, v) => { S.hojas.get('Config').datos.find((f) => f[0] === k)[1] = v; };
set('MUESTREO_LLAMADAS', '0'); set('HORA_INICIO', '00:00'); set('HORA_FIN', '23:59');
const llaves = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
set('LLAVE_PUBLICA', JSON.stringify(llaves.publica)); set('LLAVE_PRIVADA_CIFRADA', JSON.stringify(llaves.privadaCifrada));
const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil' }).format(new Date());
S.llenar('Usuarios', [
  { id: 'M1', nombre: 'Dra. Prueba', rol: 'medico', codigo_activacion: 'MEDICO01', activo: 'SI' },
  { id: 'F1', nombre: 'Farmacia Uno', rol: 'farmacia', codigo_activacion: 'FARMA001', activo: 'SI' },
  { id: 'S1', nombre: 'Supervisión', rol: 'supervisor', codigo_activacion: 'SUPERV01', activo: 'SI' }]);
S.llenar('Pacientes', [{ id: 'P1', codigo_afiliado: '1712345678', nombre: 'Paciente Ficticio Uno', sector: 'Cotocollao', direccion: 'Calle Ficticia N12-34', lat: '-0.110500', lon: '-78.498300', qr_codigo: '' }]);
S.llenar('Cuidadores', [{ id: 'C1', paciente_id: 'P1', nombre: 'Hija Ficticia', cedula: '1700000001', parentesco: 'hija', autorizado_controlados: 'SI' }]);
S.llenar('Agenda', [{ id: 'AG1', fecha: hoy, medico_id: 'M1', paciente_id: 'P1', ventana: 'mañana', estado: 'pendiente' }]);
S.llenar('Ordenes', [{ orden_id: 'O1|MED01', codigo_afiliado: '1712345678', medicamento_codigo: 'MED01', medicamento: 'Losartán 50 mg', cantidad: '30', desde: '2026-01-01', hasta: '2027-12-31', controlado: 'NO' }]);

const tipos = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.gz': 'application/gzip', '.wasm': 'application/wasm' };
http.createServer((req, res) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,PUT,POST', 'Access-Control-Allow-Headers': '*' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api' && req.method === 'POST') {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
      S.limpiarCache();
      const out = S.ctx.doPost({ postData: { contents: b } });
      res.writeHead(200, { 'Content-Type': 'application/json', ...cors }); res.end(out.texto);
    }); return;
  }
  if (u.pathname.startsWith('/r2/')) {
    const k = u.pathname.slice(4);
    if (req.method === 'PUT') { const ch = []; req.on('data', (c) => ch.push(c)); req.on('end', () => { objetos.set(k, Buffer.concat(ch)); res.writeHead(200, cors); res.end(); }); return; }
    if (!objetos.has(k)) { res.writeHead(404, cors); return res.end(); }
    res.writeHead(200, cors); return res.end(objetos.get(k));
  }
  if (u.pathname === '/_estado') { S.limpiarCache(); res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ fotos: objetos.size, visitas: S.filas('Visitas'), entregas: S.filas('Entregas'), actas: S.filas('Actas'), alertas: S.filas('Alertas'), movimientos: S.filas('Movimientos'), bolsas: S.filas('Bolsas') })); }
  let f = path.join(path.resolve('dist'), decodeURIComponent(u.pathname));
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.resolve('dist/index.html');
  res.writeHead(200, { 'Content-Type': tipos[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
}).listen(8787, () => console.log('Servidor simulado en http://localhost:8787'));
