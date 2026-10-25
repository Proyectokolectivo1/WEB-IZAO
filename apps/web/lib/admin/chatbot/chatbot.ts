/**
 * Chatbot Iza (§20.6, §20.4): validación de los ajustes, presupuesto en micro-USD, estado del consumo y filtros de las
 * conversaciones. Código puro compartido por Server Actions y pruebas. Todo número configurable (modelos, presupuesto,
 * umbral de degradación, límites) vive en `chat_settings` y se edita aquí: nada de eso va quemado en el código (regla 3).
 */
import { z } from 'zod';
import { esFechaIso, fechaBogota } from '@izao/core/metrics';
import { afirmaOriginalidad } from '../pagos/ajustes';

export const PAISES_CHAT = ['CO', 'EC'] as const;
export type PaisChat = (typeof PAISES_CHAT)[number];

// ── Presupuesto ──────────────────────────────────────────────────────────────────────────────────

const MICROS_POR_USD = 1_000_000n;
const MAX_PRESUPUESTO_MICROS = 100_000n * MICROS_POR_USD;

/** `10`, `10.5` o `10,25` USD → micro-USD; hasta 6 decimales. `null` si no es válido. */
export function usdAMicros(texto: string): bigint | null {
  const m = /^(\d{1,6})(?:[.,](\d{1,6}))?$/.exec(texto.trim());
  if (!m) return null;
  const micros = BigInt(m[1]!) * MICROS_POR_USD + BigInt((m[2] ?? '').padEnd(6, '0'));
  return micros <= MAX_PRESUPUESTO_MICROS ? micros : null;
}

/** micro-USD → texto para el formulario (`10000000n` → `10`; `2500000n` → `2.5`). */
export function microsATexto(micros: bigint): string {
  const entero = micros / MICROS_POR_USD;
  const dec = (micros % MICROS_POR_USD).toString().padStart(6, '0').replace(/0+$/, '');
  return dec ? `${entero}.${dec}` : `${entero}`;
}

/** micro-USD → `USD 3,45` (centavos, medio hacia arriba). */
export function formatoUsdMicros(micros: bigint): string {
  const centavos = (micros + 5_000n) / 10_000n;
  const entero = centavos / 100n;
  const c = (centavos % 100n).toString().padStart(2, '0');
  return `USD ${entero.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${c}`;
}

/** Porcentaje del presupuesto gastado, en centésimas de punto (puntos básicos). `null` si el presupuesto es 0. */
export function usoPresupuestoBp(gastado: bigint, presupuesto: bigint): bigint | null {
  if (presupuesto <= 0n) return null;
  return (gastado * 10_000n + presupuesto / 2n) / presupuesto;
}

export type EstadoPresupuesto = 'normal' | 'respaldo' | 'agotado' | 'sin_presupuesto';

/**
 * Qué hace Iza con el consumo actual (§20.4): al llegar a `degrade_at_pct` pasa al modelo de respaldo y al 100 % el widget
 * deriva al asesor por WhatsApp. Un presupuesto en 0 equivale a "sin servicio".
 */
export function estadoPresupuesto(gastado: bigint, presupuesto: bigint, degradarPct: number): EstadoPresupuesto {
  if (presupuesto <= 0n) return 'sin_presupuesto';
  if (gastado >= presupuesto) return 'agotado';
  if (gastado * 100n >= presupuesto * BigInt(degradarPct)) return 'respaldo';
  return 'normal';
}

export const ETIQUETA_ESTADO_PRESUPUESTO: Record<EstadoPresupuesto, string> = {
  normal: 'Todo en orden',
  respaldo: 'Usando el modelo de respaldo',
  agotado: 'Presupuesto agotado: Iza deriva al asesor por WhatsApp',
  sin_presupuesto: 'Sin presupuesto: Iza no responde',
};

/** Primer día del mes (hora de Bogotá) de `ahora`, como `YYYY-MM-01`. */
export function mesActual(ahora: Date): string {
  return `${fechaBogota(ahora).slice(0, 7)}-01`;
}

// ── Ajustes ──────────────────────────────────────────────────────────────────────────────────────

export type DatosAjustesChat = {
  is_enabled: boolean;
  model_primary: string | null;
  model_fallback: string | null;
  monthly_budget_usd_micros: bigint;
  degrade_at_pct: number;
  extra_instructions: string | null;
  welcome: Record<PaisChat, string | null>;
  max_output_tokens: number;
  history_turns: number;
  max_input_chars: number;
  max_messages_per_session: number;
};

const casilla = z.preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean());
/** Identificadores de modelo de OpenRouter: `proveedor/modelo` con variantes (`:free`, `:online`). */
const PATRON_MODELO = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/i;

const modelo = (etiqueta: string) =>
  z
    .string()
    .trim()
    .max(100, 'Máximo 100 caracteres.')
    .default('')
    .refine((v) => v === '' || PATRON_MODELO.test(v), `${etiqueta}: usa el formato proveedor/modelo, por ejemplo google/gemini-2.5-flash.`)
    .transform((v) => (v === '' ? null : v));

const entero = (etiqueta: string, min: number, max: number) =>
  z
    .string()
    .trim()
    .regex(/^\d+$/, `${etiqueta} debe ser un número entero.`)
    .transform(Number)
    .refine((n) => n >= min && n <= max, `${etiqueta} debe estar entre ${min} y ${max}.`);

