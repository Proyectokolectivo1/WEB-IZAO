/**
 * Cliente mínimo de la API de e-commerce de Addi (documentación oficial en api-docs-sandbox.addi.com, D-031).
 * - Token: `POST {auth}/oauth/token` `{audience, grant_type: client_credentials, client_id, client_secret}` →
 *   `{access_token, expires_in, token_type}` (`expires_in` de ejemplo 86400 s). Se guarda en memoria del proceso
 *   hasta 60 s antes de vencer y se comparte entre clientes con el mismo ambiente, client ID, huella SHA-256 del
 *   secreto (nunca el secreto) y transporte `fetch`; peticiones simultáneas comparten una sola solicitud de token.
 * - Solicitud: `POST {api}/v1/online-applications` con `Authorization: Bearer`. Responde **301** con `Location`
 *   (la URL de Addi para el cliente): no se sigue la redirección, se captura y solo se acepta https en los
 *   dominios de Addi del ambiente (`ADDI_ENDPOINTS[ambiente].dominiosRedireccion`, D-036). 409 = el cliente ya
 *   tiene crédito.
 * - La API de e-commerce no documenta consulta de estado: el estado llega solo por el callback (Basic auth).
 * Timeouts de 10 s. Los errores nunca incluyen credenciales ni cuerpos de respuesta.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ADDI_ENDPOINTS, type AddiCredentials } from './credentials';
import type { SolicitudAddi } from './solicitud';

export type CodigoErrorAddi =
  | 'CREDENCIALES'
  | 'CLIENTE_CON_CREDITO'
  | 'VALIDACION'
  | 'RED'
  | 'HTTP'
  | 'RESPUESTA_INVALIDA';

export class ErrorAddi extends Error {
  readonly codigo: CodigoErrorAddi;
  readonly reintentable: boolean;
  readonly status: number | null;
  constructor(codigo: CodigoErrorAddi, reintentable: boolean, status: number | null = null) {
    super(`Addi: ${codigo}${status ? ` (HTTP ${status})` : ''}`);
    this.name = 'ErrorAddi';
    this.codigo = codigo;
    this.reintentable = reintentable;
    this.status = status;
  }
}

export interface OpcionesClienteAddi {
  credenciales: AddiCredentials;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  ahora?: () => Date;
  /** Reemplaza los dominios aceptados en `Location` (por defecto, los del ambiente en `ADDI_ENDPOINTS`). */
  dominiosRedireccion?: readonly string[];
}

export interface ClienteAddi {
  /** Crea la solicitud de crédito en línea; devuelve la URL https de Addi a la que se envía al cliente. */
  crearSolicitud(cuerpo: SolicitudAddi): Promise<{ url: string }>;
  /** Solo pide un token (para "Probar conexión"). */
  verificarToken(): Promise<void>;
}

const tokenSchema = z.object({
  access_token: z.string().min(1),
  // La documentación lo declara `number` (double).
  expires_in: z.number().positive().finite(),
  token_type: z.string().optional(),
});

const MARGEN_TOKEN_MS = 60_000;
const MAX_TOKENS_EN_CACHE = 16;

/** `true` si la URL es https, sin usuario ni puerto, en uno de los dominios o en un subdominio suyo. */
export function urlRedireccionAddiPermitida(url: string, dominios: readonly string[]): boolean {
  if (!/^https:\/\/[^\s]+$/.test(url)) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.username !== '' || u.password !== '' || u.port !== '') return false;
  const host = u.hostname.toLowerCase();
  return dominios.some((d) => {
    const dom = d.trim().toLowerCase().replace(/^\.+/, '');
    return dom !== '' && (host === dom || host.endsWith(`.${dom}`));
  });
}

interface EntradaToken {
  token: string;
  venceMs: number;
}

interface CacheTokens {
  vigentes: Map<string, EntradaToken>;
  enCurso: Map<string, Promise<EntradaToken>>;
}

/** Caché por transporte: el `fetch` global en producción; cada `fetch` falso de las pruebas tiene la suya. */
const cachePorTransporte = new WeakMap<typeof fetch, CacheTokens>();

function cacheDe(f: typeof fetch): CacheTokens {
  let c = cachePorTransporte.get(f);
  if (!c) {
    c = { vigentes: new Map(), enCurso: new Map() };
    cachePorTransporte.set(f, c);
  }
  return c;
}

function llaveToken(c: AddiCredentials): string {
  const huella = createHash('sha256').update(c.clientSecret).digest('hex');
  return `${c.ambiente}|${c.clientId}|${huella}`;
}

