/**
 * Categorías (§6.2, §24.1): árbol de 2 niveles, visibilidad y orden por país,
 * imagen y banner. Código puro compartido por servidor, cliente y pruebas.
 */
import { z } from 'zod';
import { PATRON_SLUG, nulaSiVacio } from '../crud/comun';

export const PAISES_CATALOGO = ['CO', 'EC'] as const;
export type PaisCatalogo = (typeof PAISES_CATALOGO)[number];
export const NOMBRE_PAIS: Record<PaisCatalogo, string> = { CO: 'Colombia', EC: 'Ecuador' };

const casilla = z.preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean());

const uuidONulo = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : null))
  .pipe(z.string().uuid('Valor no válido.').nullable());

const ordenEntero = z.coerce
  .number({ message: 'Debe ser un número.' })
  .int('Debe ser un número entero.')
  .min(0, 'No puede ser negativo.')
  .max(9999)
  .default(0);

const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo ${max} caracteres.`)
    .optional()
    .transform((v) => nulaSiVacio(v));

export const esquemaCategoria = z
  .object({
    id: z.string().uuid().optional().or(z.literal('').transform(() => undefined)),
    name: z.string().trim().min(2, 'Escribe al menos 2 caracteres.').max(80, 'Máximo 80 caracteres.'),
    slug: z
      .string()
      .trim()
      .min(2, 'El identificador de URL es obligatorio.')
      .max(120)
      .regex(PATRON_SLUG, 'Usa minúsculas, números y guiones (ej. arabes-hombre).'),
    parent_id: uuidONulo,
    description: textoOpcional(2000),
    seo_title: textoOpcional(70),
    seo_description: textoOpcional(160),
    image_id: uuidONulo,
    banner_image_id: uuidONulo,
    sort_order: ordenEntero,
    show_in_menu: casilla,
    visible_CO: casilla,
    orden_CO: ordenEntero,
    visible_EC: casilla,
    orden_EC: ordenEntero,
  })
  .refine((d) => !d.id || d.parent_id !== d.id, {
    path: ['parent_id'],
    message: 'Una categoría no puede ser su propia categoría padre.',
  });

export type DatosCategoria = z.infer<typeof esquemaCategoria>;

export type VisibilidadPais = { country_code: PaisCatalogo; is_visible: boolean; sort_order: number };

export function visibilidadPorPais(d: DatosCategoria): VisibilidadPais[] {
  return [
    { country_code: 'CO', is_visible: d.visible_CO, sort_order: d.orden_CO },
    { country_code: 'EC', is_visible: d.visible_EC, sort_order: d.orden_EC },
  ];
}

export function columnasCategoria(d: DatosCategoria): Record<string, unknown> {
  return {
    name: d.name,
    slug: d.slug,
    parent_id: d.parent_id,
    description: d.description,
    seo_title: d.seo_title,
    seo_description: d.seo_description,
    image_id: d.image_id,
    banner_image_id: d.banner_image_id,
    sort_order: d.sort_order,
    show_in_menu: d.show_in_menu,
  };
}

/**
 * Máximo 2 niveles (la base también lo exige con un trigger; aquí se da un
 * mensaje claro antes de escribir). `padre` es la fila del padre elegido.
 */
export function validarJerarquia(args: {
  id?: string | undefined;
  parentId: string | null;
  padre: { id: string; parent_id: string | null } | null;
  tieneHijos: boolean;
}): string | null {
  if (!args.parentId) return null;
  if (args.id && args.parentId === args.id) return 'Una categoría no puede ser su propia categoría padre.';
  if (!args.padre) return 'La categoría padre ya no existe.';
  if (args.padre.parent_id) return 'Solo se admiten 2 niveles: elige como padre una categoría principal.';
  if (args.tieneHijos) return 'Esta categoría tiene subcategorías, por eso no puede tener padre.';
  return null;
}

export type FilaArbol = { id: string; parent_id: string | null; sort_order: number; name: string };

/** Ordena para la lista: cada principal seguida de sus hijas; marca el nivel. */
export function ordenarArbol<T extends FilaArbol>(filas: readonly T[]): (T & { nivel: 0 | 1 })[] {
  const porOrden = (a: T, b: T) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'es');
  const ids = new Set(filas.map((f) => f.id));
  // Una hija cuyo padre no está en la lista se trata como principal (no se pierde).
  const raices = filas.filter((f) => !f.parent_id || !ids.has(f.parent_id)).sort(porOrden);
  const salida: (T & { nivel: 0 | 1 })[] = [];
  for (const r of raices) {
    salida.push({ ...r, nivel: 0 });
    for (const h of filas.filter((f) => f.parent_id === r.id).sort(porOrden)) salida.push({ ...h, nivel: 1 });
  }
  return salida;
}
