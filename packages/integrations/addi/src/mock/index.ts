/**
 * Utilidades de prueba de Addi, sin red: un `fetch` falso que responde como el staging documentado
 * (`/oauth/token` de Auth0 y `POST /v1/online-applications` con 301 + `Location`) y callbacks con
 * autenticación Basic. Credenciales ficticias. Nunca usar en producción.
 */
import type { AddiCredentials } from '../credentials';
import { ADDI_ENDPOINTS } from '../credentials';
import type { EstadoAddi } from '../estado';

export const CREDENCIALES_ADDI_PRUEBA: AddiCredentials = {
  ambiente: 'sandbox',
  clientId: 'aWQtZmljdGljaW8tZGUtcHJ1ZWJh',
  clientSecret: 'c2VjcmV0by1maWN0aWNpby1kZS1wcnVlYmE',
  usuarioCallback: 'izao-callback',
  claveCallback: 'clave-ficticia-de-callback-0001',
  allySlug: null,
};

export type RespuestaSolicitudFalsa = 'redirige' | 'conflicto' | 'validacion' | 'caida' | 'sin_location' | 'location_http' | 'red';

export interface OpcionesFetchAddi {
  credenciales?: AddiCredentials;
  solicitud?: RespuestaSolicitudFalsa;
  /** `expires_in` del token en segundos. */
  expiraEn?: number;
  /** Responde 401 al primer uso del token (token revocado). */
  tokenRevocadoUnaVez?: boolean;
}

export interface FetchAddiFalso {
  fetch: typeof fetch;
  llamadas: { url: string; method: string; headers: Record<string, string>; body: unknown; redirect: RequestRedirect | undefined }[];
  tokensEmitidos: number;
}

function json(cuerpo: unknown, status: number): Response {
  return new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } });
}

export function fetchAddiFalso(o: OpcionesFetchAddi = {}): FetchAddiFalso {
  const creds = o.credenciales ?? CREDENCIALES_ADDI_PRUEBA;
  const ep = ADDI_ENDPOINTS[creds.ambiente];
  const estado: FetchAddiFalso = { fetch: undefined as never, llamadas: [], tokensEmitidos: 0 };
  let revocar = o.tokenRevocadoUnaVez ?? false;
  const vigentes = new Set<string>();

  estado.fetch = (async (entrada: string | URL | Request, init?: RequestInit) => {
    const url = String(entrada);
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null;
    estado.llamadas.push({ url, method: init?.method ?? 'GET', headers, body, redirect: init?.redirect });

    if (url === ep.auth) {
      const b = body as Record<string, string>;
      if (b.grant_type !== 'client_credentials' || b.audience !== ep.audience) {
        return json({ error: 'access_denied', error_description: `Service not enabled within domain: ${b.audience}` }, 403);
      }
      if (b.client_id !== creds.clientId || b.client_secret !== creds.clientSecret) {
        return json({ error: 'access_denied', error_description: 'Unauthorized' }, 401);
      }
      estado.tokensEmitidos += 1;
      const token = `jwt-ficticio-${estado.tokensEmitidos}`;
      vigentes.add(token);
      return json({ access_token: token, scope: 'online-application', expires_in: o.expiraEn ?? 86_400, token_type: 'Bearer' }, 200);
    }

    if (url === `${ep.api}/v1/online-applications` && init?.method === 'POST') {
      const token = (headers.authorization ?? '').replace(/^Bearer /, '');
      if (!vigentes.has(token) || revocar) {
        revocar = false;
        vigentes.delete(token);
        return json({ code: '401', message: 'Unauthorized' }, 401);
      }
      const orderId = (body as { orderId?: string }).orderId ?? 'x';
      switch (o.solicitud ?? 'redirige') {
        case 'redirige':
          return new Response(null, {
            status: 301,
            headers: { location: `https://checkout.addi-staging.com/aplicacion/${encodeURIComponent(orderId)}` },
          });
        case 'sin_location':
          return new Response(null, { status: 301 });
        case 'location_http':
          return new Response(null, { status: 301, headers: { location: 'http://inseguro.example.com/x' } });
        case 'conflicto':
          return json({ code: '409', message: 'El cliente ya cuenta con crédito en ADDI' }, 409);
        case 'validacion':
          return json({ code: '001-001', message: 'Campo inválido' }, 400);
        case 'caida':
          return json({ code: '500', message: 'error' }, 503);
        case 'red':
          throw new TypeError('fetch failed');
      }
    }
    return new Response('Not found.', { status: 404 });
  }) as typeof fetch;
  return estado;
}

export interface CallbackPrueba {
  orderId: string;
  applicationId?: string;
  approvedAmount?: string;
  currency?: string;
  status: EstadoAddi;
  statusTimestamp?: string;
}

/** Callback como lo envía Addi: cuerpo JSON crudo y cabecera `Authorization: Basic …`. */
export function callbackAddi(
  c: CallbackPrueba,
  o: { usuario?: string; clave?: string } = {},
): { cuerpo: string; headers: Record<string, string> } {
  const cuerpo = JSON.stringify({
    orderId: c.orderId,
    applicationId: c.applicationId ?? 'o957b4611-6ef7-4f1c-b9be-02207bd9fd80',
    approvedAmount: c.approvedAmount ?? (c.status === 'APPROVED' ? '99000.0' : '0'),
    currency: c.currency ?? 'COP',
    status: c.status,
    statusTimestamp: c.statusTimestamp ?? '1760972400',
  });
  const usuario = o.usuario ?? CREDENCIALES_ADDI_PRUEBA.usuarioCallback;
  const clave = o.clave ?? CREDENCIALES_ADDI_PRUEBA.claveCallback;
  return {
    cuerpo,
    headers: {
      authorization: `Basic ${Buffer.from(`${usuario}:${clave}`, 'utf8').toString('base64')}`,
      'content-type': 'application/json',
    },
  };
}
