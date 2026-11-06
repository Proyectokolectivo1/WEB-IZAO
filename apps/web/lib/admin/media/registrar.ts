import 'server-only';
/** Subida completa: validar, procesar, guardar archivos, fila en `media` y auditoría. */
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { auditarCambio } from '@/lib/admin/auditoria';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';
import type { DatosSubida } from './esquema';
import { bytesMaximos } from './ajustes';
import { leerAjustesMedia } from './ajustes-servidor';
import { escribirVariantes, raizMedia, rutaBase } from './guardar';
import { ANCHOS_BANNER, mensajeErrorImagen, procesarImagen } from './procesar';
import { MENSAJES_VALIDACION, validarArchivo } from './validar';

export type MediaSubida = {
  id: string;
  kind: string;
  width: number;
  height: number;
  variants: Record<string, string>;
  lqip: string;
  alt: string;
};

export type ResultadoSubida = { ok: true; media: MediaSubida } | { ok: false; error: string };

function nombreSeguro(nombre: string): string {
  return path
    .basename(nombre)
    .replace(/[^\p{L}\p{N}._ -]/gu, '_')
    .slice(0, 200);
}

export async function subirImagen(args: {
  buffer: Buffer;
  nombre: string;
  datos: DatosSubida;
  actor: string;
  ip: string | null;
}): Promise<ResultadoSubida> {
  const { ajustes } = await leerAjustesMedia();
  const validacion = validarArchivo({ buffer: args.buffer, nombre: args.nombre, maxBytes: bytesMaximos(ajustes) });
  if (!validacion.ok) {
    return {
      ok: false,
      error: validacion.error === 'tamano' ? `La imagen supera los ${ajustes.maxMb} MB.` : MENSAJES_VALIDACION[validacion.error],
    };
  }

  let procesada;
  try {
    procesada = await procesarImagen({
      buffer: args.buffer,
      recorte45: args.datos.recorte45 && args.datos.kind === 'product',
      calidad: ajustes.calidad,
      origen: 'panel',
      // Banners: una imagen responsive (480…2400) salvo que se pida el conjunto antiguo de escritorio o móvil.
      ...(args.datos.kind === 'banner' ? { anchos: ANCHOS_BANNER[args.datos.variante ?? 'unica'] } : {}),
    });
  } catch (e) {
    return { ok: false, error: mensajeErrorImagen(e) };
  }

  const id = randomUUID();
  const base = rutaBase(args.datos.kind, new Date(), id);
  const raiz = raizMedia();
  const variants = await escribirVariantes(raiz, base, procesada.variantes);
  const bytes = procesada.variantes.reduce((suma, v) => suma + v.buffer.length, 0);

  const { error } = await crearClienteServicio()
    .from('media')
    .insert({
      id,
      kind: args.datos.kind,
      base_path: base,
      original_name: nombreSeguro(args.nombre),
      width: procesada.ancho,
      height: procesada.alto,
      variants,
      lqip: procesada.lqip,
      alt: args.datos.alt,
      bytes,
    });
  if (error) {
    // Sin fila no hay referencia: se limpian los archivos recién escritos.
    await Promise.all(Object.values(variants).map((r) => rm(path.join(raiz, r), { force: true })));
    console.error('[media] no se pudo registrar:', error.message);
    return { ok: false, error: 'No se pudo guardar la imagen. Inténtalo de nuevo.' };
  }

  await auditarCambio({
    actor: args.actor,
    accion: 'media.subida',
    entidad: 'media',
    entidadId: id,
    diff: { despues: { kind: args.datos.kind, alt: args.datos.alt, bytes, anchos: Object.keys(variants) } },
    ip: args.ip,
  });

  return {
    ok: true,
    media: {
      id,
      kind: args.datos.kind,
      width: procesada.ancho,
      height: procesada.alto,
      variants,
      lqip: procesada.lqip,
      alt: args.datos.alt,
    },
  };
}
