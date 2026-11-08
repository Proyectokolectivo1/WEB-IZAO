/**
 * Vinculación de variantes de Izao con productos de MasterShop (§14, `mastershop_product_id` /
 * `mastershop_variant_id`).
 *
 * Observado en la API real (solo lectura, 2026-11-06):
 * - `GET /api/products` lista los productos del negocio, pero **sin variantes** (`variation: []`): el SKU
 *   solo llega en `GET /api/products/{id}?includeAllVariations=true`.
 * - Cada producto tiene al menos una variante (`"Default Variant"` si no tiene opciones) con `sku`,
 *   `idVariant`, `isEnable` (0/1), `price`, `stock`.
 *
 * El emparejamiento automático es por SKU normalizado (exacto, sin distinguir mayúsculas). Nunca
 * sobrescribe un vínculo existente distinto: lo reporta como conflicto. Las coincidencias por nombre
 * solo se sugieren; no se aplican.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Respuestas de MasterShop
// ---------------------------------------------------------------------------

const idSchema = z.number().int().positive();
const textoOpcional = z
  .unknown()
  .transform((v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null));
const numeroOpcional = z.unknown().transform((v) => (typeof v === 'number' && Number.isFinite(v) ? v : null));

export const MasterShopVariantSchema = z.looseObject({
  idProduct: idSchema,
  idVariant: idSchema,
  sku: textoOpcional,
  name: textoOpcional,
  isEnable: z.unknown().transform((v) => v === 1 || v === true),
  price: numeroOpcional,
  stock: numeroOpcional,
});

export const MasterShopProductSchema = z.looseObject({
  idProduct: idSchema,
  name: z.string(),
  nameState: textoOpcional,
  basePrice: numeroOpcional,
  stockTotal: numeroOpcional,
  variation: z.array(z.unknown()).nullish(),
});

export const MasterShopProductListSchema = z.looseObject({
  results: z.array(MasterShopProductSchema),
});

export interface MasterShopVariant {
  idProduct: number;
  idVariant: number;
  sku: string | null;
  name: string | null;
  enabled: boolean;
  price: number | null;
  stock: number | null;
}

export interface MasterShopProductSummary {
  idProduct: number;
  name: string;
  state: string | null;
  basePrice: number | null;
  stockTotal: number | null;
}

export interface MasterShopProduct extends MasterShopProductSummary {
  variants: MasterShopVariant[];
}

export function toProductSummary(p: z.infer<typeof MasterShopProductSchema>): MasterShopProductSummary {
  return {
    idProduct: p.idProduct,
    name: p.name.trim(),
    state: p.nameState,
    basePrice: p.basePrice,
    stockTotal: p.stockTotal,
  };
}

/** Variantes válidas del detalle; las que no cumplen el esquema se descartan. */
export function toProduct(p: z.infer<typeof MasterShopProductSchema>): MasterShopProduct {
  const variants: MasterShopVariant[] = [];
  for (const raw of p.variation ?? []) {
    const v = MasterShopVariantSchema.safeParse(raw);
    if (!v.success || v.data.idProduct !== p.idProduct) continue;
    variants.push({
      idProduct: v.data.idProduct,
      idVariant: v.data.idVariant,
      sku: v.data.sku,
      name: v.data.name,
      enabled: v.data.isEnable,
      price: v.data.price,
      stock: v.data.stock,
    });
  }
  return { ...toProductSummary(p), variants };
}

// ---------------------------------------------------------------------------
// Emparejamiento
// ---------------------------------------------------------------------------

/** Variante de Izao tal como la lee la vista previa. */
export interface VarianteIzao {
  variant_id: string;
  sku: string;
  product_name: string;
  mastershop_product_id: number | null;
  mastershop_variant_id: number | null;
}

export interface VinculoMasterShop {
  idProduct: number;
  idVariant: number;
  sku: string;
  nombre: string;
}

export interface Emparejamiento {
  variant_id: string;
  sku: string;
  product_name: string;
  actual: { idProduct: number | null; idVariant: number | null };
  propuesto: VinculoMasterShop;
}

export interface SugerenciaPorNombre {
  variant_id: string;
  sku: string;
  product_name: string;
  /** `idVariant`/`sku` en `null` si el producto tiene varias variantes habilitadas (hay que elegir a mano). */
  candidato: { idProduct: number; idVariant: number | null; sku: string | null; nombre: string };
}

