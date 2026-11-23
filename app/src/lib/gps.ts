import type { Lectura, Ubicacion } from './tipos';

/**
 * Toma varias lecturas GPS en vivo (nunca de caché: maximumAge = 0) durante hasta `maxMs`.
 * Termina antes si junta `minLecturas` con precisión aceptable.
 * Las lecturas se guardan: si todas son idénticas, el servidor sospecha de GPS simulado.
 */
export function obtenerUbicacion(precisionMaxM: number, maxMs = 20000, minLecturas = 3,
  alProgreso?: (l: Lectura, n: number) => void): Promise<Ubicacion> {
  return new Promise((resolver, rechazar) => {
    if (!('geolocation' in navigator)) { rechazar(new Error('Este teléfono no tiene GPS disponible')); return; }
    const lecturas: Lectura[] = [];
    let terminado = false;
    const fin = () => {
      if (terminado) return;
      terminado = true;
      navigator.geolocation.clearWatch(id);
      clearTimeout(t);
      if (!lecturas.length) { rechazar(new Error('No se obtuvo ubicación. Active el GPS y salga a cielo abierto.')); return; }
      const mejor = lecturas.reduce((a, b) => (b.precision < a.precision ? b : a));
      resolver({ lat: mejor.lat, lon: mejor.lon, precision: Math.round(mejor.precision), lecturas });
    };
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const l = { lat: p.coords.latitude, lon: p.coords.longitude, precision: p.coords.accuracy, t: p.timestamp };
        lecturas.push(l);
        alProgreso?.(l, lecturas.length);
        if (lecturas.filter((x) => x.precision <= precisionMaxM).length >= minLecturas) fin();
      },
      (e) => {
        if (e.code === e.PERMISSION_DENIED) { terminado = true; navigator.geolocation.clearWatch(id); clearTimeout(t); rechazar(new Error('Permiso de ubicación negado. Actívelo en los ajustes del navegador.')); }
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: maxMs }
    );
    const t = setTimeout(fin, maxMs);
  });
}
