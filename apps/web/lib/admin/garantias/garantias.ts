/**
 * Garantías (§19, §24.1): filtros de la bandeja, flujo de estados, validación del formulario de gestión y de
 * los ajustes por país. Código puro (sin servidor ni navegador) compartido por Server Actions y pruebas.
 *
 * El costo asumido se escribe en unidad mayor y sale como entero en unidad menor (regla 1); alimenta la métrica
 * de garantías del dashboard (los casos rechazados no suman costo, ver `@izao/core/metrics`).
 */
import { z } from 'zod';
import { ESTADOS_GARANTIA, esFechaIso, type EstadoGarantia } from '@izao/core/metrics';
import { depurarHtml } from '@/lib/store/html-seguro';
import { MONEDA_PAIS, afirmaOriginalidad, montoOpcional, type PaisAjustes } from '../pagos/ajustes';

export { ESTADOS_GARANTIA };
export type { EstadoGarantia };

export const ETIQUETA_ESTADO_GARANTIA: Record<EstadoGarantia, string> = {
  recibida: 'Recibida',
  en_revision: 'En revisión',
  aprobada: 'Aprobada',
  rechazada: 'Rechazada',
  resuelta: 'Resuelta',
};

export const RESOLUCIONES = ['reenvio', 'cambio', 'reembolso', 'otro'] as const;
export type Resolucion = (typeof RESOLUCIONES)[number];
export const ETIQUETA_RESOLUCION: Record<Resolucion, string> = {
  reenvio: 'Reenvío del producto',
  cambio: 'Cambio por otro de igual valor',
  reembolso: 'Reembolso',
  otro: 'Otra solución',
};

/**
 * Transiciones permitidas. Un caso no salta de «recibida» a «resuelta»: se revisa y se aprueba o rechaza. Un caso
 * cerrado se puede reabrir (queda en el historial). Quedarse en el mismo estado (solo notas o costo) siempre vale.
 */
const TRANSICIONES: Record<EstadoGarantia, readonly EstadoGarantia[]> = {
  recibida: ['en_revision', 'aprobada', 'rechazada'],
  en_revision: ['aprobada', 'rechazada'],
  aprobada: ['resuelta', 'en_revision'],
  rechazada: ['en_revision'],
  resuelta: ['en_revision'],
};

export function transicionesDe(estado: EstadoGarantia): readonly EstadoGarantia[] {
  return TRANSICIONES[estado];
}

export function transicionPermitida(de: EstadoGarantia, a: EstadoGarantia): boolean {
  return de === a || TRANSICIONES[de].includes(a);
}

export function esEstadoGarantia(v: unknown): v is EstadoGarantia {
  return typeof v === 'string' && (ESTADOS_GARANTIA as readonly string[]).includes(v);
}

// ── Bandeja ──────────────────────────────────────────────────────────────────────────────────────

export type FiltrosGarantia = {
  q: string;
  pagina: number;
  estado: EstadoGarantia | '';
  pais: PaisAjustes | '';
  /** `YYYY-MM-DD` (inclusive) o vacío; fecha de creación en hora de Colombia. */
  desde: string;
  hasta: string;
  /** Solo casos abiertos (recibida o en revisión) con el plazo de respuesta vencido. */
  vencidas: boolean;
};

type Buscables = Record<string, string | string[] | undefined>;
const primero = (v: string | string[] | undefined): string => ((Array.isArray(v) ? v[0] : v) ?? '').trim();

export function leerFiltrosGarantia(sp: Buscables): FiltrosGarantia {
  const estado = primero(sp.estado);
  const pais = primero(sp.pais).toUpperCase();
  let desde = primero(sp.desde);
  let hasta = primero(sp.hasta);
  if (!esFechaIso(desde)) desde = '';
  if (!esFechaIso(hasta)) hasta = '';
  if (desde && hasta && desde > hasta) [desde, hasta] = [hasta, desde];
  const n = Number.parseInt(primero(sp.page), 10);
  return {
    q: primero(sp.q).slice(0, 100),
    pagina: Number.isFinite(n) && n >= 1 && n <= 10000 ? n : 1,
    estado: esEstadoGarantia(estado) ? estado : '',
    pais: pais === 'CO' || pais === 'EC' ? pais : '',
    desde,
    hasta,
    vencidas: primero(sp.vencidas) === '1',
  };
}

export function parametrosDeFiltrosGarantia(f: FiltrosGarantia): Record<string, string> {
  const salida: Record<string, string> = {};
  for (const k of ['q', 'estado', 'pais', 'desde', 'hasta'] as const) if (f[k]) salida[k] = f[k];
  if (f.vencidas) salida.vencidas = '1';
  return salida;
}

export type BusquedaGarantia = { campo: 'phone' | 'number' | 'customer_name'; patron: string };

/** 7+ dígitos = celular; `GAR-…` = número de caso; otro texto = nombre del cliente. */
export function interpretarBusquedaGarantia(q: string): BusquedaGarantia | null {
  const t = q.trim();
  if (!t) return null;
  if (/^\+?[\d\s-]+$/.test(t)) {
    const digitos = t.replace(/\D/g, '');
    if (digitos.length >= 7) return { campo: 'phone', patron: digitos };
  }
  if (/^gar-/i.test(t)) return { campo: 'number', patron: t.toUpperCase() };
  return { campo: 'customer_name', patron: t };
}