const bienvenida = z
  .string()
  .trim()
  .max(300, 'Máximo 300 caracteres.')
  .default('')
  .refine((v) => !afirmaOriginalidad(v), 'No afirmes originalidad ni autenticidad.')
  .transform((v) => (v === '' ? null : v));

export const esquemaAjustesChat = z
  .object({
    is_enabled: casilla,
    model_primary: modelo('El modelo principal'),
    model_fallback: modelo('El modelo de respaldo'),
    presupuesto: z
      .string()
      .trim()
      .transform((v, ctx): bigint => {
        const m = usdAMicros(v);
        if (m === null) {
          ctx.addIssue({ code: 'custom', message: 'Escribe un valor en USD, como 10 o 12.50 (hasta 100 000).' });
          return 0n;
        }
        return m;
      }),
    degrade_at_pct: entero('El umbral', 1, 100),
    extra_instructions: z
      .string()
      .trim()
      .max(2000, 'Máximo 2000 caracteres.')
      .default('')
      .refine((v) => !afirmaOriginalidad(v), 'Escríbelas sin afirmar originalidad ni autenticidad (ni siquiera para negarlas): Iza ya trae esa regla y deriva esas preguntas a un asesor.')
      .transform((v) => (v === '' ? null : v)),
    welcome_CO: bienvenida,
    welcome_EC: bienvenida,
    max_output_tokens: entero('Las palabras de respuesta (tokens)', 50, 2000),
    history_turns: entero('Los turnos de historial', 1, 50),
    max_input_chars: entero('Los caracteres por mensaje', 50, 2000),
    max_messages_per_session: entero('Los mensajes por sesión', 1, 200),
  })
  .superRefine((d, ctx) => {
    if (d.is_enabled && d.model_primary === null) {
      ctx.addIssue({ code: 'custom', path: ['model_primary'], message: 'Para activar a Iza elige el modelo principal.' });
    }
  })
  .transform(
    (d): DatosAjustesChat => ({
      is_enabled: d.is_enabled,
      model_primary: d.model_primary,
      model_fallback: d.model_fallback,
      monthly_budget_usd_micros: d.presupuesto,
      degrade_at_pct: d.degrade_at_pct,
      extra_instructions: d.extra_instructions,
      welcome: { CO: d.welcome_CO, EC: d.welcome_EC },
      max_output_tokens: d.max_output_tokens,
      history_turns: d.history_turns,
      max_input_chars: d.max_input_chars,
      max_messages_per_session: d.max_messages_per_session,
    }),
  ) as unknown as z.ZodType<DatosAjustesChat, unknown>;

/** `welcome_message` a guardar: lo previo con los países del formulario reemplazados (vacío = sin mensaje propio). */
export function bienvenidaAGuardar(previo: Record<string, unknown> | null, nuevo: Record<PaisChat, string | null>): Record<string, unknown> {
  const salida: Record<string, unknown> = { ...(previo ?? {}) };
  for (const p of PAISES_CHAT) {
    if (nuevo[p]) salida[p] = nuevo[p];
    else delete salida[p];
  }
  return salida;
}

export function bienvenidaDe(valor: unknown, pais: PaisChat): string {
  const t = valor && typeof valor === 'object' ? (valor as Record<string, unknown>)[pais] : undefined;
  return typeof t === 'string' ? t : '';
}

// ── Conversaciones ───────────────────────────────────────────────────────────────────────────────

export type FiltrosConversacion = {
  pagina: number;
  pais: PaisChat | '';
  convertida: 'si' | 'no' | '';
  desde: string;
  hasta: string;
  /** Texto a buscar dentro de los mensajes (mínimo 3 caracteres). */
  q: string;
};

type Buscables = Record<string, string | string[] | undefined>;
const primero = (v: string | string[] | undefined): string => ((Array.isArray(v) ? v[0] : v) ?? '').trim();

export function leerFiltrosConversacion(sp: Buscables): FiltrosConversacion {
  const pais = primero(sp.pais).toUpperCase();
  const conv = primero(sp.convertida);
  let desde = primero(sp.desde);
  let hasta = primero(sp.hasta);
  if (!esFechaIso(desde)) desde = '';
  if (!esFechaIso(hasta)) hasta = '';
  if (desde && hasta && desde > hasta) [desde, hasta] = [hasta, desde];
  const n = Number.parseInt(primero(sp.page), 10);
  const q = primero(sp.q).slice(0, 80);
  return {
    pagina: Number.isFinite(n) && n >= 1 && n <= 10000 ? n : 1,
    pais: pais === 'CO' || pais === 'EC' ? pais : '',
    convertida: conv === 'si' || conv === 'no' ? conv : '',
    desde,
    hasta,
    q: q.length >= 3 ? q : '',
  };
}

export function parametrosDeFiltrosConversacion(f: FiltrosConversacion): Record<string, string> {
  const salida: Record<string, string> = {};
  for (const k of ['pais', 'convertida', 'desde', 'hasta', 'q'] as const) if (f[k]) salida[k] = f[k];
  return salida;
}

/** Tasa de conversión (puntos básicos) = sesiones que terminaron en pedido / sesiones con al menos un mensaje. */
export function conversionBp(convertidas: number, sesiones: number): bigint | null {
  if (sesiones <= 0) return null;
  return (BigInt(convertidas) * 10_000n + BigInt(sesiones) / 2n) / BigInt(sesiones);
}
