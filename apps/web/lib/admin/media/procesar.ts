/**
 * Pipeline de imágenes con `sharp` (§27.1): rotación por EXIF, sin metadatos,
 * recorte opcional a 4:5, WebP calidad 80 (effort 5) en 400/800/1600 sin agrandar
 * y LQIP de 16 px en base64.
 */
import sharp from 'sharp';

// Para no ahogar el VPS (skill izao-imagenes).
sharp.concurrency(2);

export const ANCHOS = [400, 800, 1600] as const;
const LIMITE_PIXELES = 100_000_000;

export type Variante = { ancho: number; alto: number; buffer: Buffer };

export type ImagenProcesada = {
  /** Dimensiones tras aplicar la rotación EXIF (y el recorte, si lo hay). */
  ancho: number;
  alto: number;
  variantes: Variante[];
  lqip: string;
};

export async function procesarImagen(args: { buffer: Buffer; recorte45: boolean }): Promise<ImagenProcesada> {
  const abrir = () => sharp(args.buffer, { limitInputPixels: LIMITE_PIXELES, failOn: 'error' }).rotate();

  // Dimensiones reales después de rotar.
  const rotada = await abrir().toBuffer({ resolveWithObject: true });
  let ancho = rotada.info.width;
  let alto = rotada.info.height;
  let base = sharp(rotada.data);

  if (args.recorte45) {
    // 4:5 (ancho:alto) recortando al centro, sin agrandar.
    const w = Math.min(ancho, Math.floor((alto * 4) / 5));
    const h = Math.round((w * 5) / 4);
    const recortada = await base
      .resize({ width: w, height: h, fit: 'cover', position: 'centre', withoutEnlargement: true })
      .toBuffer({ resolveWithObject: true });
    ancho = recortada.info.width;
    alto = recortada.info.height;
    base = sharp(recortada.data);
  }

  const caben: number[] = ANCHOS.filter((a) => a <= ancho);
  const mayor = caben.at(-1) ?? 0;
  // Nunca se agranda: si la original cae entre dos anchos (o es menor que 400), su ancho es el techo.
  if (ancho > mayor && ancho < 1600) caben.push(ancho);

  const variantes: Variante[] = [];
  for (const a of caben) {
    const { data, info } = await base
      .clone()
      .resize({ width: a, withoutEnlargement: true })
      .webp({ quality: 80, effort: 5 }) // sin .withMetadata(): se eliminan EXIF y demás
      .toBuffer({ resolveWithObject: true });
    variantes.push({ ancho: info.width, alto: info.height, buffer: data });
  }

  const pequena = await base.clone().resize({ width: 16 }).webp({ quality: 40 }).toBuffer();
  return { ancho, alto, variantes, lqip: `data:image/webp;base64,${pequena.toString('base64')}` };
}
