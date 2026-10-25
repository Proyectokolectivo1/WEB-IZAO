/**
 * Gastos (§22, §24.1): filtros de la lista, validación del formulario y de las categorías. Código puro compartido por
 * Server Actions y pruebas. El valor se escribe en unidad mayor de la moneda del país y sale como entero en unidad
 * menor (regla 1). Solo los gastos manuales se editan: los de Meta Ads y la billetera de MasterShop los trae el sistema.
 */
import { z } from 'zod';
import { esFechaIso, fechaBogota } from '@izao/core/metrics';
import { slugificar } from '../crud/comun';
import { MONEDA_PAIS, montoOpcional, type PaisAjustes } from '../pagos/ajustes';

export const ORIGENES_GASTO = ['manual', 'meta_ads', 'mastershop_wallet'] as const;
export type OrigenGasto = (typeof ORIGENES_GASTO)[number];
export const ETIQUETA_ORIGEN_GASTO: Record<OrigenGasto, string> = {
  manual: 'Manual',
  meta_ads: 'Meta Ads',
  mastershop_wallet: 'Billetera MasterShop',
};

export function esOrigenGasto(v: unknown): v is OrigenGasto {
  return typeof v === 'string' && (ORIGENES_GASTO as readonly string[]).includes(v);
}

/** Los slugs que empiezan por `pauta_` cuentan como inversión publicitaria en el ROAS (`@izao/core/metrics`). */
export const PREFIJO_PAUTA = 'pauta_';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Lista ────────────────────────────────────────────────────────────────────────────────────────

export type FiltrosGasto = {
  pagina: number;
  /** Categoría (uuid) o vacío. */
  categoria: string;
  origen: OrigenGasto | '';
};

type Buscables = Record<string, string | string[] | undefined>;
const primero = (v: string | string[] | undefined): string => ((Array.isArray(v) ? v[0] : v) ?? '').trim();

/** País y fechas los leen `leerPais` y `leerFiltroFechas`; aquí solo lo propio de gastos. */
export function leerFiltrosGasto(sp: Buscables): FiltrosGasto {
  const n = Number.parseInt(primero(sp.page), 10);
  const categoria = primero(sp.categoria);
  const origen = primero(sp.origen);
  return {
    pagina: Number.isFinite(n) && n >= 1 && n <= 10000 ? n : 1,
    categoria: UUID.test(categoria) ? categoria : '',
    origen: esOrigenGasto(origen) ? origen : '',
  };
}

export function parametrosDeFiltrosGasto(f: FiltrosGasto): Record<string, string> {
  const salida: Record<string, string> = {};
  if (f.categoria) salida.categoria = f.categoria;
  if (f.origen) salida.origen = f.origen;
  return salida;
}

// ── Gasto ────────────────────────────────────────────────────────────────────────────────────────

export type DatosGasto = {
  id: string | null;
  country_code: PaisAjustes;
  category_id: string;
  date: string;
  /** Unidad menor de la moneda del país. */
  amount: bigint;
  description: string | null;
  /** Comprobante (imagen subida con `kind = 'expense'`), opcional. */
  attachment_media_id: string | null;
};

/** Esquema del formulario; la moneda sale del país elegido. `hoy` (Bogotá) impide registrar gastos futuros. */
export function esquemaGasto(pais: PaisAjustes, hoy: string = fechaBogota(new Date())) {
  return z.object({
    id: z
      .string()
      .trim()
      .default('')
      .refine((v) => v === '' || UUID.test(v), 'Identificador no válido.')
      .transform((v) => (v === '' ? null : v)),
    country_code: z.enum(['CO', 'EC'], { message: 'Elige un país.' }),
    category_id: z.string().trim().regex(UUID, 'Elige una categoría.'),
    date: z
      .string()
      .trim()
      .refine(esFechaIso, 'Usa una fecha válida.')
      .refine((v) => v <= hoy, 'La fecha no puede ser futura.'),
    amount: montoOpcional(MONEDA_PAIS[pais], 'El valor', true).transform((v, ctx) => {
      if (v === null || v <= 0n) {
        ctx.addIssue({ code: 'custom', message: 'El valor debe ser mayor que cero.' });
        return 0n;
      }
      return v;
    }),
    description: z
      .string()
      .trim()
      .max(300, 'Máximo 300 caracteres.')
      .default('')
      .transform((v) => (v === '' ? null : v)),
    attachment_media_id: z
      .string()
      .trim()
      .default('')
      .refine((v) => v === '' || UUID.test(v), 'Comprobante no válido.')
      .transform((v) => (v === '' ? null : v)),
  }) as unknown as z.ZodType<DatosGasto, unknown>;
}

// ── Categorías ───────────────────────────────────────────────────────────────────────────────────

export type DatosCategoriaGasto = {
  id: string | null;
  name: string;
  /** Solo al crear: marca la categoría como pauta publicitaria (slug con prefijo `pauta_`). */
  es_pauta: boolean;
};

const casilla = z.preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean());

export const esquemaCategoriaGasto = z.object({
  id: z
    .string()
    .trim()
    .default('')
    .refine((v) => v === '' || UUID.test(v), 'Identificador no válido.')
    .transform((v) => (v === '' ? null : v)),
  name: z.string().trim().min(2, 'Escribe un nombre.').max(60, 'Máximo 60 caracteres.'),
  es_pauta: casilla.default(false),
}) as unknown as z.ZodType<DatosCategoriaGasto, unknown>;

/** `Empaques y cajas` → `empaques_y_cajas`; con `esPauta`, `pauta_…` (sin duplicar el prefijo). */
export function slugDeCategoria(nombre: string, esPauta: boolean): string {
  let base = slugificar(nombre).replace(/-/g, '_');
  if (esPauta) base = `${PREFIJO_PAUTA}${base.replace(/^pauta_/, '')}`;
  return base;
}

export const PATRON_SLUG_CATEGORIA = /^[a-z0-9]+(_[a-z0-9]+)*$/;

export function esPauta(slug: string): boolean {
  return slug.startsWith(PREFIJO_PAUTA);
}
