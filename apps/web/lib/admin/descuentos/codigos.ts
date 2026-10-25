/**
 * Códigos de descuento (§17.1, §24.1): validación pura del formulario y de la generación por lotes, estado
 * visible y textos. Los montos se escriben en unidad mayor y salen como enteros en unidad menor con
 * `fromMajorString` (regla 1). Código puro compartido por servidor, cliente y pruebas; la aplicación del descuento
 * en el pedido vive en `@izao/core/pricing` y la reserva/canje en la base.
 */
import { z } from 'zod';
import { formatMoney, money, type CurrencyCode } from '@izao/core/money';
import { esFechaIso, fechaBogota, inicioDiaBogotaUtc, sumarDias } from '@izao/core/metrics';
import { PATRON_SLUG } from '../crud/comun';
import { MONEDA_PAIS, afirmaOriginalidad, montoATexto, montoOpcional } from '../pagos/ajustes';

export const TIPOS_DESCUENTO = ['percent', 'fixed'] as const;
export type TipoDescuento = (typeof TIPOS_DESCUENTO)[number];
export const ETIQUETA_TIPO: Record<TipoDescuento, string> = {
  percent: 'Porcentaje',
  fixed: 'Valor fijo',
};

export const ALCANCES = ['all', 'categories', 'products'] as const;
export type Alcance = (typeof ALCANCES)[number];
export const ETIQUETA_ALCANCE: Record<Alcance, string> = {
  all: 'Todo el catálogo',
  categories: 'Solo algunas categorías',
  products: 'Solo algunos productos',
};

export const ORIGENES = ['manual', 'popup', 'batch'] as const;
export type OrigenCodigo = (typeof ORIGENES)[number];
export const ETIQUETA_ORIGEN: Record<OrigenCodigo, string> = {
  manual: 'Manual',
  popup: 'Pop-up',
  batch: 'Lote',
};

export const MAX_LOTE = 500;
export const MAX_PRODUCTOS_REGLA = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PATRON_CODIGO = /^[A-Z0-9_-]{3,30}$/;
const PATRON_PREFIJO = /^[A-Z0-9]{2,12}$/;

/** Alfabeto sin caracteres que se confunden al dictarlos (0/O, 1/I/L). */
export const ALFABETO_LOTE = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const LARGO_SUFIJO_LOTE = 6;

// ── Entrada del formulario ───────────────────────────────────────────────────────────────────────

const casilla = z.preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean());

/** `FormData` → objeto; las claves repetidas (casillas de categorías) quedan como lista. */
export function formularioAObjeto(formData: FormData): Record<string, unknown> {
  const salida: Record<string, unknown> = {};
  for (const [clave, valor] of formData.entries()) {
    if (typeof valor !== 'string') continue;
    const previo = salida[clave];
    if (previo === undefined) salida[clave] = valor;
    else if (Array.isArray(previo)) previo.push(valor);
    else salida[clave] = [previo, valor];
  }
  return salida;
}

const listaUuid = z.preprocess(
  (v) => (v === undefined || v === '' ? [] : Array.isArray(v) ? v : [v]),
  z.array(z.string().regex(UUID, 'Identificador no válido.')).max(200),
);

const fechaOpcional = z
  .string()
  .trim()
  .default('')
  .refine((v) => v === '' || esFechaIso(v), 'Usa una fecha válida.');

const opcionalUuid = z
  .string()
  .trim()
  .default('')
  .refine((v) => v === '' || UUID.test(v), 'Identificador no válido.');

/** Campos de la regla (comunes al código suelto y al lote). Todo llega como texto. */
const camposRegla = {
  country_code: z.enum(['CO', 'EC'], { message: 'Elige el país.' }),
  type: z.enum(TIPOS_DESCUENTO, { message: 'Elige el tipo de descuento.' }),
  value: z.string().trim().default(''),
  max_discount_amount: z.string().default(''),
  min_subtotal: z.string().default(''),
  starts_on: fechaOpcional,
  ends_on: fechaOpcional,
  usage_limit_total: z.string().trim().default(''),
  usage_limit_per_customer: z.string().trim().default(''),
  applies_to: z.enum(ALCANCES, { message: 'Elige a qué aplica.' }),
  target_categories: listaUuid,
  target_products: z.string().default(''),
  exclude_categories: listaUuid,
  exclude_products: z.string().default(''),
  applies_to_sale_items: casilla,
  iza_can_offer: casilla,
  is_active: casilla,
  influencer_id: opcionalUuid,
};

