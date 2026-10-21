/**
 * Pagos y países (§24.1): validación pura de los ajustes por país (`country_settings`) y de los métodos de pago
 * (`payment_method_settings`). Los montos se escriben en unidad mayor (COP `10000`, USD `5.50`) y salen como
 * enteros en unidad menor con `fromMajorString` (regla 1: nada de floats). Código puro, sin servidor.
 */
import { z } from 'zod';
import {
  CURRENCY_EXPONENT,
  MoneyError,
  fromDbAmount,
  fromMajorString,
  toDecimalString,
  type CountryCode,
  type CurrencyCode,
} from '@izao/core/money';

export const PAISES_AJUSTES = ['CO', 'EC'] as const satisfies readonly CountryCode[];
export type PaisAjustes = (typeof PAISES_AJUSTES)[number];
export const MONEDA_PAIS: Record<PaisAjustes, CurrencyCode> = { CO: 'COP', EC: 'USD' };

export function esPaisAjustes(v: unknown): v is PaisAjustes {
  return v === 'CO' || v === 'EC';
}

export const METODOS = ['wompi', 'addi', 'sistecredito', 'cod'] as const;
export type MetodoPago = (typeof METODOS)[number];
export const ETIQUETA_METODO: Record<MetodoPago, string> = {
  wompi: 'Wompi',
  addi: 'Addi',
  sistecredito: 'Sistecrédito',
  cod: 'Contra entrega',
};
/** Métodos que cobran un recargo de financiación (porcentaje configurable en el país). */
export const METODOS_CON_RECARGO = ['addi', 'sistecredito'] as const;

/** Regla 7: ningún texto del panel afirma originalidad, autenticidad ni certificados. */
const AFIRMA_ORIGINALIDAD = /\b(original(es)?|aut[eé]ntic[oa]s?|genuin[oa]s?|certificad[oa]s?|r[ée]plica)\b/i;

export function afirmaOriginalidad(texto: string): boolean {
  return AFIRMA_ORIGINALIDAD.test(texto);
}

// ── Utilidades de campos ─────────────────────────────────────────────────────────────────────────

const HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** `21:00:00` (time de Postgres) o `21:00` → `21:00`. */
export function horaCorta(valor: string | null | undefined): string {
  const m = /^(\d{2}):(\d{2})/.exec(valor ?? '');
  return m ? `${m[1]}:${m[2]}` : '';
}

