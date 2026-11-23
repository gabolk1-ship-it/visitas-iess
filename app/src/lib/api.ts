/**
 * Cliente de la API de Apps Script. Se envía como text/plain para que el navegador
 * no haga verificación previa de CORS (Apps Script no la responde).
 */
import { leerApiUrl, leerToken } from './db';

export class ErrorApi extends Error {}

export async function llamar<T = Record<string, unknown>>(accion: string, datos: unknown = {}, opciones: { token?: string; url?: string } = {}): Promise<T> {
  const url = opciones.url || (await leerApiUrl()) || import.meta.env.VITE_API_URL;
  if (!url) throw new ErrorApi('Falta la dirección del servidor');
  const token = accion === 'activar' ? undefined : (opciones.token ?? (await leerToken()));
  const ctl = new AbortController();
  const tiempo = setTimeout(() => ctl.abort(), 45000);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ accion, token, datos, reloj: new Date().toISOString() }),
      redirect: 'follow',
      signal: ctl.signal
    });
    if (!r.ok) throw new ErrorApi('Servidor respondió ' + r.status);
    const j = await r.json();
    if (!j.ok) throw new ErrorApi(j.error || 'Error del servidor');
    return j as T;
  } finally {
    clearTimeout(tiempo);
  }
}

export const enLinea = () => navigator.onLine;