export interface VistaPreviaVinculacion {
  /** Sin vínculo hoy y con SKU idéntico en MasterShop: se aplican. */
  nuevas: Emparejamiento[];
  /** Ya vinculadas al mismo producto y variante. */
  sinCambio: Emparejamiento[];
  /** Ya vinculadas a otro producto/variante: no se tocan, las revisa el dueño. */
  conflictos: Emparejamiento[];
  /** Sin SKU equivalente en MasterShop (y sin vínculo previo). */
  sinEquivalente: Array<Pick<VarianteIzao, 'variant_id' | 'sku' | 'product_name'>>;
  /** Variantes sin SKU coincidente cuyo nombre normalizado coincide con un producto de MasterShop. Solo sugerencia. */
  sugerenciasPorNombre: SugerenciaPorNombre[];
  /** SKU repetido en MasterShop: ambiguo, no se empareja. */
  skuAmbiguos: Array<{ sku: string; variantes: Array<{ idProduct: number; idVariant: number }> }>;
  /** Variantes de MasterShop con `isEnable = 0` que coinciden por SKU: no se emparejan. */
  deshabilitadasEnMasterShop: Array<{ sku: string; idProduct: number; idVariant: number }>;
  /** Variantes de MasterShop que ninguna variante de Izao usa. */
  masterShopSinUsar: Array<{ idProduct: number; idVariant: number; sku: string | null; nombre: string }>;
  totales: {
    variantesIzao: number;
    productosMasterShop: number;
    variantesMasterShop: number;
    nuevas: number;
    sinCambio: number;
    conflictos: number;
    sinEquivalente: number;
  };
}

/** SKU comparable: sin espacios a los lados ni internos y en mayúsculas. */
export function normalizarSku(sku: string): string {
  return sku.normalize('NFKC').replace(/\s+/g, '').toUpperCase();
}

