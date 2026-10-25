import 'server-only';
/**
 * Apariencia (§8, §24.1) con el cliente de servicio: tema global en `site_settings` (colores, tipografía, nombre,
 * logo y favicon) y *override* por país en `theme_overrides`. Guardar audita el diff e invalida el contenido público
 * (`content:{país}`), que es donde la tienda lee el tema.
 */
import { auditarCambio } from '@/lib/admin/auditoria';
import type { Cliente } from '../catalogo/taxonomias-servidor';
import { diffCampos, type ResultadoAccion } from '../crud/comun';
import { invalidarContenido, traducirErrorBd } from '../crud/servidor';
import {
  coloresEfectivos,
  contrastesDe,
  fallosGraves,
  tipografiaGlobal,
  tokensDePais,
  tokensGlobales,
  type DatosApariencia,
} from './apariencia';

type Ctx = { cliente: Cliente; actor: string; ip: string | null };
type Json = Record<string, unknown>;

export type ImagenMarca = { id: string; ruta: string; alt: string } | null;

export type AparienciaLeida = {
  storeName: string;
  colorTokens: Json;
  typography: Json;
  /** Solo lo que el país cambia (vacío = hereda). */
  override: Json;
  logo: ImagenMarca;
  favicon: ImagenMarca;
};

async function imagen(cliente: Cliente, id: string | null): Promise<ImagenMarca> {
  if (!id) return null;
  const { data } = await cliente.from('media').select('id, variants, alt').eq('id', id).maybeSingle();
  if (!data) return null;
  const m = data as { id: string; variants: Record<string, string> | null; alt: string | null };
  const v = m.variants ?? {};
  return { id: m.id, ruta: v['400'] ?? Object.values(v)[0] ?? '', alt: m.alt ?? '' };
}

export async function leerApariencia(cliente: Cliente, pais: 'CO' | 'EC' | null): Promise<AparienciaLeida> {
  const [{ data: sitio, error }, { data: over }] = await Promise.all([
    cliente.from('site_settings').select('store_name, color_tokens, typography, logo_media_id, favicon_media_id').maybeSingle(),
    pais ? cliente.from('theme_overrides').select('tokens').eq('country_code', pais).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (error) throw new Error(`No se pudo leer la apariencia: ${error.message}`);
  const s = (sitio ?? {}) as { store_name?: string; color_tokens?: Json; typography?: Json; logo_media_id?: string | null; favicon_media_id?: string | null };
  const [logo, favicon] = await Promise.all([imagen(cliente, s.logo_media_id ?? null), imagen(cliente, s.favicon_media_id ?? null)]);
  return {
    storeName: s.store_name ?? '',
    colorTokens: s.color_tokens ?? {},
    typography: s.typography ?? {},
    override: ((over as { tokens?: Json } | null)?.tokens ?? {}) as Json,
    logo,
    favicon,
  };
}

/**
 * Guarda el tema. Si alguna combinación de texto de cuerpo baja de 4.5:1 y la persona no aceptó la advertencia, no
 * se guarda (el editor ya se la mostró; esto evita que un envío directo se la salte).
 */
export async function guardarAparienciaBd(args: Ctx & { datos: DatosApariencia }): Promise<ResultadoAccion> {
  const { cliente, datos, actor, ip } = args;
  const actual = await leerApariencia(cliente, datos.alcance === 'global' ? null : datos.alcance);

  // Contraste del resultado final (el global, o el global con el país encima).
  const base = datos.alcance === 'global' ? tokensGlobales(actual.colorTokens, datos.colores) : actual.colorTokens;
  const efectivos = coloresEfectivos(base, datos.alcance === 'global' ? {} : datos.colores);
  const graves = fallosGraves(contrastesDe(efectivos));
  if (graves.length > 0 && !datos.acepto_contraste) {
    return {
      ok: false,
      mensaje: `Hay ${graves.length} combinación(es) de texto por debajo de 4.5:1. Corrígelas o marca que aceptas la advertencia.`,
      errores: { acepto_contraste: 'Marca esta casilla si quieres guardar de todos modos.' },
    };
  }

  if (datos.alcance === 'global') {
    const fila: Json = {
      color_tokens: base,
      typography: tipografiaGlobal(actual.typography, datos.tipografia),
      ...(datos.store_name ? { store_name: datos.store_name } : {}),
      logo_media_id: datos.logo_media_id,
      favicon_media_id: datos.favicon_media_id,
    };
    const { data: antes } = await cliente.from('site_settings').select('*').maybeSingle();
    const { error } = await cliente.from('site_settings').update(fila).eq('id', true);
    if (error) return { ok: false, ...traducirErrorBd(error) };
    await auditarCambio({
      actor,
      accion: 'apariencia.global_guardada',
      entidad: 'site_settings',
      entidadId: 'global',
      diff: diffCampos(antes as Json | null, fila),
      ip,
    });
    invalidarContenido();
    return { ok: true, id: 'global' };
  }

  const tokens = tokensDePais(datos);
  const { error } = await cliente.from('theme_overrides').upsert({ country_code: datos.alcance, tokens }, { onConflict: 'country_code' });
  if (error) return { ok: false, ...traducirErrorBd(error) };
  await auditarCambio({
    actor,
    accion: 'apariencia.pais_guardada',
    entidad: 'theme_overrides',
    entidadId: datos.alcance,
    diff: { antes: actual.override, despues: tokens },
    ip,
  });
  invalidarContenido([datos.alcance]);
  return { ok: true, id: datos.alcance };
}

/** Deja al país sin ajustes propios: vuelve a heredar todo el tema global. */
export async function quitarOverridePaisBd(args: Ctx & { pais: 'CO' | 'EC' }): Promise<ResultadoAccion> {
  const { cliente, pais, actor, ip } = args;
  const actual = await leerApariencia(cliente, pais);
  const { error } = await cliente.from('theme_overrides').upsert({ country_code: pais, tokens: {} }, { onConflict: 'country_code' });
  if (error) return { ok: false, ...traducirErrorBd(error) };
  await auditarCambio({
    actor,
    accion: 'apariencia.pais_restablecida',
    entidad: 'theme_overrides',
    entidadId: pais,
    diff: { antes: actual.override, despues: {} },
    ip,
  });
  invalidarContenido([pais]);
  return { ok: true, id: pais };
}
