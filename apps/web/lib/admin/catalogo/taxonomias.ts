/**
 * Taxonomías simples del catálogo (§6.2, §24.1): marcas, familias olfativas,
 * géneros y concentraciones. Una sola definición alimenta lista, formulario,
 * esquema zod y Server Action. Código puro: lo usan servidor, cliente y pruebas.
 */
import { z } from 'zod';
import { PATRON_SLUG, nulaSiVacio } from '../crud/comun';

export const TIPOS_TAXONOMIA = ['marcas', 'familias', 'generos', 'concentraciones'] as const;
export type TipoTaxonomia = (typeof TIPOS_TAXONOMIA)[number];

export type DefTaxonomia = {
  tipo: TipoTaxonomia;
  tabla: 'brands' | 'olfactory_families' | 'genders' | 'concentrations';
  /** Columna de `products` que referencia la taxonomía (para bloquear borrados en uso). */
  columnaProducto: 'brand_id' | 'family_id' | 'gender_id' | 'concentration_id';
  singular: string;
  plural: string;
  tieneDescripcion: boolean;
  tieneImagen: boolean;
  tieneOrden: boolean;
  /** Aviso bajo el campo de imagen. */
  ayudaImagen?: string;
};

export const TAXONOMIAS: Record<TipoTaxonomia, DefTaxonomia> = {
  marcas: {
    tipo: 'marcas',
    tabla: 'brands',
    columnaProducto: 'brand_id',
    singular: 'marca',
    plural: 'Marcas',
    tieneDescripcion: true,
    tieneImagen: true,
    tieneOrden: false,
    ayudaImagen: 'No subas logos de marcas de terceros.',
  },
  familias: {
    tipo: 'familias',
    tabla: 'olfactory_families',
    columnaProducto: 'family_id',
    singular: 'familia olfativa',
    plural: 'Familias olfativas',
    tieneDescripcion: true,
    tieneImagen: true,
    tieneOrden: true,
  },
  generos: {
    tipo: 'generos',
    tabla: 'genders',
    columnaProducto: 'gender_id',
    singular: 'género',
    plural: 'Géneros',
    tieneDescripcion: false,
    tieneImagen: false,
    tieneOrden: true,
  },
  concentraciones: {
    tipo: 'concentraciones',
    tabla: 'concentrations',
    columnaProducto: 'concentration_id',
    singular: 'concentración',
    plural: 'Concentraciones',
    tieneDescripcion: false,
    tieneImagen: false,
    tieneOrden: true,
  },
};

export function esTipoTaxonomia(v: unknown): v is TipoTaxonomia {
  return typeof v === 'string' && (TIPOS_TAXONOMIA as readonly string[]).includes(v);
}

const uuidOpcional = z
  .string()
  .trim()
  .transform((v) => (v === '' ? null : v))
  .pipe(z.string().uuid('Imagen no válida.').nullable());

export const esquemaTaxonomia = z.object({
  id: z.string().uuid().optional().or(z.literal('').transform(() => undefined)),
  name: z.string().trim().min(2, 'Escribe al menos 2 caracteres.').max(80, 'Máximo 80 caracteres.'),
  slug: z
    .string()
    .trim()
    .min(2, 'El identificador de URL es obligatorio.')
    .max(120)
    .regex(PATRON_SLUG, 'Usa minúsculas, números y guiones (ej. extrait-de-parfum).'),
  description: z
    .string()
    .trim()
    .max(2000, 'Máximo 2000 caracteres.')
    .optional()
    .transform((v) => nulaSiVacio(v)),
  image_id: uuidOpcional.optional().transform((v) => v ?? null),
  sort_order: z.coerce
    .number({ message: 'Debe ser un número.' })
    .int('Debe ser un número entero.')
    .min(0, 'No puede ser negativo.')
    .max(9999)
    .default(0),
});

export type DatosTaxonomia = z.infer<typeof esquemaTaxonomia>;

/** Columnas que se escriben según el tipo (nunca se envía una columna que la tabla no tiene). */
export function columnasEscritura(def: DefTaxonomia, d: DatosTaxonomia): Record<string, unknown> {
  const fila: Record<string, unknown> = { name: d.name, slug: d.slug };
  if (def.tieneDescripcion) fila.description = d.description;
  if (def.tieneImagen) fila.image_id = d.image_id;
  if (def.tieneOrden) fila.sort_order = d.sort_order;
  return fila;
}
