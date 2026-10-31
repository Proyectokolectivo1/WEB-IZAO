/**
 * globalSetup. Con `STORE_DATOS=ejemplo` vuelca los datos de ejemplo de la tienda (`lib/store/repo-ejemplo.ts`)
 * a `tests/.resultados/ejemplo.json` con la forma de `ProductoSemilla`, para que las pruebas conozcan el
 * resultado esperado sin depender del servidor que están probando (se lee el módulo de datos, no la API).
 * Sin ese modo no hace nada: las expectativas salen del seed (`packages/db/seed/data/productos.json`).
 */
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import { DIR_RESULTADOS, MODO_EJEMPLO, RAIZ_WEB } from './entorno';
import type { ProductoSemilla } from './semilla';

export const ARCHIVO_EJEMPLO = path.join(DIR_RESULTADOS, 'ejemplo.json');

type Repo = {
  catalogo(p: 'co' | 'ec', c: { filtros: object; orden: string; cursor: null; limite: number }): Promise<{ items: { slug: string }[] }>;
  producto(p: 'co' | 'ec', slug: string): Promise<{
    variants: { id: string; price: number; compare_at_price: number | null; stock_disponible: number; in_stock: boolean }[];
  } | null>;
};

export default async function globalSetup(): Promise<void> {
  if (!MODO_EJEMPLO) return;
  // `server-only` lanza fuera de Next: se sustituye por un módulo vacío solo mientras se importan los datos.
  const modulo = Module as unknown as { _load: (...a: unknown[]) => unknown };
  const cargaOriginal = modulo._load;
  modulo._load = function (this: unknown, pedido: unknown, ...resto: unknown[]) {
    if (pedido === 'server-only') return {};
    return cargaOriginal.call(this, pedido, ...resto);
  };
  let repo: Repo;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    repo = (require(path.join(RAIZ_WEB, 'lib/store/repo-ejemplo')) as { repoEjemplo: Repo }).repoEjemplo;
  } finally {
    modulo._load = cargaOriginal;
  }
  const porSlug = new Map<string, ProductoSemilla>();
  for (const pais of ['co', 'ec'] as const) {
    const pagina = await repo.catalogo(pais, { filtros: {}, orden: 'featured', cursor: null, limite: 100_000 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const item of pagina.items as unknown as Record<string, any>[]) {
      const ficha = await repo.producto(pais, item.slug);
      const actual: ProductoSemilla = porSlug.get(item.slug) ?? {
        slug: item.slug,
        name: item.name,
        status: 'active',
        brand_slug: item.brand_slug,
        gender_slug: item.gender_slug,
        family_slug: item.family_slug,
        concentration_slug: item.concentration_slug,
        // El listado de ejemplo no filtra por categoría: todo producto visible "pertenece" a cualquier categoría.
        category_slugs: ['mujer', 'hombre', 'arabes', 'oud', 'ambar'],
        countries: {},
        variants: (ficha?.variants ?? []).map((v) => ({ sku: v.id, countries: {} })),
      };
      actual.countries[pais] = { visible: true, badges: item.badges ?? [], published_at: item.published_at ?? null };
      (ficha?.variants ?? []).forEach((v, i) => {
        actual.variants[i]!.countries[pais] = {
          active: true,
          price: v.price,
          compare_at_price: v.compare_at_price,
          stock: v.stock_disponible,
        };
      });
      porSlug.set(item.slug, actual);
    }
  }
  fs.mkdirSync(DIR_RESULTADOS, { recursive: true });
  fs.writeFileSync(ARCHIVO_EJEMPLO, JSON.stringify([...porSlug.values()]));
}
