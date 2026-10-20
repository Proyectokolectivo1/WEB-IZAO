/**
 * Cliente PostgREST compartido por las fuentes del worker (dueño: izao-pagos). Llave de servidor de Supabase,
 * tiempo límite de 15 s y errores sin cuerpo ni detalles de la base (solo el código SQLSTATE, p. ej. `23505`).
 * Credenciales comerciales: `integration_credentials` activa, descifrada con `APP_ENCRYPTION_KEY`
 * (`@izao/core/credentials`). Nunca se registran llaves, secretos ni respuestas.
 */
import { byteaDesdePostgrest, descifrarCredenciales } from '@izao/core/credentials';
import type { CountryCode } from '@izao/core/money';
import type { OrderStatus } from '@izao/core/order-state';

export interface OpcionesPostgrest {
  supabaseUrl: string;
  secretKey: string;
  claveCifrado: string;
  fetchImpl?: typeof fetch;
}

export class ErrorPostgrest extends Error {
  /** SQLSTATE devuelto por PostgREST (`code`), si vino; nunca el mensaje ni el detalle. */
  readonly codigo: string | null;
  constructor(operacion: string, status: number, codigo: string | null = null) {
    super(`PostgREST ${operacion} respondió HTTP ${status}${codigo ? ` (${codigo})` : ''}`);
    this.name = 'ErrorPostgrest';
    this.codigo = codigo;
  }
}

export type Fila = Record<string, unknown>;

export const eq = (v: string): string => `eq.${encodeURIComponent(v)}`;

export interface ClientePostgrest {
  pedir(operacion: string, ruta: string, init?: RequestInit): Promise<unknown>;
  filas(operacion: string, ruta: string): Promise<Fila[]>;
  /** RPC de un solo argumento `p_order_id`. */
  rpcPedido(nombre: string, orderId: string): Promise<unknown>;
  /** Valores descifrados de la credencial activa (exactamente una) del proveedor y país; `null` si no hay o falla. */
  credencial(provider: string, pais: CountryCode, etiqueta: string): Promise<{ valores: Record<string, string>; ambiente: 'sandbox' | 'production' } | null>;
}

const SQLSTATE = /^[0-9A-Z]{5}$/;

export function crearClientePostgrest(o: OpcionesPostgrest): ClientePostgrest {
  const base = `${o.supabaseUrl.replace(/\/+$/, '')}/rest/v1`;
  const doFetch = o.fetchImpl ?? fetch;
  const cabeceras = {
    apikey: o.secretKey,
    authorization: `Bearer ${o.secretKey}`,
    'content-type': 'application/json',
  };

  async function pedir(operacion: string, ruta: string, init: RequestInit = {}): Promise<unknown> {
    const res = await doFetch(`${base}/${ruta}`, {
      ...init,
      headers: { ...cabeceras, ...(init.headers as Record<string, string> | undefined) },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      let codigo: string | null = null;
      try {
        const c = (await res.json()) as { code?: unknown } | null;
        if (typeof c?.code === 'string' && SQLSTATE.test(c.code)) codigo = c.code;
      } catch {
        // cuerpo vacío o no JSON: basta con el HTTP
      }
      throw new ErrorPostgrest(operacion, res.status, codigo);
    }
    if (res.status === 204) return null;
    const texto = await res.text();
    return texto ? (JSON.parse(texto) as unknown) : null;
  }
  const filas = async (operacion: string, ruta: string) => ((await pedir(operacion, ruta)) as Fila[] | null) ?? [];

  return {
    pedir,
    filas,
    rpcPedido: (nombre, orderId) => pedir(nombre, `rpc/${nombre}`, { method: 'POST', body: JSON.stringify({ p_order_id: orderId }) }),
    async credencial(provider, pais, etiqueta) {
      const rows = await filas(
        'integration_credentials',
        `integration_credentials?provider=${eq(provider)}&country_code=${eq(pais)}&is_active=is.true&select=environment,data_encrypted,iv,key_version`,
      );
      if (rows.length !== 1) {
        if (rows.length > 1) console.error(`[${etiqueta}] hay más de una credencial activa de ${provider} para ${pais}`);
        return null;
      }
      const r = rows[0]!;
      const ambiente = r.environment === 'production' ? 'production' : 'sandbox';
      try {
        const valores = await descifrarCredenciales(
          o.claveCifrado,
          { provider, country_code: pais, environment: ambiente },
          {
            data_encrypted: byteaDesdePostgrest(String(r.data_encrypted)),
            iv: byteaDesdePostgrest(String(r.iv)),
            key_version: Number(r.key_version),
          },
        );
        return { valores, ambiente };
      } catch (e) {
        console.error(`[${etiqueta}] no se pudieron leer las credenciales de ${provider}: ${e instanceof Error ? e.name : 'error'}`);
        return null;
      }
    },
  };
}

/**
 * Resultado de `aplicar_transicion_pedido`: `true` si quedó aplicada (o ya lo estaba: `estado_cambiado` con
 * `status_actual = to_status`, p. ej. un reintento), `false` si otro proceso lo movió a otro estado (nada escrito).
 * `pedido_inexistente`, `datos_invalidos` o una forma desconocida lanzan (sin detalles de la base).
 */
export function interpretarTransicion(
  r: { ok?: unknown; motivo?: unknown; status_actual?: unknown; event_id?: unknown } | null,
  to: OrderStatus,
): boolean {
  if (r?.ok === true && typeof r.event_id === 'string') return true;
  if (r?.ok === false && r.motivo === 'estado_cambiado') return r.status_actual === to;
  const motivo = r?.ok === false && typeof r.motivo === 'string' ? r.motivo : 'forma';
  throw new Error(`aplicar_transicion_pedido rechazó: ${motivo.slice(0, 40)}`);
}

/** Llama `aplicar_transicion_pedido` (izao-db): update condicional por estado + `order_events` en una transacción. */
export async function aplicarTransicionRpc(
  c: ClientePostgrest,
  orderId: string,
  evento: { from_status: OrderStatus; to_status: OrderStatus; actor: string; payload: unknown },
  fechas: Record<string, Date | undefined> = {},
): Promise<boolean> {
  const p: Record<string, unknown> = {
    order_id: orderId,
    from_status: evento.from_status,
    to_status: evento.to_status,
    actor: evento.actor,
    payload: evento.payload,
  };
  const f = Object.fromEntries(Object.entries(fechas).flatMap(([k, v]) => (v ? [[k, v.toISOString()]] : [])));
  if (Object.keys(f).length > 0) p.fechas = f;
  const r = (await c.pedir('aplicar_transicion_pedido', 'rpc/aplicar_transicion_pedido', {
    method: 'POST',
    body: JSON.stringify({ p }),
  })) as { ok?: unknown; motivo?: unknown; status_actual?: unknown; event_id?: unknown } | null;
  return interpretarTransicion(r, evento.to_status);
}
