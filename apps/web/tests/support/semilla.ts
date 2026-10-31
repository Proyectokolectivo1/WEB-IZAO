/**
 * Convención de datos: los 520 productos de prueba del seed (`packages/db/seed/data/productos.json`),
 * 400 visibles por país. Los lee del archivo, así las pruebas conocen el resultado esperado
 * sin consultar la base. La base debe tener el seed aplicado (`build-data-sql.mjs`).
 *
 * "Visible en un país" = el producto está activo, existe en ese país y `visible` es verdadero.
 * En el seed: 400 visibles en CO, 400 en EC, 100 solo en CO, 100 solo en EC y 20 borradores
 * sin país (no deben aparecer nunca).
 */
import fs from 'node:fs';
import path from 'node:path';
import { DIR_RESULTADOS, MODO_EJEMPLO, RAIZ_REPO, type Pais } from './entorno';

export type ProductoSemilla = {
  slug: string;
  name: string;
  status: 'draft' | 'active' | 'archived';
  brand_slug: string;
  gender_slug: string;
  family_slug: string;
  concentration_slug: string;
  category_slugs: string[];
  countries: Partial<Record<Pais, { visible: boolean; badges: string[]; published_at: string | null }>>;
  variants: {
    sku: string;
    countries: Partial<Record<Pais, { active: boolean; price: number; compare_at_price: number | null; stock: number }>>;
  }[];
};

const ARCHIVO = path.join(RAIZ_REPO, 'packages/db/seed/data/productos.json');

let cache: ProductoSemilla[] | null = null;

/** Con STORE_DATOS=ejemplo los productos salen de los datos de ejemplo de la tienda (globalSetup los vuelca). */
const ARCHIVO_EJEMPLO = path.join(DIR_RESULTADOS, 'ejemplo.json');

export function productosSemilla(): ProductoSemilla[] {
  cache ??= JSON.parse(fs.readFileSync(MODO_EJEMPLO ? ARCHIVO_EJEMPLO : ARCHIVO, 'utf8')) as ProductoSemilla[];
  return cache;
}

/** Cuántos productos visibles espera el listado de un país (400 con el seed; el total de ejemplo sin llaves). */
export function totalVisiblesEn(pais: Pais): number {
  return visiblesEn(pais).length;
}

export function esVisibleEn(p: ProductoSemilla, pais: Pais): boolean {
  return p.status === 'active' && p.countries[pais]?.visible === true;
}

export function visiblesEn(pais: Pais): ProductoSemilla[] {
  return productosSemilla().filter((p) => esVisibleEn(p, pais));
}

/** Productos visibles en `donde` y NO visibles en `noEn` (para probar la visibilidad por país). */
export function visiblesSoloEn(donde: Pais, noEn: Pais): ProductoSemilla[] {
  return productosSemilla().filter((p) => esVisibleEn(p, donde) && !esVisibleEn(p, noEn));
}

/** Quita tildes y pasa a minúsculas (para esperar resultados de búsqueda tolerante). */
export function sinTildes(texto: string): string {
  return texto.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

/** Productos cuyo nombre lleva tilde (para la búsqueda tolerante a tildes). */
export function conTildeEnNombre(pais: Pais): ProductoSemilla[] {
  return visiblesEn(pais).filter((p) => sinTildes(p.name) !== p.name.toLowerCase());
}