type EntradaRegla = {
  [K in keyof typeof camposRegla]: z.output<(typeof camposRegla)[K]>;
};

/** Regla ya validada, lista para escribir (los slugs de productos aún se resuelven a id en el servidor). */
export type DatosRegla = {
  country_code: 'CO' | 'EC';
  type: TipoDescuento;
  value: bigint;
  max_discount_amount: bigint | null;
  min_subtotal: bigint;
  starts_at: string | null;
  ends_at: string | null;
  usage_limit_total: number | null;
  usage_limit_per_customer: number | null;
  applies_to: Alcance;
  target_category_ids: string[];
  target_product_slugs: string[];
  exclude_category_ids: string[];
  exclude_product_slugs: string[];
  applies_to_sale_items: boolean;
  influencer_id: string | null;
  iza_can_offer: boolean;
  is_active: boolean;
};

export type DatosCodigo = DatosRegla & { id?: string | undefined; code: string };
export type DatosLote = DatosRegla & { prefix: string; quantity: number };

/** `a-b\nc, d` → `['a-b','c','d']` sin repetidos; `null` si algún elemento no es un slug. */
export function parsearSlugs(texto: string): string[] | null {
  const partes = texto
    .split(/[\s,;]+/)
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p !== '');
  if (partes.some((p) => !PATRON_SLUG.test(p) || p.length > 120)) return null;
  return [...new Set(partes)];
}

function enteroOpcional(texto: string, etiqueta: string, max: number, ctx: z.RefinementCtx, ruta: string): number | null {
  const t = texto.trim();
  if (t === '') return null;
  if (!/^\d{1,9}$/.test(t) || Number(t) < 1 || Number(t) > max) {
    ctx.addIssue({ code: 'custom', path: [ruta], message: `${etiqueta} debe ser un número entero entre 1 y ${max}.` });
    return null;
  }
  return Number(t);
}

function montoAMenor(
  texto: string,
  moneda: CurrencyCode,
  etiqueta: string,
  requerido: boolean,
  ctx: z.RefinementCtx,
  ruta: string,
): bigint | null {
  // Reutiliza el validador de pagos (mismo mensaje y mismos límites) y traslada sus incidencias a esta ruta.
  const r = montoOpcional(moneda, etiqueta, requerido).safeParse(texto);
  if (!r.success) {
    ctx.addIssue({ code: 'custom', path: [ruta], message: r.error.issues[0]?.message ?? `${etiqueta} no es válido.` });
    return null;
  }
  return r.data;
}

