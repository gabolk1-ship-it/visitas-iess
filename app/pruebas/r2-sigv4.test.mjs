// Verifica la firma SigV4 de backend/R2.gs con el ejemplo oficial publicado por AWS
// (documentación S3: "Authenticating Requests: Using Query Parameters", ejemplo de URL prefirmada).
import fs from 'node:fs'; import vm from 'node:vm'; import crypto from 'node:crypto'; import assert from 'node:assert';
const aF = (b) => Array.from(b, (x) => (x > 127 ? x - 256 : x)); const aB = (a) => Buffer.from(a.map((x) => (x + 256) % 256));
const Utilities = { DigestAlgorithm: { SHA_256: 1 }, Charset: { UTF_8: 1 },
  computeDigest: (_, t) => aF(crypto.createHash('sha256').update(t, 'utf8').digest()),
  computeHmacSha256Signature: (v, k) => aF(crypto.createHmac('sha256', aB(k)).update(aB(v)).digest()),
  newBlob: (s) => ({ getBytes: () => aF(Buffer.from(s, 'utf8')) }) };
const ctx = { Utilities, encodeURIComponent }; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(new URL('../../backend/R2.gs', import.meta.url), 'utf8'), ctx);

const url = ctx.r2UrlFirmada_({
  host: 'examplebucket.s3.amazonaws.com', region: 'us-east-1', ruta: '/test.txt', metodo: 'GET', expira: 86400,
  accessKey: 'AKIAIOSFODNN7EXAMPLE', secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', ahora: new Date('2013-05-24T00:00:00Z')
});
assert.strictEqual(new URL(url).searchParams.get('X-Amz-Signature'), 'aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404');
console.log('Firma idéntica al ejemplo oficial de AWS ✔');
assert.ok(ctx.r2ClaveValida_('f/2026-11/0f8fad5b-d9cb-469f-a165-70867728950e.bin'));
assert.ok(!ctx.r2ClaveValida_('../secreto.txt'));
console.log('Validación de claves de objeto ✔');
