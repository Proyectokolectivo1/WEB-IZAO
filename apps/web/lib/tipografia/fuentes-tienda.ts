import 'server-only';
import type { PilasFuente } from '@izao/ui/tema';
import { FUENTES_CATALOGO, resolverFuentes, type FuenteCatalogo } from './catalogo';
import { CARGADORES_FUENTE } from './cargadores.generado';
import { archivosPrecarga } from './precarga';

/** Variable CSS que define `next/font` para esa fuente en la tienda (`--ft-cormorant-garamond`). */
export const variableTienda = (f: FuenteCatalogo): string => `--ft-${f.id}`;

/** Pila para `--font-display` / `--font-body`: la variable de `next/font` y el respaldo genérico de su categoría. */
export function pilaTienda(f: FuenteCatalogo): string {
  return `var(${variableTienda(f)}),${f.categoria.startsWith('serif') ? 'Georgia,serif' : 'system-ui,sans-serif'}`;
}

export interface FuentesTienda {
  /** Clases de `next/font` que definen las variables de las fuentes elegidas (van en `<html>` o en el envoltorio del país). */
  clases: string;
  pilas: PilasFuente;
  /** Rutas `woff2` (latin) de las dos fuentes para `<link rel="preload">`; vacío si no se pudieron ubicar. */
  precarga: string[];
}

/**
 * Fuentes de la tienda a partir de `site_settings.typography` y, si lo hay, el `typography` del país (menor a mayor prioridad).
 * Carga SOLO las dos fuentes elegidas: cada una es un módulo con su declaración estática de `next/font` (subset latin,
 * `display: swap`) y se evalúa con `import()` solo cuando se necesita. Funciona igual con el `pair` 1–6 anterior.
 */
export async function fuentesTienda(...capas: (Record<string, unknown> | null | undefined)[]): Promise<FuentesTienda> {
  const { titulos, texto } = resolverFuentes(...capas);
  const ids = [...new Set([titulos.id, texto.id])];
  const clases = await Promise.all(
    ids.map(async (id) => {
      const cargar = CARGADORES_FUENTE[id] ?? CARGADORES_FUENTE[FUENTES_CATALOGO[0]!.id]!;
      return (await cargar()).default.variable;
    }),
  );
  return {
    clases: clases.join(' '),
    pilas: { titulos: pilaTienda(titulos), texto: pilaTienda(texto) },
    precarga: archivosPrecarga([titulos.familia, texto.familia]),
  };
}