/** Valida y convierte la regla; añade las incidencias por campo y devuelve `null` si hay alguna. */
function resolverRegla(d: EntradaRegla, ctx: z.RefinementCtx): DatosRegla | null {
  const antes = ctx.issues.length;
  const moneda = MONEDA_PAIS[d.country_code];
  let valor: bigint | null = null;

  if (d.type === 'percent') {
    if (!/^\d{1,3}$/.test(d.value) || Number(d.value) < 1 || Number(d.value) > 100) {
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'El porcentaje debe ser un número entero entre 1 y 100.' });
    } else valor = BigInt(d.value);
  } else {
    valor = montoAMenor(d.value, moneda, 'El valor del descuento', true, ctx, 'value');
    if (valor !== null && valor <= 0n) {
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'El valor del descuento debe ser mayor que cero.' });
      valor = null;
    }
  }

  let tope: bigint | null = null;
  if (d.type === 'percent') {
    tope = montoAMenor(d.max_discount_amount, moneda, 'El tope', false, ctx, 'max_discount_amount');
    if (tope !== null && tope <= 0n) {
      ctx.addIssue({ code: 'custom', path: ['max_discount_amount'], message: 'El tope debe ser mayor que cero (o déjalo vacío).' });
      tope = null;
    }
  }

  const minimo = montoAMenor(d.min_subtotal, moneda, 'La compra mínima', false, ctx, 'min_subtotal') ?? 0n;

  let inicio: string | null = null;
  let fin: string | null = null;
  if (d.starts_on !== '') inicio = inicioDiaBogotaUtc(d.starts_on).toISOString();
  // "Hasta" incluye todo el día elegido: vence al empezar el día siguiente (hora de Bogotá).
  if (d.ends_on !== '') fin = inicioDiaBogotaUtc(sumarDias(d.ends_on, 1)).toISOString();
  if (d.starts_on !== '' && d.ends_on !== '' && d.ends_on < d.starts_on) {
    ctx.addIssue({ code: 'custom', path: ['ends_on'], message: 'La fecha final no puede ser anterior a la inicial.' });
  }

  const usosTotal = enteroOpcional(d.usage_limit_total, 'Los usos totales', 1_000_000, ctx, 'usage_limit_total');
  const usosCliente = enteroOpcional(d.usage_limit_per_customer, 'Los usos por cliente', 1000, ctx, 'usage_limit_per_customer');

  const productosObjetivo = parsearSlugs(d.target_products);
  const productosExcluidos = parsearSlugs(d.exclude_products);
  if (productosObjetivo === null) {
    ctx.addIssue({ code: 'custom', path: ['target_products'], message: 'Escribe las URL de producto (minúsculas, números y guiones), una por línea.' });
  }
  if (productosExcluidos === null) {
    ctx.addIssue({ code: 'custom', path: ['exclude_products'], message: 'Escribe las URL de producto (minúsculas, números y guiones), una por línea.' });
  }
  if ((productosObjetivo?.length ?? 0) > MAX_PRODUCTOS_REGLA || (productosExcluidos?.length ?? 0) > MAX_PRODUCTOS_REGLA) {
    ctx.addIssue({ code: 'custom', path: ['target_products'], message: `Máximo ${MAX_PRODUCTOS_REGLA} productos por lista.` });
  }
  if (d.applies_to === 'categories' && d.target_categories.length === 0) {
    ctx.addIssue({ code: 'custom', path: ['target_categories'], message: 'Elige al menos una categoría.' });
  }
  if (d.applies_to === 'products' && (productosObjetivo?.length ?? 0) === 0) {
    ctx.addIssue({ code: 'custom', path: ['target_products'], message: 'Escribe al menos un producto.' });
  }

  if ((ctx.issues.length) > antes || valor === null) return null;
  return {
    country_code: d.country_code,
    type: d.type,
    value: valor,
    max_discount_amount: tope,
    min_subtotal: minimo,
    starts_at: inicio,
    ends_at: fin,
    usage_limit_total: usosTotal,
    usage_limit_per_customer: usosCliente,
    applies_to: d.applies_to,
    target_category_ids: d.applies_to === 'categories' ? [...new Set(d.target_categories)] : [],
    target_product_slugs: d.applies_to === 'products' ? (productosObjetivo ?? []) : [],
    exclude_category_ids: [...new Set(d.exclude_categories)],
    exclude_product_slugs: productosExcluidos ?? [],
    applies_to_sale_items: d.applies_to_sale_items,
    influencer_id: d.influencer_id === '' ? null : d.influencer_id,
    iza_can_offer: d.iza_can_offer,
    is_active: d.is_active,
  };
}

export const esquemaCodigo = z
  .object({
    id: z.string().uuid().optional().or(z.literal('').transform(() => undefined)),
    code: z
      .string()
      .trim()
      .transform((s) => s.toUpperCase())
      .pipe(z.string().regex(PATRON_CODIGO, 'Usa de 3 a 30 letras, números, guion o guion bajo (sin espacios ni tildes).')),
    ...camposRegla,
  })
  .transform((d, ctx): DatosCodigo => {
    const antes = ctx.issues.length;
    if (codigoAfirmaOriginalidad(d.code)) {
      ctx.addIssue({ code: 'custom', path: ['code'], message: 'El código no puede afirmar originalidad ni certificados.' });
    }
    const regla = resolverRegla(d, ctx);
    if (!regla || ctx.issues.length > antes) return z.NEVER;
    return { id: d.id, code: d.code, ...regla };
  });

export const esquemaLote = z
  .object({
    prefix: z
      .string()
      .trim()
      .transform((s) => s.toUpperCase())
      .pipe(z.string().regex(PATRON_PREFIJO, 'El prefijo usa de 2 a 12 letras o números, sin guiones ni espacios.')),
    quantity: z
      .string()
      .trim()
      .regex(/^\d{1,4}$/, 'Escribe cuántos códigos generar.')
      .transform(Number)
      .pipe(z.number().int().min(1, 'Mínimo 1 código.').max(MAX_LOTE, `Máximo ${MAX_LOTE} códigos por lote.`)),
    ...camposRegla,
  })
  .transform((d, ctx): DatosLote => {
    const regla = resolverRegla(d, ctx);
    if (!regla) return z.NEVER;
    return { prefix: d.prefix, quantity: d.quantity, ...regla };
  });

