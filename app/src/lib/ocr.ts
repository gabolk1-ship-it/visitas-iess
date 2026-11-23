/**
 * Lectura de lote y vencimiento impresos en la caja (OCR dentro del teléfono, sin enviar la imagen).
 * Tesseract y su idioma se sirven desde la propia app, así funciona sin señal.
 */
import type { Worker } from 'tesseract.js';

let trabajador: Promise<Worker> | null = null;

function obtenerTrabajador(): Promise<Worker> {
  if (!trabajador) {
    trabajador = (async () => {
      const { createWorker } = await import('tesseract.js');
      const base = import.meta.env.BASE_URL + 'tesseract/';
      const w = await createWorker('eng', 1, {
        workerPath: base + 'worker.min.js',
        corePath: base,
        langPath: base + 'lang',
        gzip: true,
        workerBlobURL: false
      });
      await w.setParameters({ tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789:/.-# ' });
      return w;
    })();
  }
  return trabajador;
}

/** Precarga el OCR en segundo plano (al retirar el maletín, con señal). */
export function precargarOcr() {
  obtenerTrabajador().catch(() => { trabajador = null; });
}

const MESES: Record<string, number> = {
  ENE: 1, JAN: 1, FEB: 2, MAR: 3, ABR: 4, APR: 4, MAY: 5, JUN: 6, JUL: 7, AGO: 8, AUG: 8,
  SEP: 9, SET: 9, OCT: 10, NOV: 11, DIC: 12, DEC: 12
};

function finDeMes(anio: number, mes: number): string {
  const dia = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

function anio4(a: number): number {
  return a < 100 ? 2000 + a : a;
}

/** Convierte las formas comunes de vencimiento a AAAA-MM-DD (fin de mes si no trae día). */
export function normalizarFecha(txt: string): string | null {
  const s = txt.toUpperCase().replace(/\s+/g, ' ').trim();
  let m = s.match(/^(\d{4})[\/\-.](\d{1,2})(?:[\/\-.](\d{1,2}))?$/);
  if (m) {
    const mes = +m[2];
    if (mes < 1 || mes > 12) return null;
    return m[3] ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : finDeMes(+m[1], mes);
  }
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) {
    const mes = +m[2];
    if (mes < 1 || mes > 12) return null;
    return `${anio4(+m[3])}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  m = s.match(/^(\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) {
    const mes = +m[1];
    if (mes < 1 || mes > 12) return null;
    return finDeMes(anio4(+m[2]), mes);
  }
  m = s.match(/^([A-Z]{3})[A-Z]*[ \/\-.]?(\d{2,4})$/);
  if (m && MESES[m[1]]) return finDeMes(anio4(+m[2]), MESES[m[1]]);
  return null;
}

export interface LecturaCaja { lote: string | null; vencimiento: string | null; texto: string }

/** Busca lote y vencimiento en el texto leído. */
export function extraerLoteYVencimiento(texto: string): LecturaCaja {
  const t = texto.replace(/\r/g, '').toUpperCase();
  const lote = t.match(/\b(?:LOTE|LOT|LT|BATCH|L)\s*(?:N[O°º]\.?)?\s*[:.#]?\s*([A-Z0-9][A-Z0-9\-\/]{2,15})/);
  const fechaPat = '(\\d{4}[\\/\\-.]\\d{1,2}(?:[\\/\\-.]\\d{1,2})?|\\d{1,2}[\\/\\-.]\\d{1,2}[\\/\\-.]\\d{2,4}|\\d{1,2}[\\/\\-.]\\d{2,4}|[A-Z]{3}[A-Z]*[ \\/\\-.]?\\d{2,4})';
  const venc = t.match(new RegExp('\\b(?:VENC[A-Z.]*|VTO\\.?|VENCE|EXP[A-Z.]*|CAD[A-Z.]*|F\\.?\\s?V\\.?)\\s*[:.]?\\s*' + fechaPat));
  let vencimiento = venc ? normalizarFecha(venc[1]) : null;
  if (!vencimiento) {
    // Sin etiqueta: la fecha más lejana del texto suele ser el vencimiento.
    const todas = [...t.matchAll(new RegExp(fechaPat, 'g'))].map((x) => normalizarFecha(x[1])).filter(Boolean) as string[];
    vencimiento = todas.sort().pop() || null;
  }
  const loteVal = lote ? lote[1].replace(/[\/\-]+$/, '') : null;
  return { lote: loteVal && !/^(VENC|EXP|CAD)/.test(loteVal) ? loteVal : null, vencimiento, texto };
}

export async function leerCaja(imagen: HTMLCanvasElement | Blob): Promise<LecturaCaja> {
  const w = await obtenerTrabajador();
  const { data } = await w.recognize(imagen);
  return extraerLoteYVencimiento(data.text || '');
}
