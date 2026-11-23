/**
 * Almacenamiento local (IndexedDB). Todo lo que identifica a pacientes se guarda cifrado
 * con la llave derivada del PIN; las fotos ya vienen cifradas para supervisión.
 */
import Dexie, { type Table } from 'dexie';
import { aBase64, cifrarTexto, deBase64, derivarLlave, descifrarTexto } from './cripto';
import type { ConfigApp, TablaSync, Usuario } from './tipos';

interface Ajuste { clave: string; valor: unknown }
export interface Pendiente { id: string; tabla: TablaSync; iv: string; datos: string; creado: number; intentos: number }
export interface FotoLocal { key: string; blob: Uint8Array<ArrayBuffer>; subida: 0 | 1; creado: number }
interface Cifrado { clave: string; iv: string; datos: string; actualizado: number }

class BaseLocal extends Dexie {
  ajustes!: Table<Ajuste, string>;
  pendientes!: Table<Pendiente, string>;
  fotos!: Table<FotoLocal, string>;
  privado!: Table<Cifrado, string>;
  constructor() {
    super('visitas-iess');
    this.version(1).stores({
      ajustes: 'clave',
      pendientes: 'id, tabla, creado',
      fotos: 'key, subida, creado',
      privado: 'clave'
    });
  }
}

export const db = new BaseLocal();

let llaveSesion: CryptoKey | null = null;
export const sesionAbierta = () => llaveSesion !== null;
export const cerrarSesion = () => { llaveSesion = null; };

async function ajuste<T>(clave: string): Promise<T | undefined> {
  return (await db.ajustes.get(clave))?.valor as T | undefined;
}
async function fijar(clave: string, valor: unknown) {
  await db.ajustes.put({ clave, valor });
}

export const leerApiUrl = () => ajuste<string>('apiUrl');
export const fijarApiUrl = (u: string) => fijar('apiUrl', u);
export const leerUsuario = () => ajuste<Usuario>('usuario');
export const leerConfig = () => ajuste<ConfigApp>('config');
export const fijarConfig = async (c: ConfigApp) => { await fijar('config', c); await fijar('usuario', c.usuario); };
export const estaActivado = async () => !!(await ajuste<string>('pinSal'));

/** Primera vez: guarda el token cifrado con una llave derivada del PIN. */
export async function crearPin(pin: string, token: string) {
  const sal = crypto.getRandomValues(new Uint8Array(16));
  const llave = await derivarLlave(pin, sal);
  await fijar('pinSal', aBase64(sal));
  await fijar('tokenCifrado', await cifrarTexto(token, llave));
  llaveSesion = llave;
}

/** Abre la sesión con el PIN. Tras 5 intentos fallidos exige esperar 5 minutos. */
export async function abrirConPin(pin: string): Promise<boolean> {
  const bloqueo = (await ajuste<number>('bloqueoHasta')) || 0;
  if (Date.now() < bloqueo) throw new Error('Demasiados intentos. Espere unos minutos.');
  const sal = await ajuste<string>('pinSal');
  const tok = await ajuste<{ iv: string; datos: string }>('tokenCifrado');
  if (!sal || !tok) return false;
  const llave = await derivarLlave(pin, deBase64(sal));
  try {
    await descifrarTexto(tok, llave);
    llaveSesion = llave;
    await fijar('fallos', 0);
    return true;
  } catch {
    const fallos = ((await ajuste<number>('fallos')) || 0) + 1;
    await fijar('fallos', fallos);
    if (fallos >= 5) { await fijar('bloqueoHasta', Date.now() + 5 * 60000); await fijar('fallos', 0); }
    return false;
  }
}

function llave(): CryptoKey {
  if (!llaveSesion) throw new Error('Sesión cerrada: ingrese su PIN');
  return llaveSesion;
}

export async function leerToken(): Promise<string> {
  const tok = await ajuste<{ iv: string; datos: string }>('tokenCifrado');
  if (!tok) throw new Error('Teléfono no activado');
  return descifrarTexto(tok, llave());
}

export async function guardarPrivado(clave: string, valor: unknown) {
  const c = await cifrarTexto(JSON.stringify(valor), llave());
  await db.privado.put({ clave, ...c, actualizado: Date.now() });
}

export async function leerPrivado<T>(clave: string): Promise<T | undefined> {
  const c = await db.privado.get(clave);
  if (!c) return undefined;
  return JSON.parse(await descifrarTexto(c, llave())) as T;
}

export async function borrarPrivado(clave: string) {
  await db.privado.delete(clave);
}

/** Encola un registro para enviar; si el id ya está en cola, lo reemplaza. */
export async function encolar(tabla: TablaSync, registro: { id: string } & Record<string, unknown>) {
  const c = await cifrarTexto(JSON.stringify(registro), llave());
  await db.pendientes.put({ id: tabla + ':' + registro.id, tabla, ...c, creado: Date.now(), intentos: 0 });
}

export async function leerPendientes(): Promise<{ id: string; tabla: TablaSync; registro: Record<string, unknown> }[]> {
  const filas = await db.pendientes.orderBy('creado').toArray();
  return Promise.all(filas.map(async (f) => ({ id: f.id, tabla: f.tabla, registro: JSON.parse(await descifrarTexto(f, llave())) })));
}

export async function contarPendientes(): Promise<{ registros: number; fotos: number }> {
  return { registros: await db.pendientes.count(), fotos: await db.fotos.where('subida').equals(0).count() };
}

/** Borra todo lo local (al desactivar el teléfono). */
export async function borrarTodo() {
  llaveSesion = null;
  await db.delete();
  await db.open();
}

/** Pide al navegador que no borre los datos locales por falta de espacio. */
export async function pedirPersistencia() {
  try { if (navigator.storage?.persist) await navigator.storage.persist(); } catch { /* sin soporte */ }
}