// ── Generación del lote ──────────────────────────────────────────────────────────────────────────

/**
 * `cantidad` códigos únicos `PREFIJO-XXXXXX`. `azar(n)` devuelve un entero en `[0, n)` (en producción
 * `crypto.randomInt`); no se repite ningún código entre sí ni con `ocupados`.
 */
export function generarCodigosLote(
  prefijo: string,
  cantidad: number,
  azar: (n: number) => number,
  ocupados: ReadonlySet<string> = new Set(),
): string[] {
  const salida = new Set<string>();
  let intentos = 0;
  while (salida.size < cantidad) {
    if (++intentos > cantidad * 20 + 100) throw new Error('No se pudieron generar códigos únicos; usa otro prefijo.');
    let sufijo = '';
    for (let i = 0; i < LARGO_SUFIJO_LOTE; i += 1) sufijo += ALFABETO_LOTE[azar(ALFABETO_LOTE.length)];
    const codigo = `${prefijo}-${sufijo}`;
    if (!ocupados.has(codigo)) salida.add(codigo);
  }
  return [...salida];
}

// ── Estado, textos y valores del formulario ─────────────────────────────────────────────────────

export type FilaCodigo = {
  id: string;
  code: string;
  country_code: 'CO' | 'EC';
  type: TipoDescuento;
  value: number | string;
  max_discount_amount: number | string | null;
  min_subtotal: number | string;
  starts_at: string | null;
  ends_at: string | null;
  usage_limit_total: number | null;
  usage_limit_per_customer: number | null;
  usage_count: number;
  applies_to: Alcance;
  target_ids: string[];
  exclude_ids: string[];
  applies_to_sale_items: boolean;
  influencer_id: string | null;
  origin: OrigenCodigo;
  iza_can_offer: boolean;
  is_active: boolean;
  created_at: string;
};

export type EstadoCodigo = 'vigente' | 'inactivo' | 'programado' | 'vencido' | 'agotado';
export const ETIQUETA_ESTADO: Record<EstadoCodigo, string> = {
  vigente: 'Vigente',
  inactivo: 'Inactivo',
  programado: 'Programado',
  vencido: 'Vencido',
  agotado: 'Agotado',
};
/** Estados que se pueden filtrar en SQL; "agotado" se ve en la insignia (compara dos columnas). */
export const ESTADOS_FILTRO = ['inactivo', 'programado', 'vencido'] as const;

export function estadoCodigo(
  f: Pick<FilaCodigo, 'is_active' | 'starts_at' | 'ends_at' | 'usage_limit_total' | 'usage_count'>,
  ahora: Date,
): EstadoCodigo {
  if (!f.is_active) return 'inactivo';
  if (f.ends_at && new Date(f.ends_at).getTime() <= ahora.getTime()) return 'vencido';
  if (f.usage_limit_total !== null && f.usage_count >= f.usage_limit_total) return 'agotado';
  if (f.starts_at && new Date(f.starts_at).getTime() > ahora.getTime()) return 'programado';
  return 'vigente';
}

function aBig(v: number | string): bigint {
  return typeof v === 'number' ? BigInt(v) : BigInt(v);
}

/** `15 %` o `$ 10.000`, con el tope si lo hay. */
export function describirValor(f: Pick<FilaCodigo, 'type' | 'value' | 'max_discount_amount' | 'country_code'>): string {
  const moneda = MONEDA_PAIS[f.country_code];
  if (f.type === 'percent') {
    const base = `${String(f.value)} %`;
    return f.max_discount_amount !== null
      ? `${base} (tope ${formatMoney(money(aBig(f.max_discount_amount), moneda))})`
      : base;
  }
  return formatMoney(money(aBig(f.value), moneda));
}

/** Fecha de Bogotá (`YYYY-MM-DD`) de un instante guardado, o '' si no hay. */
export function fechaInicioATexto(iso: string | null): string {
  return iso ? fechaBogota(new Date(iso)) : '';
}

/** El campo "Hasta" se guarda como el inicio del día siguiente; se muestra el último día incluido. */
export function fechaFinATexto(iso: string | null): string {
  return iso ? fechaBogota(new Date(new Date(iso).getTime() - 1)) : '';
}

