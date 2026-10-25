import 'server-only';
/**
 * Archivos de garantía (fotos y video) servidos solo con sesión del panel. Los datos del cliente (fotos de su producto
 * o de su casa, videos) no deben ser públicos: la ruta `/api/admin/garantias/archivo/{mediaId}` exige el permiso
 * `garantias.gestionar` y lee el archivo del disco del servidor con la ruta que dice la base. Aquí vive la parte que no
 * depende del navegador: elegir el archivo de forma segura, el tipo de contenido y los rangos de bytes (el video necesita
 * `Range` para poder adelantarse). Pruebas con una carpeta temporal.
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';

const TIPOS: Record<string, string> = {
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
};

export function tipoDeContenido(ruta: string): string | null {
  return TIPOS[path.extname(ruta).toLowerCase()] ?? null;
}

/** Ruta absoluta dentro de la raíz de medios, o `null` si intenta salirse de ella o no es un tipo permitido. */
export function resolverRuta(raiz: string, relativa: string): string | null {
  if (typeof relativa !== 'string' || relativa === '' || relativa.includes('\0')) return null;
  const raizAbs = path.resolve(raiz);
  const destino = path.resolve(raizAbs, relativa);
  if (!destino.startsWith(raizAbs + path.sep)) return null;
  return tipoDeContenido(destino) ? destino : null;
}

export type Rango = { inicio: number; fin: number };

/** `bytes=0-99`, `bytes=100-` o `bytes=-50`. `null` = sin rango; `'invalido'` = no satisfacible (416). */
export function parsearRango(cabecera: string | null, tamano: number): Rango | null | 'invalido' {
  if (!cabecera) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(cabecera.trim());
  if (!m || (m[1] === '' && m[2] === '')) return 'invalido';
  let inicio: number;
  let fin: number;
  if (m[1] === '') {
    const ultimos = Number(m[2]);
    if (ultimos <= 0) return 'invalido';
    inicio = Math.max(0, tamano - ultimos);
    fin = tamano - 1;
  } else {
    inicio = Number(m[1]);
    fin = m[2] === '' ? tamano - 1 : Math.min(Number(m[2]), tamano - 1);
  }
  if (!Number.isSafeInteger(inicio) || inicio >= tamano || fin < inicio) return 'invalido';
  return { inicio, fin };
}

export type MediaGarantia = { kind: string; variants: Record<string, string> | null } | null;

/** Qué archivo de una fila `media` se pide: el video, o un ancho de foto (por defecto 800 o el que exista). */
export function rutaDeVariante(media: MediaGarantia, variante: string): string | null {
  if (!media || media.kind !== 'warranty' || !media.variants) return null;
  const v = media.variants;
  if (variante === 'video') return typeof v.video === 'string' ? v.video : null;
  if (!/^\d{2,4}$/.test(variante)) return null;
  return typeof v[variante] === 'string' ? v[variante] : null;
}

export type Respuesta = { status: number; headers: Record<string, string>; cuerpo: ReadableStream | null };

/** Arma la respuesta de un archivo de garantía (con soporte de `Range`). Los errores no revelan rutas. */
export async function servirArchivoGarantia(args: {
  media: MediaGarantia;
  variante: string;
  rango: string | null;
  raiz: string;
}): Promise<Respuesta> {
  const relativa = rutaDeVariante(args.media, args.variante);
  const ruta = relativa ? resolverRuta(args.raiz, relativa) : null;
  if (!ruta) return { status: 404, headers: {}, cuerpo: null };
  let tamano: number;
  try {
    const info = await stat(ruta);
    if (!info.isFile()) return { status: 404, headers: {}, cuerpo: null };
    tamano = info.size;
  } catch {
    return { status: 404, headers: {}, cuerpo: null };
  }
  const base: Record<string, string> = {
    'Content-Type': tipoDeContenido(ruta)!,
    'Accept-Ranges': 'bytes',
    // Solo para quien tiene sesión: nunca en cachés compartidas.
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': 'inline',
  };
  const rango = parsearRango(args.rango, tamano);
  if (rango === 'invalido') return { status: 416, headers: { ...base, 'Content-Range': `bytes */${tamano}` }, cuerpo: null };
  if (rango === null) {
    return { status: 200, headers: { ...base, 'Content-Length': String(tamano) }, cuerpo: Readable.toWeb(createReadStream(ruta)) as ReadableStream };
  }
  return {
    status: 206,
    headers: { ...base, 'Content-Length': String(rango.fin - rango.inicio + 1), 'Content-Range': `bytes ${rango.inicio}-${rango.fin}/${tamano}` },
    cuerpo: Readable.toWeb(createReadStream(ruta, { start: rango.inicio, end: rango.fin })) as ReadableStream,
  };
}
