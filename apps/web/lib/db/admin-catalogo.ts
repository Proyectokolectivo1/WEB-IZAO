/**
 * Envoltorios de los RPC del panel para el catálogo (`20261020044538_admin_guardar_e_importar_producto.sql`).
 *
 * SOLO SERVIDOR. Contrato completo en `docs/estado/izao-db.md`. El dinero va en enteros de unidad menor
 * (COP exponente 0, USD exponente 2): conviértelo antes con `@izao/core/money`. `stock_reserved` no se
 * envía nunca: la base no lo toca.
 */
import 'server-only';
import { z } from 'zod';
import { llamarRpc } from './cliente';

const uuid = z.guid();
const pais = z.enum(['CO', 'EC']);
/** Entero en unidad menor; la base acepta también string numérico. */
const entero = z.union([z.number().int(), z.string().regex(/^-?\d{1,18}$/)]);
const nivel = z.enum(['baja', 'media', 'alta', 'muy_alta']);

export const motivosAdminCatalogo = [
  'variante_con_pedidos',
  'sku_duplicado',
  'slug_duplicado',
  'sin_variante_por_defecto',
  'sin_vinculo_mastershop',
  'datos_invalidos',
] as const;
export type MotivoAdminCatalogo = (typeof motivosAdminCatalogo)[number];

const productoSchema = z.object({
  id: uuid.optional(),
  name: z.string().min(1).max(200),
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  short_description: z.string().nullable().optional(),
  description_html: z.string().nullable().optional(),
  brand_id: uuid.nullable().optional(),
  gender_id: uuid.nullable().optional(),
  family_id: uuid.nullable().optional(),
  concentration_id: uuid.nullable().optional(),
  notes_top: z.array(z.string()).optional(),
  notes_heart: z.array(z.string()).optional(),
  notes_base: z.array(z.string()).optional(),
  occasion: z.array(z.string()).optional(),
  season: z.array(z.string()).optional(),
  longevity: nivel.nullable().optional(),
  sillage: nivel.nullable().optional(),
  attributes: z.record(z.string(), z.unknown()).optional(),
  seo_title: z.string().nullable().optional(),
  seo_description: z.string().nullable().optional(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
});

const paisProductoSchema = z.object({
  country_code: pais,
  is_visible: z.boolean(),
  is_featured: z.boolean().optional(),
  featured_rank: z.number().int().min(1).max(999999).nullable().optional(),
  badges: z.array(z.string()).optional(),
});

const paisVarianteSchema = z.object({
  country_code: pais,
  is_active: z.boolean().optional(),
  price: entero,
  compare_at_price: entero.nullable().optional(),
  cost: entero.nullable().optional(),
  stock: z.number().int().nonnegative().optional(),
  low_stock_threshold: z.number().int().nonnegative().nullable().optional(),
});

const imagenSchema = z.object({
  media_id: uuid,
  role: z.enum(['primary', 'hover', 'gallery']),
  sort_order: z.number().int().optional(),
});

const comunVariante = {
  sku: z.string().trim().min(1).max(80),
  weight_kg: z.number().positive().optional(),
  is_default: z.boolean().optional(),
  mastershop_product_id: z.number().int().nullable().optional(),
  mastershop_variant_id: z.number().int().nullable().optional(),
  image_id: uuid.nullable().optional(),
  sort_order: z.number().int().optional(),
  countries: z.array(paisVarianteSchema).optional(),
};

/** Payload del editor de productos: sincronización completa (lo que no viene se borra). */
export const guardarProductoSchema = z.object({
  product: productoSchema,
  category_ids: z.array(uuid).optional(),
  countries: z.array(paisProductoSchema).optional(),
  options: z
    .array(
      z.object({
        id: uuid,
        name: z.string().trim().min(1),
        sort_order: z.number().int().optional(),
        values: z.array(z.object({ id: uuid, value: z.string().trim().min(1), sort_order: z.number().int().optional() })),
      }),
    )
    .optional(),
  variants: z.array(z.object({ id: uuid, option_value_ids: z.array(uuid).optional(), ...comunVariante })).optional(),
  images: z.array(imagenSchema).optional(),
});
export type GuardarProductoEntrada = z.infer<typeof guardarProductoSchema>;

const resultadoGuardarSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), product_id: uuid, creado: z.boolean() }),
  z.object({ ok: z.literal(false), motivo: z.enum(motivosAdminCatalogo), detalle: z.string().nullable().optional() }),
]);
export type ResultadoGuardarProducto = z.infer<typeof resultadoGuardarSchema>;

/** Guarda el producto completo en una transacción y refresca `catalog_listing`. */
export async function guardarProducto(entrada: GuardarProductoEntrada): Promise<ResultadoGuardarProducto> {
  return llamarRpc('admin_guardar_producto', { p: guardarProductoSchema.parse(entrada) }, resultadoGuardarSchema);
}

/**
 * Fila de importación: un producto. Sin UUID de opciones, valores ni variantes: se resuelven por nombre
 * de opción/valor y por sku. El producto se busca por `id` o `slug`. No borra lo que no viene.
 */
export const filaImportacionSchema = z.object({
  product: productoSchema.partial().extend({ slug: productoSchema.shape.slug }),
  category_ids: z.array(uuid).optional(),
  countries: z.array(paisProductoSchema.partial({ is_visible: true })).optional(),
  options: z
    .array(
      z.object({
        name: z.string().trim().min(1),
        sort_order: z.number().int().optional(),
        values: z.array(z.object({ value: z.string().trim().min(1), sort_order: z.number().int().optional() })).optional(),
      }),
    )
    .optional(),
  variants: z
    .array(
      z.object({
        option_values: z.array(z.object({ option: z.string().min(1), value: z.string().min(1) })).optional(),
        ...comunVariante,
        countries: z.array(paisVarianteSchema.partial({ price: true })).optional(),
      }),
    )
    .optional(),
  images: z.array(imagenSchema).optional(),
});
export type FilaImportacion = z.infer<typeof filaImportacionSchema>;

const resultadoImportarSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    modo: z.enum(['simular', 'aplicar']),
    creados: z.number().int(),
    actualizados: z.number().int(),
    sin_cambios: z.number().int(),
    errores: z.array(
      z.object({
        indice: z.number().int(),
        sku: z.string().nullable().optional(),
        motivo: z.enum(motivosAdminCatalogo),
        detalle: z.string().nullable().optional(),
      }),
    ),
    cambios: z.array(
      z.object({ indice: z.number().int(), tipo: z.enum(['crear', 'actualizar']), campos: z.array(z.string()) }),
    ),
  }),
  z.object({ ok: z.literal(false), motivo: z.literal('datos_invalidos'), detalle: z.string().nullable().optional() }),
]);
export type ResultadoImportarCatalogo = z.infer<typeof resultadoImportarSchema>;

/** Hasta 1000 productos por llamada. `simular` ejecuta todo y lo deshace; `aplicar` es atómico por fila. */
export async function importarCatalogo(
  modo: 'simular' | 'aplicar',
  filas: FilaImportacion[],
): Promise<ResultadoImportarCatalogo> {
  const p = { modo, filas: z.array(filaImportacionSchema).max(1000).parse(filas) };
  return llamarRpc('admin_importar_catalogo', { p }, resultadoImportarSchema);
}