export function crearClienteAddi(o: OpcionesClienteAddi): ClienteAddi {
  const ep = ADDI_ENDPOINTS[o.credenciales.ambiente];
  const doFetch = o.fetchImpl ?? fetch;
  const timeoutMs = o.timeoutMs ?? 10_000;
  const ahora = o.ahora ?? (() => new Date());
  const dominios = o.dominiosRedireccion ?? ep.dominiosRedireccion;
  const cache = cacheDe(doFetch);
  const llave = llaveToken(o.credenciales);

  async function llamar(url: string, init: RequestInit): Promise<Response> {
    try {
      return await doFetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      throw new ErrorAddi('RED', true);
    }
  }

  async function pedirToken(): Promise<EntradaToken> {
    const res = await llamar(ep.auth, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        audience: ep.audience,
        grant_type: 'client_credentials',
        client_id: o.credenciales.clientId,
        client_secret: o.credenciales.clientSecret,
      }),
    });
    if (res.status === 401 || res.status === 403) throw new ErrorAddi('CREDENCIALES', false, res.status);
    if (!res.ok) throw new ErrorAddi('HTTP', res.status >= 500 || res.status === 429, res.status);
    let cuerpo: unknown;
    try {
      cuerpo = await res.json();
    } catch {
      throw new ErrorAddi('RESPUESTA_INVALIDA', true, res.status);
    }
    const p = tokenSchema.safeParse(cuerpo);
    if (!p.success) throw new ErrorAddi('RESPUESTA_INVALIDA', false, res.status);
    const entrada: EntradaToken = {
      token: p.data.access_token,
      venceMs: ahora().getTime() + Math.floor(p.data.expires_in * 1000),
    };
    if (!cache.vigentes.has(llave) && cache.vigentes.size >= MAX_TOKENS_EN_CACHE) {
      const masAntigua = cache.vigentes.keys().next().value;
      if (masAntigua !== undefined) cache.vigentes.delete(masAntigua);
    }
    cache.vigentes.set(llave, entrada);
    return entrada;
  }

  async function token(): Promise<string> {
    const vigente = cache.vigentes.get(llave);
    if (vigente && vigente.venceMs - MARGEN_TOKEN_MS > ahora().getTime()) return vigente.token;
    let pendiente = cache.enCurso.get(llave);
    if (!pendiente) {
      pendiente = pedirToken().finally(() => cache.enCurso.delete(llave));
      cache.enCurso.set(llave, pendiente);
    }
    return (await pendiente).token;
  }

  /** Solo borra el token rechazado: si otro cliente ya lo renovó, se conserva el nuevo. */
  function invalidar(usado: string): void {
    if (cache.vigentes.get(llave)?.token === usado) cache.vigentes.delete(llave);
  }

  async function enviar(cuerpo: SolicitudAddi): Promise<{ res: Response; usado: string }> {
    const usado = await token();
    const res = await llamar(`${ep.api}/v1/online-applications`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${usado}` },
      body: JSON.stringify(cuerpo),
    });
    return { res, usado };
  }

  return {
    async verificarToken() {
      await token();
    },
    async crearSolicitud(cuerpo) {
      let { res, usado } = await enviar(cuerpo);
      if (res.status === 401) {
        // Token revocado o vencido antes de lo informado: uno nuevo, una sola vez.
        invalidar(usado);
        ({ res, usado } = await enviar(cuerpo));
        if (res.status === 401) invalidar(usado);
      }
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location') ?? '';
        if (!urlRedireccionAddiPermitida(location, dominios)) throw new ErrorAddi('RESPUESTA_INVALIDA', false, res.status);
        return { url: location };
      }
      if (res.status === 409) throw new ErrorAddi('CLIENTE_CON_CREDITO', false, 409);
      if (res.status === 401 || res.status === 403) throw new ErrorAddi('CREDENCIALES', false, res.status);
      if (res.status >= 400 && res.status < 500 && res.status !== 429 && res.status !== 408) {
        throw new ErrorAddi('VALIDACION', false, res.status);
      }
      throw new ErrorAddi('HTTP', true, res.status);
    },
  };
}

const MENSAJES: Record<CodigoErrorAddi, string> = {
  CREDENCIALES: 'Addi rechazó el client ID o el client secret.',
  CLIENTE_CON_CREDITO: 'Respuesta inesperada de Addi.',
  VALIDACION: 'Addi rechazó la solicitud.',
  RED: 'No fue posible conectar con Addi.',
  HTTP: 'Addi no respondió correctamente. Intenta de nuevo.',
  RESPUESTA_INVALIDA: 'Respuesta inesperada de Addi.',
};

/** "Probar conexión" del panel: pide un token. No crea solicitudes. */
export async function probarCredencialesAddi(
  credenciales: AddiCredentials,
  o: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<{ ok: boolean; message: string }> {
  try {
    await crearClienteAddi({ credenciales, ...o }).verificarToken();
    return { ok: true, message: 'Conexión con Addi verificada.' };
  } catch (e) {
    return { ok: false, message: e instanceof ErrorAddi ? MENSAJES[e.codigo] : 'No fue posible conectar con Addi.' };
  }
}
