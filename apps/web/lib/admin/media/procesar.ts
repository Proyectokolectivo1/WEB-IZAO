/**
 * Pipeline de imágenes con `sharp` (§27.1): rotación por EXIF, sin metadatos,
 * recorte opcional a 4:5, WebP calidad 80 (effort 5) en 400/800/1600 sin agrandar
 * y LQIP de 16 px en base64.
 *
 * Memoria: la imagen NUNCA se decodifica ni se recodifica completa antes de redimensionar. Se leen las dimensiones
 * de la cabecera y cada salida es un único pipeline (rotar, recortar, redimensionar, WebP) sobre el buffer original,
 * de modo que JPEG/WebP se reducen al decodificar. Antes de decodificar se rechazan las imágenes con demasiados
 * píxeles (una «bomba» PNG de 10000×10000 pesa pocos KB) y solo se procesan 2 imágenes a la vez por proceso.
 */
import sharp from 'sharp';
import { SemaforoOcupado, crearSemaforo } from './semaforo';

// Para no ahogar el VPS (skill izao-imagenes). Sin caché de libvips: cada subida es única y la caché solo retiene memoria.
sharp.cache(false);
sharp.concurrency(2);

export const ANCHOS = [400, 800, 1600] as const;
/**
 * Banners (skill izao-imagenes, D-047): UNA sola imagen por banner con el conjunto responsive `unica`
 * (480/800/1200/1600/2400, sin recorte y sin agrandar; la tienda elige con `srcset`). `desktop` y `movil` son los
 * conjuntos de los banners antiguos de dos imágenes y se conservan por compatibilidad.
 */
export const ANCHOS_BANNER = {
  unica: [480, 800, 1200, 1600, 2400],
  desktop: [800, 1600, 2400],
  movil: [400, 800, 1200],
} as const;
export const CALIDAD_WEBP_POR_DEFECTO = 80;

/** Megapíxeles máximos de entrada: panel (equipo de confianza, fotos de cámara) y público (reseñas y garantías). */
export const LIMITE_PIXELES_PANEL = 40_000_000;
export const LIMITE_PIXELES_PUBLICO = 25_000_000;
/** Imágenes que se procesan a la vez por proceso y espera máxima por un turno. */
export const PROCESOS_SIMULTANEOS = 2;
export const ESPERA_MAXIMA_MS = 20_000;

const semaforo = crearSemaforo(PROCESOS_SIMULTANEOS);

export type Variante = { ancho: number; alto: number; buffer: Buffer };

export type ImagenProcesada = {
  /** Dimensiones tras aplicar la rotación EXIF (y el recorte, si lo hay). */
  ancho: number;
  alto: number;
  variantes: Variante[];
  lqip: string;
};

export type CodigoErrorImagen = 'demasiado_grande' | 'ocupado' | 'ilegible';

export class ErrorImagen extends Error {
  constructor(
    readonly codigo: CodigoErrorImagen,
    mensaje: string,
  ) {
    super(mensaje);
    this.name = 'ErrorImagen';
  }
}

/** Mensaje para quien sube la imagen, según el código. */
export function mensajeErrorImagen(e: unknown): string {
  if (e instanceof ErrorImagen) {
    if (e.codigo === 'demasiado_grande') return 'La imagen tiene demasiados píxeles. Redúcela e inténtalo de nuevo.';
    if (e.codigo === 'ocupado') return 'Hay muchas imágenes en proceso. Espera unos segundos e inténtalo de nuevo.';
  }
  return 'No se pudo leer la imagen. Prueba con otro archivo.';
}

export async function procesarImagen(args: {
  buffer: Buffer;
  recorte45: boolean;
  /** Anchos de salida. Por defecto 400/800/1600. */
  anchos?: readonly number[];
  /** Calidad WebP 1–100 (configurable en el panel). Por defecto 80. */
  calidad?: number;
  /** Quién sube: el panel admite más píxeles que el público. Por defecto `publico` (el límite más estricto). */
  origen?: 'panel' | 'publico';
}): Promise<ImagenProcesada> {
  const anchos = [...(args.anchos ?? ANCHOS)].sort((a, b) => a - b);
  const techo = anchos.at(-1) ?? 1600;
  const calidad = Math.min(100, Math.max(1, Math.round(args.calidad ?? CALIDAD_WEBP_POR_DEFECTO)));
  const limite = args.origen === 'panel' ? LIMITE_PIXELES_PANEL : LIMITE_PIXELES_PUBLICO;

  let liberar: () => void;
  try {
    liberar = await semaforo.adquirir(ESPERA_MAXIMA_MS);
  } catch (e) {
    if (e instanceof SemaforoOcupado) throw new ErrorImagen('ocupado', e.message);
    throw e;
  }
  try {
    return await procesar(args.buffer, { anchos, techo, calidad, limite, recorte45: args.recorte45 });
  } finally {
    liberar();
  }
}

async function procesar(
  buffer: Buffer,
  o: { anchos: number[]; techo: number; calidad: number; limite: number; recorte45: boolean },
): Promise<ImagenProcesada> {
  // Un pipeline nuevo por salida: rotar por EXIF (antes de recortar), recorte opcional y redimensionado.
  const abrir = () => sharp(buffer, { limitInputPixels: o.limite, failOn: 'error' }).rotate();

  // Solo cabecera: no decodifica píxeles.
  const meta = await sharp(buffer, { failOn: 'error' }).metadata();
  if (!meta.width || !meta.height) throw new ErrorImagen('ilegible', 'Imagen sin dimensiones.');
  if (meta.width * meta.height > o.limite) {
    throw new ErrorImagen('demasiado_grande', `La imagen supera ${o.limite / 1_000_000} megapíxeles.`);
  }
  // Orientaciones EXIF 5–8 intercambian ancho y alto.
  const girada = (meta.orientation ?? 1) >= 5;
  let ancho = girada ? meta.height : meta.width;
  let alto = girada ? meta.width : meta.height;

  let region: { left: number; top: number; width: number; height: number } | null = null;
  if (o.recorte45) {
    // 4:5 (ancho:alto) recortando al centro, sin agrandar.
    const w = Math.min(ancho, Math.floor((alto * 4) / 5));
    const h = Math.min(alto, Math.round((w * 5) / 4));
    region = { left: Math.floor((ancho - w) / 2), top: Math.floor((alto - h) / 2), width: w, height: h };
    ancho = w;
    alto = h;
  }
  const preparar = () => {
    const p = abrir();
    return region ? p.extract(region) : p;
  };

  const caben: number[] = o.anchos.filter((a) => a <= ancho);
  const mayor = caben.at(-1) ?? 0;
  // Nunca se agranda: si la original cae entre dos anchos (o es menor que el menor), su ancho es el techo.
  if (ancho > mayor && ancho < o.techo) caben.push(ancho);

  try {
    const variantes: Variante[] = [];
    for (const a of caben) {
      const { data, info } = await preparar()
        .resize({ width: a, withoutEnlargement: true })
        .webp({ quality: o.calidad, effort: 5 }) // sin .withMetadata(): se eliminan EXIF y demás
        .toBuffer({ resolveWithObject: true });
      variantes.push({ ancho: info.width, alto: info.height, buffer: data });
    }
    const pequena = await preparar().resize({ width: 16 }).webp({ quality: 40 }).toBuffer();
    return { ancho, alto, variantes, lqip: `data:image/webp;base64,${pequena.toString('base64')}` };
  } catch (e) {
    if (e instanceof Error && /pixel limit/i.test(e.message)) throw new ErrorImagen('demasiado_grande', e.message);
    throw e;
  }
}
