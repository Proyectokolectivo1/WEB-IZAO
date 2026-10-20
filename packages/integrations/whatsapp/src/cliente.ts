/**
 * Cliente mínimo de la WhatsApp Cloud API (§13.2, D-025): enviar plantilla y crear versión de plantilla.
 * Token permanente de usuario del sistema como Bearer, solo desde el servidor. Los errores nunca incluyen el token
 * ni el texto de Meta (que puede repetir datos del cliente): solo el código.
 */
import { z } from 'zod';
import type { MensajePlantillaMeta, SolicitudPlantillaMeta } from './plantillas';

export interface CredencialesWhatsApp {
  phoneNumberId: string;
  wabaId: string;
  tokenAcceso: string;
  appSecret: string;
  tokenVerificacion: string;
  versionGraph: string;
}

export type CodigoErrorWhatsApp = 'RED' | 'CREDENCIALES' | 'DESTINO' | 'PLANTILLA' | 'LIMITE' | 'HTTP' | 'RESPUESTA_INVALIDA';

export class ErrorWhatsApp extends Error {
  readonly codigo: CodigoErrorWhatsApp;
  readonly reintentable: boolean;
  readonly status: number | null;
  readonly metaCode: string | null;
  constructor(codigo: CodigoErrorWhatsApp, reintentable: boolean, status: number | null = null, metaCode: string | null = null) {
    super(`WhatsApp: ${codigo}${status ? ` (HTTP ${status})` : ''}${metaCode ? ` [${metaCode}]` : ''}`);
    this.name = 'ErrorWhatsApp';
    this.codigo = codigo;
    this.reintentable = reintentable;
    this.status = status;
    this.metaCode = metaCode;
  }
}

export interface ClienteWhatsApp {
  enviarPlantilla(m: MensajePlantillaMeta): Promise<{ wa_message_id: string }>;
  crearPlantilla(s: SolicitudPlantillaMeta): Promise<{ meta_template_id: string; status: string }>;
}

/** Códigos de Meta: destino inválido o sin WhatsApp; plantilla inexistente, pausada o con parámetros mal. */
const DESTINO = new Set(['131026', '131030', '131009', '131051', '131021', '131045']);
const PLANTILLA = new Set(['132000', '132001', '132005', '132007', '132012', '132015', '132016', '132068', '132069']);
const LIMITE = new Set(['4', '80007', '130429', '131048', '131056', '133016']);

const errorSchema = z.object({ error: z.object({ code: z.number().int().optional() }) });
const envioSchema = z.object({ messages: z.array(z.object({ id: z.string().min(1).max(256) })).min(1) });
const plantillaSchema = z.object({ id: z.string().regex(/^\d{1,30}$/), status: z.string().max(40) });

export function crearClienteWhatsApp(c: CredencialesWhatsApp, o: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}): ClienteWhatsApp {
  if (!/^v\d{1,3}\.\d$/.test(c.versionGraph)) throw new RangeError('Versión de Graph API inválida (p. ej. v26.0).');
  if (!/^\d{5,30}$/.test(c.phoneNumberId) || !/^\d{5,30}$/.test(c.wabaId)) throw new RangeError('Identificadores de WhatsApp inválidos.');
  const base = `https://graph.facebook.com/${c.versionGraph}`;
  const doFetch = o.fetchImpl ?? fetch;

  async function post(ruta: string, cuerpo: unknown): Promise<unknown> {
    let res: Response;
    try {
      res = await doFetch(`${base}/${ruta}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${c.tokenAcceso}`, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(cuerpo),
        signal: AbortSignal.timeout(o.timeoutMs ?? 10_000),
      });
    } catch {
      throw new ErrorWhatsApp('RED', true);
    }
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      if (res.ok) throw new ErrorWhatsApp('RESPUESTA_INVALIDA', true, res.status);
    }
    if (res.ok) return json;
    const p = errorSchema.safeParse(json);
    const code = p.success && p.data.error.code !== undefined ? String(p.data.error.code) : null;
    if (res.status === 401 || code === '190' || code === '10' || code === '200') throw new ErrorWhatsApp('CREDENCIALES', false, res.status, code);
    if (res.status === 429 || (code && LIMITE.has(code))) throw new ErrorWhatsApp('LIMITE', true, res.status, code);
    if (code && DESTINO.has(code)) throw new ErrorWhatsApp('DESTINO', false, res.status, code);
    if (code && PLANTILLA.has(code)) throw new ErrorWhatsApp('PLANTILLA', false, res.status, code);
    throw new ErrorWhatsApp('HTTP', res.status >= 500, res.status, code);
  }

  return {
    async enviarPlantilla(m) {
      const p = envioSchema.safeParse(await post(`${c.phoneNumberId}/messages`, m));
      if (!p.success) throw new ErrorWhatsApp('RESPUESTA_INVALIDA', false);
      return { wa_message_id: p.data.messages[0]!.id };
    },
    async crearPlantilla(s) {
      const p = plantillaSchema.safeParse(await post(`${c.wabaId}/message_templates`, s));
      if (!p.success) throw new ErrorWhatsApp('RESPUESTA_INVALIDA', false);
      return { meta_template_id: p.data.id, status: p.data.status };
    },
  };
}
