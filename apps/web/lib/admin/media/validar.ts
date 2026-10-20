/** Validación de subidas por magic bytes (§26.1, §27.1). Nunca se confía en la extensión. */

export const MAX_BYTES = 15 * 1024 * 1024;

export type TipoImagen = 'jpeg' | 'png' | 'webp' | 'avif';

export function detectarTipo(b: Buffer): TipoImagen | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'png';
  }
  if (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    return 'webp';
  }
  if (b.length >= 12 && b.toString('ascii', 4, 8) === 'ftyp') {
    const marca = b.toString('ascii', 8, 12);
    if (marca === 'avif' || marca === 'avis') return 'avif';
  }
  return null;
}

export type ResultadoValidacion =
  | { ok: true; tipo: TipoImagen }
  | { ok: false; error: 'vacio' | 'tamano' | 'tipo' };

/** El nombre solo se recibe para dejar claro que NO se usa: decide el contenido. */
export function validarArchivo(a: { buffer: Buffer; nombre: string }): ResultadoValidacion {
  if (a.buffer.length === 0) return { ok: false, error: 'vacio' };
  if (a.buffer.length > MAX_BYTES) return { ok: false, error: 'tamano' };
  const tipo = detectarTipo(a.buffer);
  return tipo ? { ok: true, tipo } : { ok: false, error: 'tipo' };
}

export const MENSAJES_VALIDACION: Record<'vacio' | 'tamano' | 'tipo', string> = {
  vacio: 'El archivo está vacío.',
  tamano: 'La imagen supera los 15 MB.',
  tipo: 'Solo se aceptan imágenes JPG, PNG, WebP o AVIF.',
};
