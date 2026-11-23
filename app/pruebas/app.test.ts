import { describe, expect, it } from 'vitest';
import { abrirPrivada, cifrarParaSupervision, descifrarDeSupervision, generarParSupervision, importarPublica, sha256Hex, derivarLlave, cifrarTexto, descifrarTexto } from '../src/lib/cripto';
import { extraerLoteYVencimiento, normalizarFecha } from '../src/lib/ocr';
import { distanciaM, normalizarLote } from '../src/lib/util';

describe('cifrado de fotos para supervisión', () => {
  it('cifra con la pública y solo la privada (con su frase) descifra', async () => {
    const { publica, privadaCifrada } = await generarParSupervision('frase de prueba larga');
    const foto = new TextEncoder().encode('JPEG simulado ' + 'x'.repeat(5000)).buffer;
    const { cifrado, llave } = await cifrarParaSupervision(foto, await importarPublica(publica as never));
    expect(new TextDecoder().decode(cifrado)).not.toContain('JPEG simulado');
    const privada = await abrirPrivada(privadaCifrada, 'frase de prueba larga');
    const claro = await descifrarDeSupervision(cifrado.buffer, llave, privada);
    expect(new TextDecoder().decode(claro)).toBe(new TextDecoder().decode(foto));
    await expect(abrirPrivada(privadaCifrada, 'frase equivocada')).rejects.toThrow();
  }, 30000);

  it('datos locales: solo el PIN correcto descifra', async () => {
    const sal = crypto.getRandomValues(new Uint8Array(16));
    const c = await cifrarTexto('{"receptor":"0912345678"}', await derivarLlave('123456', sal, 1000));
    expect(await descifrarTexto(c, await derivarLlave('123456', sal, 1000))).toContain('0912345678');
    await expect(descifrarTexto(c, await derivarLlave('654321', sal, 1000))).rejects.toThrow();
  });

  it('huella SHA-256 conocida', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('lectura de lote y vencimiento', () => {
  it.each([
    ['LOTE: AB1234\nVENC: 08/2027', 'AB1234', '2027-08-31'],
    ['Lot 22K019 Exp 2026-11', '22K019', '2026-11-30'],
    ['L: 4567A  VTO. 03/28', '4567A', '2028-03-31'],
    ['LOTE N° X99-12 F.V. 15/07/2027', 'X99-12', '2027-07-15'],
    ['BATCH 7781 EXP NOV 2026', '7781', '2026-11-30'],
    ['CAD: ABR-2027 LOTE 556677', '556677', '2027-04-30']
  ])('%s', (texto, lote, venc) => {
    const r = extraerLoteYVencimiento(texto);
    expect(r.lote).toBe(lote);
    expect(r.vencimiento).toBe(venc);
  });
  it('sin etiqueta toma la fecha más lejana', () => {
    expect(extraerLoteYVencimiento('FAB 01/2025 06/2027').vencimiento).toBe('2027-06-30');
  });
  it('rechaza meses imposibles', () => {
    expect(normalizarFecha('13/2027')).toBeNull();
    expect(normalizarFecha('02/2028')).toBe('2028-02-29');
  });
});

describe('utilidades', () => {
  it('lotes equivalentes pese a confusiones de OCR', () => {
    expect(normalizarLote('ab-1O2I')).toBe(normalizarLote('AB1021'));
  });
  it('distancia aproximada en Quito', () => {
    const d = distanciaM(-0.1105, -78.4983, -0.1114, -78.4983);
    expect(d).toBeGreaterThan(95);
    expect(d).toBeLessThan(105);
  });
});
