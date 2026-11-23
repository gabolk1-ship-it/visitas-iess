/**
 * Cifrado con WebCrypto, sin librerías externas.
 * - Fotos: AES-GCM 256 con llave nueva por foto; esa llave se envuelve con RSA-OAEP (llave pública de supervisión).
 *   El teléfono no puede volver a abrir la foto; solo quien tenga la llave privada.
 * - Datos locales: AES-GCM con llave derivada del PIN (PBKDF2).
 * - Llave privada de supervisión: guardada cifrada con una frase secreta (PBKDF2 + AES-GCM).
 */
import type { LlavePublica } from './tipos';

const te = new TextEncoder();
const td = new TextDecoder();

export function aBase64(buf: ArrayBuffer | Uint8Array<ArrayBuffer>): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function deBase64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export async function sha256Hex(datos: ArrayBuffer | Uint8Array<ArrayBuffer> | string): Promise<string> {
  const buf = typeof datos === 'string' ? te.encode(datos) : datos;
  const h = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(h), (b) => b.toString(16).padStart(2, '0')).join('');
}

const RSA = { name: 'RSA-OAEP', hash: 'SHA-256' } as const;

export async function importarPublica(jwk: LlavePublica): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', { ...jwk, alg: 'RSA-OAEP-256', ext: true } as JsonWebKey, RSA, false, ['wrapKey', 'encrypt']);
}

/** Cifra bytes con una llave AES nueva y la envuelve con la llave pública. */
export async function cifrarParaSupervision(datos: ArrayBuffer, publica: CryptoKey): Promise<{ cifrado: Uint8Array<ArrayBuffer>; llave: string }> {
  const aes = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cifrado = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, datos));
  const envuelta = await crypto.subtle.wrapKey('raw', aes, publica, RSA);
  return { cifrado, llave: JSON.stringify({ v: 1, k: aBase64(envuelta), iv: aBase64(iv) }) };
}

export async function descifrarDeSupervision(cifrado: ArrayBuffer, llave: string, privada: CryptoKey): Promise<ArrayBuffer> {
  const { k, iv } = JSON.parse(llave) as { k: string; iv: string };
  const aes = await crypto.subtle.unwrapKey('raw', deBase64(k), privada, RSA, { name: 'AES-GCM' }, false, ['decrypt']);
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: deBase64(iv) }, aes, cifrado);
}

/** Llave AES derivada de un secreto (PIN o frase). */
export async function derivarLlave(secreto: string, sal: Uint8Array<ArrayBuffer>, iteraciones = 310000): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', te.encode(secreto), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: sal, iterations: iteraciones, hash: 'SHA-256' }, base,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function cifrarTexto(texto: string, llave: CryptoKey): Promise<{ iv: string; datos: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const c = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, llave, te.encode(texto));
  return { iv: aBase64(iv), datos: aBase64(c) };
}

export async function descifrarTexto(c: { iv: string; datos: string }, llave: CryptoKey): Promise<string> {
  const p = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: deBase64(c.iv) }, llave, deBase64(c.datos));
  return td.decode(p);
}

export interface PrivadaCifrada { v: 1; sal: string; iter: number; iv: string; datos: string }

/** Genera el par de llaves de supervisión (lo usa la herramienta del administrador). */
export async function generarParSupervision(frase: string): Promise<{ publica: JsonWebKey; privadaCifrada: PrivadaCifrada }> {
  const par = await crypto.subtle.generateKey({ ...RSA, modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]) }, true, ['wrapKey', 'unwrapKey', 'encrypt', 'decrypt']);
  const publica = await crypto.subtle.exportKey('jwk', par.publicKey);
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', par.privateKey);
  const sal = crypto.getRandomValues(new Uint8Array(16));
  const iter = 310000;
  const llave = await derivarLlave(frase, sal, iter);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const datos = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, llave, pkcs8);
  return {
    publica: { kty: publica.kty, n: publica.n, e: publica.e, alg: 'RSA-OAEP-256' },
    privadaCifrada: { v: 1, sal: aBase64(sal), iter, iv: aBase64(iv), datos: aBase64(datos) }
  };
}

export async function abrirPrivada(pc: PrivadaCifrada, frase: string): Promise<CryptoKey> {
  const llave = await derivarLlave(frase, deBase64(pc.sal), pc.iter);
  const pkcs8 = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: deBase64(pc.iv) }, llave, deBase64(pc.datos));
  return crypto.subtle.importKey('pkcs8', pkcs8, RSA, false, ['unwrapKey', 'decrypt']);
}
