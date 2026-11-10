/**
 * Fotos sintéticas WebP para medir Lighthouse local con pesos parecidos a los de producción (el ejemplo no trae fotos):
 * banner 1218×481 (480/800/1200 px: ~12/34/78 KB) y foto de producto (300/400 px: ~18/31 KB). Escribe en `public/media/lab/`
 * (ignorada por git). Se usan con `EJEMPLO_FOTOS=1` en el servidor del build de ejemplo:
 *
 *   node tests/lighthouse/generar-fotos-lab.cjs
 *   EJEMPLO_FOTOS=1 [EJEMPLO_LATENCIA_MS=180] STORE_DATOS=ejemplo ... next start      # 1 solo banner hero (como producción) y fotos en las tarjetas
 *
 * `EJEMPLO_LATENCIA_MS` simula el tiempo de la base en el primer lote del catálogo (para ver el efecto del streaming).
 */
/* eslint-disable @typescript-eslint/no-require-imports -- script CommonJS de apoyo */
const fs = require('node:fs');
const path = require('node:path');
const sharp = require(path.resolve(__dirname, '../../../../node_modules/sharp'));

const salida = path.resolve(__dirname, '../../public/media/lab');
fs.mkdirSync(salida, { recursive: true });

async function foto(w, h, calidad, nombre, semilla) {
  // Ruido de baja frecuencia (manchas de color) más grano fino: pesa como una foto y no como un degradado.
  const g = 32;
  const bw = Math.ceil(w / g);
  const bh = Math.ceil(h / g);
  const base = Buffer.alloc(bw * bh * 3);
  let s = semilla;
  const azar = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < base.length; i++) base[i] = 90 + Math.floor(azar() * 120);
  const grande = await sharp(base, { raw: { width: bw, height: bh, channels: 3 } }).resize(w, h, { kernel: 'cubic' }).raw().toBuffer();
  for (let i = 0; i < grande.length; i++) grande[i] = Math.max(0, Math.min(255, grande[i] + (azar() - 0.5) * 38));
  const buf = await sharp(grande, { raw: { width: w, height: h, channels: 3 } }).webp({ quality: calidad }).toBuffer();
  fs.writeFileSync(path.join(salida, nombre), buf);
  console.log(nombre, `${Math.round(buf.length / 1024)} KB`);
}

(async () => {
  for (const w of [480, 800, 1200]) await foto(w, Math.round((w * 481) / 1218), 62, `banner-${w}.webp`, 7 + w);
  for (const w of [300, 400]) await foto(w, Math.round(w * 1.25), 70, `prod-${w}.webp`, 3 + w);
})();