function aMinutos(hora: string): number {
  const [h, m] = hora.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** `"3, 12, 21"` (horas; decimales con punto: `1.5`) → minutos ordenados y sin repetir. `null` si algo no es válido. */
export function horasAMinutos(texto: string): number[] | null {
  const partes = texto.split(/[,;\s]+/).filter((p) => p !== '');
  const minutos: number[] = [];
  for (const p of partes) {
    if (!/^\d{1,3}(\.\d{1,2})?$/.test(p)) return null;
    const n = Number(p);
    if (n <= 0) return null;
    minutos.push(Math.round(n * 60));
  }
  return [...new Set(minutos)].sort((x, y) => x - y);
}

/** Minutos → texto de horas para el formulario: `[180, 720, 1260]` → `3, 12, 21`. */
export function minutosAHoras(minutos: readonly number[] | null | undefined): string {
  return (minutos ?? []).map((m) => String(Math.round((m / 60) * 100) / 100)).join(', ');
}

/** Monto en unidad menor (de la base) → texto en unidad mayor para el formulario. */
export function montoATexto(valor: unknown, moneda: CurrencyCode): string {
  if (valor === null || valor === undefined || valor === '') return '';
  return toDecimalString({ amount: fromDbAmount(valor as number | string | bigint), currency: moneda });
}

function montoOpcional(moneda: CurrencyCode, etiqueta: string, requerido: boolean) {
  return z.string().transform((v, ctx): bigint | null => {
    const t = v.trim().replace(',', '.');
    if (t === '') {
      if (requerido) ctx.addIssue({ code: 'custom', message: `${etiqueta} es obligatorio.` });
      return null;
    }
    try {
      const m = fromMajorString(t, moneda);
      if (m.amount < 0n) throw new MoneyError('INVALID_AMOUNT', 'negativo');
      if (m.amount > 9_000_000_000_000n) throw new MoneyError('INVALID_AMOUNT', 'muy grande');
      return m.amount;
    } catch {
      const dec = CURRENCY_EXPONENT[moneda];
      ctx.addIssue({
        code: 'custom',
        message: `${etiqueta} debe ser un valor en ${moneda} ${dec === 0 ? 'sin decimales' : `con máximo ${dec} decimales`}.`,
      });
      return null;
    }
  });
}

/** Porcentaje decimal con hasta 2 decimales y rango 0–100, o vacío. */
function porcentaje(etiqueta: string, max = 100) {
  return z.string().transform((v, ctx): number | null => {
    const t = v.trim().replace(',', '.');
    if (t === '') return null;
    if (!/^\d{1,3}(\.\d{1,2})?$/.test(t) || Number(t) > max) {
      ctx.addIssue({ code: 'custom', message: `${etiqueta} debe estar entre 0 y ${max}, con máximo 2 decimales.` });
      return null;
    }
    return Number(t);
  });
}

function entero(etiqueta: string, min: number, max: number) {
  return z
    .string()
    .trim()
    .regex(/^\d+$/, `${etiqueta} debe ser un número entero.`)
    .transform(Number)
    .pipe(z.number().int().min(min, `${etiqueta} mínimo ${min}.`).max(max, `${etiqueta} máximo ${max}.`));
}

// ── Ajustes del país ─────────────────────────────────────────────────────────────────────────────

export type AjustesPais = {
  cod_enabled: boolean;
  cod_deposit_amount: bigint;
  cod_min_collect_amount: bigint;
  cod_link_ttl_hours: number;
  cod_reminder_offsets_minutes: number[];
  cod_quiet_hours_start: string;
  cod_quiet_hours_end: string;
  cod_resend_max: number;
  /** Solo claves de recargo con valor; las demás claves del JSON guardado se conservan al escribir. */
  surcharge: Record<string, number>;
  pending_payment_ttl_minutes: number;
  manual_order_ttl_hours: number;
  /** COP por 1 unidad mayor de la moneda del país; `null` = [COMPLETAR]. */
  fx_rate_to_cop: string | null;
  carrier_wallet_low_balance: bigint | null;
};

/** Esquema del formulario del país. Todo llega como texto; la salida ya está tipada y en unidad menor. */
export function esquemaAjustesPais(pais: PaisAjustes) {
  const moneda = MONEDA_PAIS[pais];
  return z
    .object({
      cod_enabled: z.string().optional(),
      cod_deposit_amount: montoOpcional(moneda, 'El abono', true),
      cod_min_collect_amount: montoOpcional(moneda, 'El recaudo mínimo', true),
      cod_link_ttl_hours: entero('La vigencia del link', 1, 168),
      cod_reminder_hours: z.string().default(''),
      cod_quiet_hours_start: z.string().trim().regex(HORA, 'Usa el formato HH:MM (24 horas).'),
      cod_quiet_hours_end: z.string().trim().regex(HORA, 'Usa el formato HH:MM (24 horas).'),
      cod_resend_max: entero('El máximo de reenvíos', 0, 50),
      surcharge_addi: porcentaje('El recargo de Addi'),
      surcharge_sistecredito: porcentaje('El recargo de Sistecrédito'),
      pending_payment_ttl_minutes: entero('El tiempo para pagar', 5, 1440),
      manual_order_ttl_hours: entero('La reserva del pedido manual', 1, 168),
      fx_rate_to_cop: z.string().default(''),
      carrier_wallet_low_balance: montoOpcional(moneda, 'El umbral de saldo bajo', false),
    })
    .superRefine((d, ctx) => {
      if (d.cod_quiet_hours_start === d.cod_quiet_hours_end) {
        ctx.addIssue({ code: 'custom', path: ['cod_quiet_hours_end'], message: 'El inicio y el fin del horario silencioso no pueden ser iguales.' });
      }
      const minutos = horasAMinutos(d.cod_reminder_hours);
      if (minutos === null) {
        ctx.addIssue({ code: 'custom', path: ['cod_reminder_hours'], message: 'Escribe las horas separadas por comas, p. ej. 3, 12, 21 (decimales con punto: 1.5).' });
      } else {
        if (minutos.length > 6) ctx.addIssue({ code: 'custom', path: ['cod_reminder_hours'], message: 'Máximo 6 recordatorios.' });
        if (minutos.some((m) => m >= d.cod_link_ttl_hours * 60)) {
          ctx.addIssue({
            code: 'custom',
            path: ['cod_reminder_hours'],
            message: `Cada recordatorio debe ir antes de que venza el link (${d.cod_link_ttl_hours} h).`,
          });
        }
      }
      const fx = d.fx_rate_to_cop.trim().replace(',', '.');
      if (fx !== '' && (!/^\d{1,12}(\.\d{1,6})?$/.test(fx) || Number(fx) <= 0)) {
        ctx.addIssue({ code: 'custom', path: ['fx_rate_to_cop'], message: 'La tasa debe ser un número positivo con máximo 6 decimales.' });
      }
    })
    .transform((d): AjustesPais => {
      const surcharge: Record<string, number> = {};
      if (d.surcharge_addi !== null) surcharge.addi = d.surcharge_addi;
      if (d.surcharge_sistecredito !== null) surcharge.sistecredito = d.surcharge_sistecredito;
      const fx = d.fx_rate_to_cop.trim().replace(',', '.');
      return {
        cod_enabled: d.cod_enabled === 'on',
        cod_deposit_amount: d.cod_deposit_amount ?? 0n,
        cod_min_collect_amount: d.cod_min_collect_amount ?? 0n,
        cod_link_ttl_hours: d.cod_link_ttl_hours,
        cod_reminder_offsets_minutes: horasAMinutos(d.cod_reminder_hours) ?? [],
        cod_quiet_hours_start: d.cod_quiet_hours_start,
        cod_quiet_hours_end: d.cod_quiet_hours_end,
        cod_resend_max: d.cod_resend_max,
        surcharge,
        pending_payment_ttl_minutes: d.pending_payment_ttl_minutes,
        manual_order_ttl_hours: d.manual_order_ttl_hours,
        fx_rate_to_cop: fx === '' ? null : fx,
        carrier_wallet_low_balance: d.carrier_wallet_low_balance,
      };
    });
}

/** Cuánto antes del fin del horario silencioso cae un recordatorio: ayuda de texto, nunca un cálculo de negocio. */
export function duracionSilencioso(inicio: string, fin: string): number {
  const a = aMinutos(inicio);
  const b = aMinutos(fin);
  return b > a ? b - a : 24 * 60 - a + b;
}

// ── Métodos de pago ──────────────────────────────────────────────────────────────────────────────

export type AjustesMetodo = {
  is_enabled: boolean;
  sort_order: number;
  display_name: string;
  description: string | null;
  fee_pct: number;
  fee_fixed: bigint;
  fee_tax_pct: number;
};

export function esquemaMetodo(pais: PaisAjustes) {
  const moneda = MONEDA_PAIS[pais];
  return z
    .object({
      is_enabled: z.string().optional(),
      sort_order: entero('El orden', 0, 99),
      display_name: z.string().trim().min(1, 'El nombre es obligatorio.').max(60, 'Máximo 60 caracteres.'),
      description: z.string().trim().max(200, 'Máximo 200 caracteres.').default(''),
      fee_pct: porcentaje('El porcentaje de comisión', 100),
      fee_fixed: montoOpcional(moneda, 'La comisión fija', false),
      fee_tax_pct: porcentaje('El impuesto sobre la comisión', 100),
    })
    .superRefine((d, ctx) => {
      if (afirmaOriginalidad(d.display_name)) {
        ctx.addIssue({ code: 'custom', path: ['display_name'], message: 'Ese texto afirma originalidad o certificados; no está permitido.' });
      }
      if (afirmaOriginalidad(d.description)) {
        ctx.addIssue({ code: 'custom', path: ['description'], message: 'Ese texto afirma originalidad o certificados; no está permitido.' });
      }
    })
    .transform(
      (d): AjustesMetodo => ({
        is_enabled: d.is_enabled === 'on',
        sort_order: d.sort_order,
        display_name: d.display_name,
        description: d.description === '' ? null : d.description,
        fee_pct: d.fee_pct ?? 0,
        fee_fixed: d.fee_fixed ?? 0n,
        fee_tax_pct: d.fee_tax_pct ?? 0,
      }),
    );
}

/**
 * Regla de §13 y del módulo: "Contra entrega" solo puede estar activo si el país tiene la contra entrega
 * habilitada. Devuelve el mensaje de error o `null`.
 */
export function motivoMetodoNoActivable(metodo: MetodoPago, quiereActivo: boolean, codHabilitadoEnPais: boolean): string | null {
  if (quiereActivo && metodo === 'cod' && !codHabilitadoEnPais) {
    return 'Para activar la contra entrega, primero habilítala en los ajustes del país.';
  }
  return null;
}
