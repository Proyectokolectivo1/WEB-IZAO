import 'server-only';
/** Lectura de los ajustes de imagen (calidad WebP y peso máximo) con respaldo a los valores por defecto. */
import { auditarCambio } from '@/lib/admin/auditoria';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';
import { AJUSTES_MEDIA_POR_DEFECTO, ajustesAJson, normalizarAjustesMedia, type AjustesMedia } from './ajustes';

/**
 * Si la columna `site_settings.media_settings` aún no existe (o la lectura falla) se usan los valores por defecto:
 * subir una imagen nunca debe fallar por falta de configuración.
 */
export async function leerAjustesMedia(): Promise<{ ajustes: AjustesMedia; disponible: boolean }> {
  try {
    const { data, error } = await crearClienteServicio().from('site_settings').select('media_settings').eq('id', true).maybeSingle();
    if (error) return { ajustes: AJUSTES_MEDIA_POR_DEFECTO, disponible: false };
    const crudo = (data as { media_settings?: unknown } | null)?.media_settings;
    return { ajustes: normalizarAjustesMedia(crudo), disponible: true };
  } catch {
    return { ajustes: AJUSTES_MEDIA_POR_DEFECTO, disponible: false };
  }
}

// ── Escritura (panel: Apariencia > Imágenes) ───────────────────────────────────────────────────────

type ClienteServicio = ReturnType<typeof crearClienteServicio>;

/**
 * Guarda calidad WebP y peso máximo. Si la columna aún no existe en la base, lo dice con claridad en vez de
 * fallar en silencio (la migración la crea izao-db).
 */
export async function guardarAjustesMediaBd(args: {
  cliente: ClienteServicio;
  ajustes: AjustesMedia;
  actor: string;
  ip: string | null;
}): Promise<{ ok: true } | { ok: false; mensaje: string }> {
  const { cliente, ajustes, actor, ip } = args;
  const { data: antes, error: errLectura } = await cliente.from('site_settings').select('media_settings').eq('id', true).maybeSingle();
  if (errLectura) return { ok: false, mensaje: MENSAJE_SIN_COLUMNA };
  const nuevo = ajustesAJson(ajustes);
  const { error } = await cliente.from('site_settings').update({ media_settings: nuevo }).eq('id', true);
  if (error) {
    console.error('[media] no se pudieron guardar los ajustes:', error.code, error.message);
    return { ok: false, mensaje: error.code === '42703' || error.code === 'PGRST204' ? MENSAJE_SIN_COLUMNA : 'No se pudo guardar. Inténtalo de nuevo.' };
  }
  await auditarCambio({
    actor,
    accion: 'media.ajustes_guardados',
    entidad: 'site_settings',
    entidadId: 'media_settings',
    diff: { antes: (antes as { media_settings?: unknown } | null)?.media_settings ?? null, despues: nuevo },
    ip,
  });
  return { ok: true };
}

export const MENSAJE_SIN_COLUMNA =
  'Estos ajustes aún no están disponibles en la base de datos. Mientras tanto se usan la calidad 80 y el máximo de 15 MB.';
