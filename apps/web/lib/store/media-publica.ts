/**
 * Archivos que sube el público (reseñas, garantías) con el rol de servicio. Las fotos se validan por magic bytes y se
 * re-codifican a WebP con el pipeline de `izao-imagenes` (elimina EXIF y contenido incrustado, §26.1); cada una queda
 * como fila de `media` del `kind` indicado. SOLO SERVIDOR.
 */
import 'server-only';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';
import { escribirVariantes, raizMedia, rutaBase } from '@/lib/admin/media/guardar';
import { procesarImagen } from '@/lib/admin/media/procesar';
import { validarArchivo } from '@/lib/admin/media/validar';

export const nombreSeguro = (n: string) => path.basename(n).replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 200);

/** Guarda una foto y devuelve el id de `media`; `null` si no es una imagen válida. Lanza si falla la base. */
export async function guardarFotoPublica(args: { kind: 'warranty' | 'review'; alt: string; buffer: Buffer; nombre: string }): Promise<string | null> {
  if (!validarArchivo({ buffer: args.buffer, nombre: args.nombre }).ok) return null;
  let procesada;
  try {
    procesada = await procesarImagen({ buffer: args.buffer, recorte45: false });
  } catch {
    return null;
  }
  const id = randomUUID();
  const base = rutaBase(args.kind, new Date(), id);
  const raiz = raizMedia();
  const variants = await escribirVariantes(raiz, base, procesada.variantes);
  const { error } = await crearClienteServicio()
    .from('media')
    .insert({
      id,
      kind: args.kind,
      base_path: base,
      original_name: nombreSeguro(args.nombre),
      width: procesada.ancho,
      height: procesada.alto,
      variants,
      lqip: procesada.lqip,
      alt: args.alt,
      bytes: procesada.variantes.reduce((s, v) => s + v.buffer.length, 0),
    });
  if (error) {
    await Promise.all(Object.values(variants).map((r) => rm(path.join(raiz, r), { force: true })));
    throw new Error(`media: ${error.message}`);
  }
  return id;
}

/** Borra archivos y filas de `media` (limpieza si el caso o la reseña no llegó a crearse). */
export async function descartarMediaPublica(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const cliente = crearClienteServicio();
  const { data } = await cliente.from('media').select('id, variants').in('id', ids);
  const raiz = path.resolve(raizMedia());
  for (const f of (data ?? []) as { id: string; variants: Record<string, string> | null }[]) {
    for (const r of Object.values(f.variants ?? {})) {
      const destino = path.resolve(raiz, r);
      if (destino.startsWith(raiz + path.sep)) await rm(destino, { force: true });
    }
  }
  await cliente.from('media').delete().in('id', ids);
}
