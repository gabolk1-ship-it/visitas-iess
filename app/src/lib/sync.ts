/**
 * Cola de envío: primero las fotos (cifradas) directo a R2 con enlaces firmados,
 * luego los registros en lotes. Cada registro lleva su UUID, así un reenvío no duplica.
 */
import { llamar } from './api';
import { contarPendientes, db, leerPendientes, sesionAbierta } from './db';
import type { TablaSync } from './tipos';

type Oyente = (estado: EstadoSync) => void;
export interface EstadoSync { enviando: boolean; registros: number; fotos: number; ultimoEnvio: number | null; error: string | null }

let estado: EstadoSync = { enviando: false, registros: 0, fotos: 0, ultimoEnvio: null, error: null };
const oyentes = new Set<Oyente>();
const emitir = (cambios: Partial<EstadoSync>) => { estado = { ...estado, ...cambios }; oyentes.forEach((o) => o(estado)); };

export function suscribir(o: Oyente) { oyentes.add(o); o(estado); return () => { oyentes.delete(o); }; }

export async function refrescarConteo() {
  if (!sesionAbierta()) return;
  const c = await contarPendientes();
  emitir({ registros: c.registros, fotos: c.fotos });
}

async function subirFotos() {
  const pendientes = await db.fotos.where('subida').equals(0).limit(20).toArray();
  if (!pendientes.length) return;
  const { urls } = await llamar<{ urls: Record<string, string> }>('firmar', { metodo: 'PUT', claves: pendientes.map((f) => f.key) });
  for (const f of pendientes) {
    const r = await fetch(urls[f.key], { method: 'PUT', body: f.blob, headers: { 'Content-Type': 'application/octet-stream' } });
    if (!r.ok) throw new Error('No se pudo subir una foto (' + r.status + ')');
    await db.fotos.update(f.key, { subida: 1 });
  }
  // Se borra del teléfono lo que ya está en el servidor.
  await db.fotos.where('subida').equals(1).delete();
  if (pendientes.length === 20) await subirFotos();
}

async function enviarRegistros() {
  const pend = await leerPendientes();
  if (!pend.length) return;
  const lote: Partial<Record<TablaSync, Record<string, unknown>[]>> = {};
  pend.slice(0, 200).forEach((p) => { (lote[p.tabla] ||= []).push(p.registro); });
  const r = await llamar<{ aceptados: Partial<Record<TablaSync, string[]>>; rechazados: { id: string; motivo: string }[] }>('sync', lote);
  const listos = new Set<string>();
  Object.entries(r.aceptados || {}).forEach(([tabla, ids]) => ids?.forEach((id) => listos.add(tabla + ':' + id)));
  // Los rechazados por regla de negocio no se reintentan para siempre: se dejan 10 intentos.
  for (const p of pend.slice(0, 200)) {
    if (listos.has(p.id)) await db.pendientes.delete(p.id);
    else await db.pendientes.update(p.id, { intentos: ((await db.pendientes.get(p.id))?.intentos || 0) + 1 });
  }
  if (r.rechazados?.length) console.warn('Rechazados', r.rechazados);
  if (pend.length > 200) await enviarRegistros();
}

let enCurso: Promise<void> | null = null;

export function sincronizar(): Promise<void> {
  if (enCurso) return enCurso;
  if (!sesionAbierta() || !navigator.onLine) { refrescarConteo(); return Promise.resolve(); }
  enCurso = (async () => {
    emitir({ enviando: true, error: null });
    try {
      await subirFotos();
      await enviarRegistros();
      emitir({ ultimoEnvio: Date.now() });
    } catch (e) {
      emitir({ error: (e as Error).message });
    } finally {
      await refrescarConteo();
      emitir({ enviando: false });
      enCurso = null;
    }
  })();
  return enCurso;
}

let iniciado = false;
export function iniciarSincronizacion() {
  if (iniciado) return;
  iniciado = true;
  window.addEventListener('online', () => sincronizar());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sincronizar(); });
  setInterval(() => sincronizar(), 60000);
  sincronizar();
}