/** Fecha límite de respuesta: creación + `response_days` días calendario. */
export function limiteRespuesta(creadoEn: string, diasRespuesta: number): Date {
  const d = new Date(creadoEn);
  d.setUTCDate(d.getUTCDate() + diasRespuesta);
  return d;
}

/** ¿Está vencido el plazo de respuesta de un caso abierto? */
export function estaVencida(estado: EstadoGarantia, creadoEn: string, diasRespuesta: number, ahora: Date): boolean {
  if (estado !== 'recibida' && estado !== 'en_revision') return false;
  return limiteRespuesta(creadoEn, diasRespuesta).getTime() < ahora.getTime();
}

// ── Gestión de un caso ───────────────────────────────────────────────────────────────────────────

export type DatosGestion = {
  id: string;
  status: EstadoGarantia;
  resolution: Resolucion | null;
  cost_amount: bigint;
  admin_notes: string | null;
  /** Comentario que queda en el historial junto al cambio de estado. */
  nota_historial: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo ${max} caracteres.`)
    .default('')
    .transform((v) => (v === '' ? null : v));

/** Esquema del formulario de gestión; la moneda sale del país del caso. */
export function esquemaGestion(pais: PaisAjustes) {
  return z
    .object({
      id: z.string().regex(UUID, 'Identificador no válido.'),
      status: z.enum(ESTADOS_GARANTIA, { message: 'Elige un estado.' }),
      resolution: z
        .string()
        .trim()
        .default('')
        .refine((v) => v === '' || (RESOLUCIONES as readonly string[]).includes(v), 'Elige una solución válida.')
        .transform((v) => (v === '' ? null : (v as Resolucion))),
      cost_amount: montoOpcional(MONEDA_PAIS[pais], 'El costo asumido', false).transform((v) => v ?? 0n),
      admin_notes: textoOpcional(2000),
      nota_historial: textoOpcional(500),
    })
    .superRefine((d, ctx) => {
      if (d.status === 'resuelta' && d.resolution === null) {
        ctx.addIssue({ code: 'custom', path: ['resolution'], message: 'Indica cómo se resolvió el caso.' });
      }
    }) as z.ZodType<DatosGestion, unknown>;
}

/** Entrada del historial (`status_history`), la última al final. */
export type EntradaHistorial = { at: string; actor: string; from: EstadoGarantia | null; to: EstadoGarantia; nota: string | null };

export function leerHistorial(valor: unknown): EntradaHistorial[] {
  if (!Array.isArray(valor)) return [];
  const salida: EntradaHistorial[] = [];
  for (const e of valor) {
    if (!e || typeof e !== 'object') continue;
    const r = e as Record<string, unknown>;
    if (typeof r.at !== 'string' || !esEstadoGarantia(r.to)) continue;
    salida.push({
      at: r.at,
      actor: typeof r.actor === 'string' ? r.actor : 'desconocido',
      from: esEstadoGarantia(r.from) ? r.from : null,
      to: r.to,
      nota: typeof r.nota === 'string' && r.nota !== '' ? r.nota : null,
    });
  }
  return salida;
}

// ── Ajustes por país (`warranty_settings`) ───────────────────────────────────────────────────────

export const MAX_MOTIVOS = 20;

export type DatosAjustesGarantia = {
  country_code: PaisAjustes;
  period_days: number;
  response_days: number;
  reasons: string[];
  instructions_html: string;
  conditions_html: string;
};

const enteroPositivo = (etiqueta: string, max: number) =>
  z
    .string()
    .trim()
    .regex(/^\d+$/, `${etiqueta} debe ser un número entero.`)
    .transform(Number)
    .refine((n) => n >= 1 && n <= max, `${etiqueta} debe estar entre 1 y ${max}.`);

/** HTML depurado (lista blanca de la tienda), con tope de tamaño y sin afirmaciones de originalidad (regla 7). */
const textoPublico = (etiqueta: string, max: number) =>
  z
    .string()
    .max(max, `Máximo ${max} caracteres.`)
    .default('')
    .transform((v) => depurarHtml(v).trim())
    .refine((v) => !afirmaOriginalidad(v), `${etiqueta}: no afirmes originalidad, autenticidad ni certificados.`);

export const esquemaAjustesGarantia = z.object({
  country_code: z.enum(['CO', 'EC'], { message: 'País no válido.' }),
  period_days: enteroPositivo('El plazo de garantía', 365),
  response_days: enteroPositivo('El tiempo de respuesta', 60),
  /** Un motivo por línea. */
  reasons: z
    .string()
    .default('')
    .transform((v) => [...new Set(v.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== ''))])
    .refine((l) => l.length >= 1, 'Agrega al menos un motivo.')
    .refine((l) => l.length <= MAX_MOTIVOS, `Máximo ${MAX_MOTIVOS} motivos.`)
    .refine((l) => l.every((m) => m.length <= 80), 'Cada motivo admite hasta 80 caracteres.')
    .refine((l) => !l.some(afirmaOriginalidad), 'Los motivos no pueden afirmar originalidad ni autenticidad.'),
  instructions_html: textoPublico('Las instrucciones', 8000),
  conditions_html: textoPublico('Las condiciones', 8000),
}) as unknown as z.ZodType<DatosAjustesGarantia, unknown>;