/** Nombre comparable: sin tildes, minúsculas, sin tamaños (`100ml`, `100 ML`) ni signos. */
export function normalizarNombre(nombre: string): string {
  return nombre
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/\b\d+(?:[.,]\d+)?\s*ml\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function emparejarPorSku(
  variantes: readonly VarianteIzao[],
  productos: readonly MasterShopProduct[],
): VistaPreviaVinculacion {
  const porSku = new Map<string, Array<{ v: MasterShopVariant; nombre: string }>>();
  let variantesMs = 0;
  for (const p of productos) {
    for (const v of p.variants) {
      variantesMs++;
      if (v.sku === null) continue;
      const k = normalizarSku(v.sku);
      if (k === '') continue;
      const lista = porSku.get(k) ?? [];
      lista.push({ v, nombre: p.name });
      porSku.set(k, lista);
    }
  }

  const porNombre = new Map<string, MasterShopProduct[]>();
  for (const p of productos) {
    const k = normalizarNombre(p.name);
    if (k === '') continue;
    porNombre.set(k, [...(porNombre.get(k) ?? []), p]);
  }

  const vista: VistaPreviaVinculacion = {
    nuevas: [],
    sinCambio: [],
    conflictos: [],
    sinEquivalente: [],
    sugerenciasPorNombre: [],
    skuAmbiguos: [],
    deshabilitadasEnMasterShop: [],
    masterShopSinUsar: [],
    totales: {
      variantesIzao: variantes.length,
      productosMasterShop: productos.length,
      variantesMasterShop: variantesMs,
      nuevas: 0,
      sinCambio: 0,
      conflictos: 0,
      sinEquivalente: 0,
    },
  };

  const usadas = new Set<number>();
  const ambiguosVistos = new Set<string>();
  for (const iz of variantes) {
    const actual = { idProduct: iz.mastershop_product_id, idVariant: iz.mastershop_variant_id };
    if (actual.idVariant !== null) usadas.add(actual.idVariant);
    const k = normalizarSku(iz.sku);
    const candidatos = (porSku.get(k) ?? []).filter((c) => {
      if (c.v.enabled) return true;
      vista.deshabilitadasEnMasterShop.push({ sku: iz.sku, idProduct: c.v.idProduct, idVariant: c.v.idVariant });
      return false;
    });

    if (candidatos.length > 1) {
      if (!ambiguosVistos.has(k)) {
        ambiguosVistos.add(k);
        vista.skuAmbiguos.push({
          sku: iz.sku,
          variantes: candidatos.map((c) => ({ idProduct: c.v.idProduct, idVariant: c.v.idVariant })),
        });
      }
      continue;
    }

    const c = candidatos[0];
    if (c === undefined) {
      if (actual.idProduct !== null) continue; // vinculada a mano con otro SKU: se respeta
      vista.sinEquivalente.push({ variant_id: iz.variant_id, sku: iz.sku, product_name: iz.product_name });
      const mismos = porNombre.get(normalizarNombre(iz.product_name)) ?? [];
      for (const p of mismos) {
        const habilitadas = p.variants.filter((v) => v.enabled);
        const v = habilitadas.length === 1 ? habilitadas[0]! : null;
        vista.sugerenciasPorNombre.push({
          variant_id: iz.variant_id,
          sku: iz.sku,
          product_name: iz.product_name,
          candidato: {
            idProduct: p.idProduct,
            idVariant: v?.idVariant ?? null,
            sku: v?.sku ?? null,
            nombre: p.name,
          },
        });
      }
      continue;
    }

    usadas.add(c.v.idVariant);
    const e: Emparejamiento = {
      variant_id: iz.variant_id,
      sku: iz.sku,
      product_name: iz.product_name,
      actual,
      propuesto: { idProduct: c.v.idProduct, idVariant: c.v.idVariant, sku: c.v.sku!, nombre: c.nombre },
    };
    if (actual.idProduct === null && actual.idVariant === null) vista.nuevas.push(e);
    else if (actual.idProduct === c.v.idProduct && actual.idVariant === c.v.idVariant) vista.sinCambio.push(e);
    else vista.conflictos.push(e);
  }

  for (const p of productos) {
    for (const v of p.variants) {
      if (!usadas.has(v.idVariant)) {
        vista.masterShopSinUsar.push({ idProduct: v.idProduct, idVariant: v.idVariant, sku: v.sku, nombre: p.name });
      }
    }
  }

  vista.totales.nuevas = vista.nuevas.length;
  vista.totales.sinCambio = vista.sinCambio.length;
  vista.totales.conflictos = vista.conflictos.length;
  vista.totales.sinEquivalente = vista.sinEquivalente.length;
  return vista;
}

// ---------------------------------------------------------------------------
// SQL para aplicar la vista previa (lo ejecuta el dueño tras aprobarla)
// ---------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function literal(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/** Países con cuenta propia de MasterShop (D-052). */
const PAISES_VINCULO = new Set(['CO', 'EC']);

/**
 * `UPDATE` idempotente de `variant_countries` del país (`mastershop_product_id/_variant_id`, D-052): solo escribe
 * si la fila de ese país sigue sin vínculo y el SKU de la variante no cambió desde la vista previa. Ejecutarlo dos
 * veces no hace nada la segunda. No toca `product_variants.mastershop_*` (espejo de CO que mantienen los triggers).
 * Conflictos y sugerencias no se incluyen. Devuelve `null` si no hay nada que aplicar.
 */
export function sqlVinculacion(
  vista: Pick<VistaPreviaVinculacion, 'nuevas'>,
  generadoEn: Date,
  pais: 'CO' | 'EC' = 'CO',
): string | null {
  if (!PAISES_VINCULO.has(pais)) throw new Error(`País inválido: ${String(pais)}`);
  if (vista.nuevas.length === 0) return null;
  const filas = vista.nuevas.map((e) => {
    if (!UUID.test(e.variant_id)) throw new Error(`variant_id inválido: ${e.variant_id}`);
    for (const n of [e.propuesto.idProduct, e.propuesto.idVariant]) {
      if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`ID de MasterShop inválido para ${e.sku}`);
    }
    return `  (${literal(e.variant_id)}::uuid, ${literal(e.sku)}, ${e.propuesto.idProduct}, ${e.propuesto.idVariant})`;
  });
  return [
    `-- Vinculación de variantes con MasterShop (${pais}) por SKU (${vista.nuevas.length} filas).`,
    `-- Generado ${generadoEn.toISOString()} desde la vista previa. Idempotente: solo llena filas de ${pais} sin vínculo.`,
    'begin;',
    'with x(id, sku, ms_product, ms_variant) as (values',
    filas.join(',\n'),
    '), cambios as (',
    '  update public.variant_countries as vc',
    '     set mastershop_product_id = x.ms_product,',
    '         mastershop_variant_id = x.ms_variant',
    '    from x',
    '    join public.product_variants as v on v.id = x.id and v.sku = x.sku',
    '   where vc.variant_id = x.id',
    `     and vc.country_code = ${literal(pais)}`,
    '     and vc.mastershop_product_id is null',
    '     and vc.mastershop_variant_id is null',
    '  returning vc.variant_id',
    ')',
    'select count(*) as variantes_vinculadas from cambios;',
    'commit;',
    '',
  ].join('\n');
}