export type ValoresCodigo = {
  id?: string;
  code: string;
  country_code: 'CO' | 'EC';
  type: TipoDescuento;
  value: string;
  max_discount_amount: string;
  min_subtotal: string;
  starts_on: string;
  ends_on: string;
  usage_limit_total: string;
  usage_limit_per_customer: string;
  applies_to: Alcance;
  target_categories: string[];
  target_products: string;
  exclude_categories: string[];
  exclude_products: string;
  applies_to_sale_items: boolean;
  iza_can_offer: boolean;
  is_active: boolean;
  influencer_id: string;
};

export const CODIGO_NUEVO: ValoresCodigo = {
  code: '',
  country_code: 'CO',
  type: 'percent',
  value: '',
  max_discount_amount: '',
  min_subtotal: '',
  starts_on: '',
  ends_on: '',
  usage_limit_total: '',
  usage_limit_per_customer: '',
  applies_to: 'all',
  target_categories: [],
  target_products: '',
  exclude_categories: [],
  exclude_products: '',
  applies_to_sale_items: true,
  iza_can_offer: false,
  is_active: true,
  influencer_id: '',
};

/**
 * Fila guardada → valores del formulario. `slugsProducto` traduce los ids de producto a su URL; `categoriaIds` es
 * el conjunto de categorías existentes (los ids de `target_ids`/`exclude_ids` que no son categoría son productos).
 */
export function aValoresCodigo(
  f: FilaCodigo,
  slugsProducto: ReadonlyMap<string, string>,
  categoriaIds: ReadonlySet<string>,
): ValoresCodigo {
  const moneda = MONEDA_PAIS[f.country_code];
  const slugs = (ids: readonly string[]) => ids.filter((i) => !categoriaIds.has(i)).map((i) => slugsProducto.get(i) ?? i);
  return {
    id: f.id,
    code: f.code,
    country_code: f.country_code,
    type: f.type,
    value: f.type === 'percent' ? String(f.value) : montoATexto(f.value, moneda),
    max_discount_amount: montoATexto(f.max_discount_amount, moneda),
    min_subtotal: Number(f.min_subtotal) === 0 ? '' : montoATexto(f.min_subtotal, moneda),
    starts_on: fechaInicioATexto(f.starts_at),
    ends_on: fechaFinATexto(f.ends_at),
    usage_limit_total: f.usage_limit_total === null ? '' : String(f.usage_limit_total),
    usage_limit_per_customer: f.usage_limit_per_customer === null ? '' : String(f.usage_limit_per_customer),
    applies_to: f.applies_to,
    target_categories: f.applies_to === 'categories' ? f.target_ids.filter((i) => categoriaIds.has(i)) : [],
    target_products: f.applies_to === 'products' ? slugs(f.target_ids).join('\n') : '',
    exclude_categories: f.exclude_ids.filter((i) => categoriaIds.has(i)),
    exclude_products: slugs(f.exclude_ids).join('\n'),
    applies_to_sale_items: f.applies_to_sale_items,
    iza_can_offer: f.iza_can_offer,
    is_active: f.is_active,
    influencer_id: f.influencer_id ?? '',
  };
}

/** Regla 7: el nombre de un código no puede sonar a garantía de originalidad. */
export function codigoAfirmaOriginalidad(codigo: string): boolean {
  return afirmaOriginalidad(codigo.replace(/[_-]+/g, ' '));
}

// ── Filtros de la lista (URL) ────────────────────────────────────────────────────────────────────

export type FiltrosCodigos = {
  pais: 'CO' | 'EC';
  estado: EstadoCodigo | '';
  origen: OrigenCodigo | '';
  q: string;
  pagina: number;
};

type Buscables = Record<string, string | string[] | undefined>;
const primero = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] : v) ?? '';

export function leerFiltrosCodigos(sp: Buscables): FiltrosCodigos {
  const estado = primero(sp.estado);
  const origen = primero(sp.origen);
  const n = Number.parseInt(primero(sp.page), 10);
  return {
    pais: primero(sp.pais) === 'EC' ? 'EC' : 'CO',
    estado: (ESTADOS_FILTRO as readonly string[]).includes(estado) ? (estado as EstadoCodigo) : '',
    origen: (ORIGENES as readonly string[]).includes(origen) ? (origen as OrigenCodigo) : '',
    q: primero(sp.q).trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 30),
    pagina: Number.isFinite(n) && n >= 1 && n <= 10000 ? n : 1,
  };
}

export function parametrosCodigos(f: FiltrosCodigos): Record<string, string> {
  const p: Record<string, string> = { pais: f.pais };
  if (f.estado) p.estado = f.estado;
  if (f.origen) p.origen = f.origen;
  if (f.q) p.q = f.q;
  return p;
}
