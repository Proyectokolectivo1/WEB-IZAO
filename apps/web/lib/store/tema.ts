import 'server-only';
import { cache } from 'react';
import { construirCssTema, resolverColores, resolverTipografia, type TipografiaTema } from '@izao/ui/tema';
import { fuentesTienda } from '@/lib/tipografia/fuentes-tienda';
import { tienda } from './datos';
import type { CodigoPais } from './types';

export interface TemaResuelto {
  /** Bloque CSS con las variables (global). */
  css: string;
  par: TipografiaTema['par'];
  /** Clases de `next/font` de las dos fuentes elegidas (solo esas se cargan). */
  clasesFuentes: string;
  /** Archivos de fuente a precargar (LCP). */
  precarga: string[];
}

/** Tema global (`site_settings`). Si la base no responde, la tienda sigue con los valores por defecto. */
export const temaGlobal = cache(async (): Promise<TemaResuelto> => {
  try {
    const t = await tienda().tema('co');
    const tipo = resolverTipografia(t.tipografia);
    const fuentes = await fuentesTienda(t.tipografia);
    return { css: construirCssTema(resolverColores(t.colorTokens), tipo, ':root', fuentes.pilas), par: tipo.par, clasesFuentes: fuentes.clases, precarga: fuentes.precarga };
  } catch {
    const tipo = resolverTipografia();
    const fuentes = await fuentesTienda();
    return { css: construirCssTema(resolverColores(), tipo, ':root', fuentes.pilas), par: tipo.par, clasesFuentes: fuentes.clases, precarga: fuentes.precarga };
  }
});

/**
 * *Override* del país (`theme_overrides`). Devuelve `null` si el país no tiene ninguno, para no
 * envolver la tienda en un contenedor de tema sin necesidad. Se aplica sobre un envoltorio (`.tema-pais`).
 * Las fuentes salen de `resolverFuentes(site.typography, país.typography)`.
 */
export const temaDePais = cache(async (pais: CodigoPais): Promise<TemaResuelto | null> => {
  try {
    const t = await tienda().tema(pais);
    const o = t.overridePais;
    if (!o || Object.keys(o).length === 0) return null;
    const tipoOverride = typeof o['typography'] === 'object' ? (o['typography'] as Record<string, unknown>) : null;
    const tipo = resolverTipografia(t.tipografia, tipoOverride);
    const fuentes = await fuentesTienda(t.tipografia, tipoOverride);
    return { css: construirCssTema(resolverColores(t.colorTokens, o), tipo, '.tema-pais', fuentes.pilas), par: tipo.par, clasesFuentes: fuentes.clases, precarga: fuentes.precarga };
  } catch {
    return null;
  }
});
