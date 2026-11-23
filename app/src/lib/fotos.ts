/**
 * De un cuadro de la cámara a una foto cifrada lista para enviar:
 * 1) se reduce a 1280 px y se imprime un sello (fecha, hora, coordenadas, código);
 * 2) se calcula su huella SHA-256;
 * 3) se cifra para supervisión y se guarda en el teléfono.
 * La imagen legible nunca se guarda: solo queda en memoria mientras se muestra la vista previa.
 */
import { cifrarParaSupervision, importarPublica, sha256Hex } from './cripto';
import { db, leerConfig } from './db';
import type { FotoCifrada } from './tipos';
import { uuid } from './util';

const LADO_MAX = 1280;

export function dibujarConSello(origen: CanvasImageSource, ancho: number, alto: number, sello: string[]): HTMLCanvasElement {
  const escala = Math.min(1, LADO_MAX / Math.max(ancho, alto));
  const c = document.createElement('canvas');
  c.width = Math.round(ancho * escala);
  c.height = Math.round(alto * escala);
  const ctx = c.getContext('2d')!;
  ctx.drawImage(origen, 0, 0, c.width, c.height);
  const tam = Math.max(14, Math.round(c.width / 45));
  const alturaBanda = sello.length * (tam + 6) + 10;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, c.height - alturaBanda, c.width, alturaBanda);
  ctx.fillStyle = '#fff';
  ctx.font = `${tam}px system-ui, sans-serif`;
  sello.forEach((linea, i) => ctx.fillText(linea, 10, c.height - alturaBanda + 8 + (i + 1) * (tam + 6) - 6));
  return c;
}

export function canvasABlob(c: HTMLCanvasElement, calidad = 0.72): Promise<Blob> {
  return new Promise((ok, mal) => c.toBlob((b) => (b ? ok(b) : mal(new Error('No se pudo generar la imagen'))), 'image/jpeg', calidad));
}

export async function guardarCifrada(blob: Blob): Promise<FotoCifrada> {
  const conf = await leerConfig();
  if (!conf?.llavePublica) throw new Error('Falta la llave de supervisión. Pida al administrador que la configure y actualice la app.');
  const datos = await blob.arrayBuffer();
  const hash = await sha256Hex(datos);
  const { cifrado, llave } = await cifrarParaSupervision(datos, await importarPublica(conf.llavePublica));
  const mes = new Date().toISOString().slice(0, 7);
  const key = `f/${mes}/${uuid()}.bin`;
  await db.fotos.put({ key, blob: cifrado, subida: 0, creado: Date.now() });
  return { key, llave, hash };
}
