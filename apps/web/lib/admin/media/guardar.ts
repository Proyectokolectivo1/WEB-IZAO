/** Escritura de variantes en `MEDIA_ROOT/{kind}/{yyyy}/{mm}/{uuid}-{ancho}.webp` (§27.1). */
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Variante } from './procesar';

export function rutaBase(kind: string, fecha: Date, uuid: string): string {
  const mes = String(fecha.getUTCMonth() + 1).padStart(2, '0');
  return `${kind}/${fecha.getUTCFullYear()}/${mes}/${uuid}`;
}

/** Carpeta de medios: `MEDIA_ROOT`, o una carpeta ignorada por git en desarrollo. */
export function raizMedia(): string {
  return process.env.MEDIA_ROOT?.trim() || path.join(process.cwd(), '.media-dev');
}

/**
 * Escribe cada variante y devuelve el mapa `ancho → ruta relativa` que va en
 * `media.variants`. Rechaza rutas que salgan de la raíz.
 */
export async function escribirVariantes(
  raiz: string,
  base: string,
  variantes: Variante[],
): Promise<Record<string, string>> {
  const raizAbs = path.resolve(raiz);
  const mapa: Record<string, string> = {};
  for (const v of variantes) {
    const relativa = `${base}-${v.ancho}.webp`;
    const destino = path.resolve(raizAbs, relativa);
    if (!destino.startsWith(raizAbs + path.sep)) throw new Error('Ruta de medios no permitida.');
    await mkdir(path.dirname(destino), { recursive: true });
    // Atómico: archivo temporal y `rename`, así nunca se sirve un WebP a medio escribir. El UUID nunca se sobreescribe.
    const temporal = `${destino}.${process.pid}.tmp`;
    try {
      await writeFile(temporal, v.buffer, { flag: 'wx' });
      await rename(temporal, destino);
    } catch (e) {
      await rm(temporal, { force: true });
      throw e;
    }
    mapa[String(v.ancho)] = relativa;
  }
  return mapa;
}
