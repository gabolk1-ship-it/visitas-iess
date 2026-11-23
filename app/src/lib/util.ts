export const uuid = () => crypto.randomUUID();

/** Fecha local de Ecuador en formato AAAA-MM-DD. */
export function hoy(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil' }).format(d);
}

export function horaLocal(d = new Date()): string {
  return new Intl.DateTimeFormat('es-EC', { timeZone: 'America/Guayaquil', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(d);
}

export function distanciaM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function normalizarLote(s: string): string {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
}

/** ¿Es un teléfono o tableta? La app de campo no funciona en computadoras. */
export function esMovil(): boolean {
  const ua = navigator.userAgent;
  return navigator.maxTouchPoints > 0 && /Android|iPhone|iPad|iPod|Mobile/i.test(ua) ||
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1); // iPad con iPadOS
}

export function plataforma(): string {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return 'Android ' + (ua.match(/Android ([\d.]+)/)?.[1] || '');
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iOS ' + (ua.match(/OS ([\d_]+)/)?.[1]?.replace(/_/g, '.') || '');
  return 'Otro';
}
