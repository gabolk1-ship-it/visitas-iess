// Copia el motor OCR y el idioma a public/tesseract para servirlos desde la app (funciona sin señal).
import fs from 'node:fs';
import path from 'node:path';
const raiz = path.resolve(import.meta.dirname, '..');
const destino = path.join(raiz, 'public', 'tesseract');
fs.mkdirSync(path.join(destino, 'lang'), { recursive: true });
const copiar = (de, a) => fs.copyFileSync(path.join(raiz, 'node_modules', de), path.join(destino, a));
copiar('tesseract.js/dist/worker.min.js', 'worker.min.js');
for (const f of ['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js']) {
  if (fs.existsSync(path.join(raiz, 'node_modules', 'tesseract.js-core', f))) copiar('tesseract.js-core/' + f, f);
}
copiar('@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'lang/eng.traineddata.gz');
console.log('Archivos de OCR copiados a public/tesseract');
