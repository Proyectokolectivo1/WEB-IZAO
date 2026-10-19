/**
 * Errores de la API de MasterShop clasificados para decidir si se reintenta.
 * El mensaje del proveedor se conserva completo en `providerMessage` (para `order_events`);
 * al cliente final solo se le muestra un texto amable.
 */

export type MasterShopErrorKind =
  /** 400: el cuerpo o los parámetros no cumplen el esquema o las reglas. */
  | 'validacion'
  /** 401/403: llave ausente, inválida o sin permiso. */
  | 'autenticacion'
  /** 404: "Orden no existe!". */
  | 'no_encontrado'
  /** 409 en PUT: hay otra actualización en curso; se reintenta a los 5 s. */
  | 'edicion_concurrente'
  /** 409 en PUT: el pedido ya no está en 1 o 2. */
  | 'estado_no_editable'
  /** 422: la plataforma rechazó la actualización; no se modificó. */
  | 'rechazado'
  /** 429: se agotó la ventana de `RateLimit-*`. */
  | 'limite'
  /** 500 y otros 5xx: error del servidor o rechazo de la plataforma al crear. */
  | 'servidor'
  /** 502 en PUT: no se sabe si se aplicó; se consulta, no se reintenta a ciegas. */
  | 'no_confirmado'
  /** Fallo de red. */
  | 'red'
  /** Se superó el tiempo de espera. */
  | 'tiempo_agotado'
  /** La respuesta no tiene la forma esperada. */
  | 'respuesta_invalida';

const RETRYABLE: ReadonlySet<MasterShopErrorKind> = new Set([
  'edicion_concurrente',
  'limite',
  'servidor',
  'red',
  'tiempo_agotado',
]);

export const REDACTED = '[REDACTADO]';

const SECRET_KEY_NAMES = /^(api_?key|ms-api-key|apikey|token|secret)$/i;

/** Reemplaza cada secreto por `[REDACTADO]` y redacta claves con nombre de llave. */
export function redactSecrets<T>(value: T, secrets: readonly string[]): T {
  const usable = secrets.filter((s) => s.length >= 4);
  const scrub = (v: unknown, depth: number): unknown => {
    if (typeof v === 'string') {
      return usable.reduce((acc, s) => acc.split(s).join(REDACTED), v);
    }
    if (depth > 20 || v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map((x) => scrub(x, depth + 1));
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      out[k] =
        SECRET_KEY_NAMES.test(k) && x !== null && x !== undefined ? REDACTED : scrub(x, depth + 1);
    }
    return out;
  };
  return scrub(value, 0) as T;
}

export class MasterShopError extends Error {
  readonly kind: MasterShopErrorKind;
  readonly status: number | null;
  /** Texto del campo `error` de la respuesta, completo. */
  readonly providerMessage: string | null;
  /** `data` de la respuesta (por ejemplo, la lista de `{ message, path }` de un 400). */
  readonly providerData: unknown;
  /** Espera sugerida por el proveedor (429 → `RateLimit-Reset`). */
  readonly retryAfterMs: number | null;

  constructor(init: {
    kind: MasterShopErrorKind;
    message: string;
    status?: number | null;
    providerMessage?: string | null;
    providerData?: unknown;
    retryAfterMs?: number | null;
    cause?: unknown;
    /** Valores que nunca deben quedar en el error (la `ms-api-key`). */
    secrets?: readonly string[];
  }) {
    const secrets = init.secrets ?? [];
    super(
      redactSecrets(init.message, secrets),
      init.cause === undefined ? undefined : { cause: init.cause },
    );
    this.name = 'MasterShopError';
    this.kind = init.kind;
    this.status = init.status ?? null;
    this.providerMessage = redactSecrets(init.providerMessage ?? null, secrets);
    this.providerData = redactSecrets(init.providerData, secrets);
    this.retryAfterMs = init.retryAfterMs ?? null;
  }

  /** Forma segura para logs y `order_events`. */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      kind: this.kind,
      status: this.status,
      message: this.message,
      providerMessage: this.providerMessage,
      providerData: this.providerData,
      retryAfterMs: this.retryAfterMs,
    };
  }

  /** Si un job puede volver a intentarlo más tarde con la política de reintentos. */
  get retryable(): boolean {
    return RETRYABLE.has(this.kind);
  }
}

export function isMasterShopError(e: unknown): e is MasterShopError {
  return e instanceof MasterShopError;
}

/** Respuesta `500` de creación que en realidad significa "ya existe" (§14.5). */
export const DUPLICATE_ORDER_PATTERN = /409\s*-\s*La orden ya existe/i;

/**
 * Código de la plataforma dentro de un `500` de creación ("Código 400 - … - Error interno
 * del servidor"). La colección documenta que toda falla de la plataforma al crear se
 * reporta con 500 y el código original va en el mensaje.
 */
export const PLATFORM_CODE_PATTERN = /C[oó]digo\s+(\d{3})\b/i;

/** Código 4xx de la plataforma dentro del mensaje, o `null`. */
export function platformClientErrorCode(message: string | null): number | null {
  const m = message === null ? null : PLATFORM_CODE_PATTERN.exec(message);
  const code = m ? Number(m[1]) : null;
  return code !== null && code >= 400 && code < 500 ? code : null;
}

/** `409` de edición concurrente (texto de la documentación). */
export const CONCURRENT_EDIT_PATTERN = /actualizaci[oó]n en curso/i;
