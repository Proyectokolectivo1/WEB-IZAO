/**
 * Manejadores de la API del agente de impresión (contrato v1.1, `docs/integraciones/agente-api.md`). Lógica pura
 * sobre `FuenteAgente`; las rutas solo conectan la base y el disco. Respuestas sin detalles internos; los logs
 * nunca llevan el token, el contenido del PDF ni la captura.
 */
import path from 'node:path';
import {
  ID_TRABAJO,
  INTERVALOS_DEFECTO,
  LatidoSchema,
  MAX_CAPTURA_BYTES,
  MAX_RECLAMO,
  RECLAMO_VENCIDO_MS,
  REVISION_CONTRATO,
  ReclamoSchema,
  ResultadoSchema,
  VERSION_CONTRATO,
  aRespuesta,
  hashTokenAgente,
  tokenDeEncabezado,
  versionConfig,
  type EstadoTrabajo,
  type TrabajoFila,
} from './contrato';
import { pdfPaginaPrueba } from './pdf-prueba';

export interface AgenteFila {
  id: string;
  name: string;
  mode: 'api' | 'panel';
  /** `print_agents.remote_config` (objeto jsonb; `{}` = valores por defecto). */
  remote_config: Record<string, unknown>;
}

export interface CierreTrabajo {
  status: 'printed' | 'failed';
  printed_at: string | null;
  error: string | null;
  attempts: number;
}

export interface FuenteAgente {
  agentePorHash(hash: string): Promise<AgenteFila | null>;
  guardarLatido(agenteId: string, datos: { version: string; printer_name: string | null; status_payload: Record<string, unknown> }, ahora: Date): Promise<void>;
  /** Trabajos `claimed` de este agente (sin resultado), del más antiguo al más nuevo. */
  reclamadosPor(agenteId: string, max: number): Promise<TrabajoFila[]>;
  /** Ids `queued` o reclamados por otro agente antes de `vencidoAntes`, del más antiguo al más nuevo. */
  candidatos(agenteId: string, max: number, vencidoAntes: Date): Promise<string[]>;
  /** `UPDATE … SET claimed` condicionado a que sigan `queued` o vencidos; devuelve los que quedaron para este agente. */
  reclamar(ids: readonly string[], agenteId: string, ahora: Date, vencidoAntes: Date): Promise<TrabajoFila[]>;
  trabajo(id: string): Promise<TrabajoFila | null>;
  /** `UPDATE` condicionado a `status = claimed` y `claimed_by_agent = agenteId`; `true` si cambió una fila. */
  cerrar(id: string, agenteId: string, cierre: CierreTrabajo): Promise<boolean>;
  /** `shipments.label_local_path` (relativa a `MEDIA_ROOT`). */
  rutaEtiqueta(shipmentId: string): Promise<string | null>;
  alertaPedido(orderId: string, payload: Record<string, unknown>): Promise<void>;
}

export interface DepsAgente {
  fuente: FuenteAgente;
  mediaRoot: string;
  leerArchivo(rutaAbsoluta: string): Promise<Uint8Array | null>;
  /** Guarda la captura bajo `MEDIA_ROOT/agent-screenshots/`; devuelve la ruta relativa. */
  guardarCaptura(nombre: string, bytes: Uint8Array): Promise<string>;
  ahora?: () => Date;
}

const CABECERAS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

function json(cuerpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(cuerpo), { status, headers: CABECERAS });
}

const error = (codigo: string, status: number) => json({ error: codigo }, status);

/** Tope del cuerpo por ruta (la de resultado admite la captura en base64). */
const MAX_CUERPO = 16 * 1024;
const MAX_CUERPO_RESULTADO = 3 * 1024 * 1024;

async function leerJson(req: Request, max: number, vacioPermitido = false): Promise<{ ok: true; valor: unknown } | { ok: false; res: Response }> {
  const declarado = Number(req.headers.get('content-length') ?? '0');
  if (declarado > max) return { ok: false, res: error('muy_grande', 413) };
  const crudo = new Uint8Array(await req.arrayBuffer());
  if (crudo.byteLength > max) return { ok: false, res: error('muy_grande', 413) };
  if (crudo.byteLength === 0) return vacioPermitido ? { ok: true, valor: {} } : { ok: false, res: error('datos_invalidos', 400) };
  try {
    return { ok: true, valor: JSON.parse(new TextDecoder().decode(crudo)) };
  } catch {
    return { ok: false, res: error('datos_invalidos', 400) };
  }
}

/** Autentica con el token del agente. Devuelve el agente o la respuesta de error. */
async function autenticar(req: Request, deps: DepsAgente): Promise<AgenteFila | Response> {
  const token = tokenDeEncabezado(req.headers.get('authorization'));
  if (!token) return error('no_autorizado', 401);
  try {
    const agente = await deps.fuente.agentePorHash(hashTokenAgente(token));
    return agente ?? error('no_autorizado', 401);
  } catch (e) {
    console.error(`[agente] autenticación: ${e instanceof Error ? e.name : 'error'}`);
    return error('no_disponible_temporalmente', 503);
  }
}

async function conAgente(req: Request, deps: DepsAgente, f: (a: AgenteFila) => Promise<Response>): Promise<Response> {
  const a = await autenticar(req, deps);
  if (a instanceof Response) return a;
  try {
    return await f(a);
  } catch (e) {
    console.error(`[agente] ${new URL(req.url).pathname.replace(/[0-9a-f-]{36}/g, ':id')}: ${e instanceof Error ? e.message.slice(0, 120) : 'error'}`);
    return error('no_disponible_temporalmente', 503);
  }
}

const ahoraDe = (deps: DepsAgente) => (deps.ahora ?? (() => new Date()))();

export function manejarLatido(req: Request, deps: DepsAgente): Promise<Response> {
  return conAgente(req, deps, async (agente) => {
    const cuerpo = await leerJson(req, MAX_CUERPO);
    if (!cuerpo.ok) return cuerpo.res;
    const p = LatidoSchema.safeParse(cuerpo.valor);
    if (!p.success) return error('datos_invalidos', 400);
    const ahora = ahoraDe(deps);
    await deps.fuente.guardarLatido(
      agente.id,
      {
        version: p.data.version,
        printer_name: p.data.printer,
        status_payload: {
          printer_ok: p.data.printer_ok,
          queue_size: p.data.queue_size,
          last_error: p.data.last_error,
          panel_state: p.data.panel_state ?? null,
          received_at: ahora.toISOString(),
        },
      },
      ahora,
    );
    return json({ ok: true, server_time: ahora.toISOString(), config_version: versionConfig(agente.mode, agente.remote_config) });
  });
}

export function manejarReclamo(req: Request, deps: DepsAgente): Promise<Response> {
  return conAgente(req, deps, async (agente) => {
    const cuerpo = await leerJson(req, MAX_CUERPO, true);
    if (!cuerpo.ok) return cuerpo.res;
    const p = ReclamoSchema.safeParse(cuerpo.valor);
    if (!p.success) return error('datos_invalidos', 400);
    const max = p.data.max ?? MAX_RECLAMO;
    const ahora = ahoraDe(deps);
    const vencidoAntes = new Date(ahora.getTime() - RECLAMO_VENCIDO_MS);

    const propios = await deps.fuente.reclamadosPor(agente.id, max);
    const nuevos: TrabajoFila[] = [];
    if (propios.length < max) {
      const yaMios = new Set(propios.map((t) => t.id));
      const ids = (await deps.fuente.candidatos(agente.id, max - propios.length, vencidoAntes)).filter((i) => !yaMios.has(i));
      if (ids.length > 0) nuevos.push(...(await deps.fuente.reclamar(ids, agente.id, ahora, vencidoAntes)));
    }
    return json({ jobs: [...propios, ...nuevos].slice(0, max).map(aRespuesta) });
  });
}

/** El trabajo es de este agente (reclamado o ya cerrado por él). */
function esDe(t: TrabajoFila, agenteId: string): boolean {
  return t.claimed_by_agent === agenteId && (t.status === 'claimed' || t.status === 'printed' || t.status === 'failed');
}

export function manejarEtiqueta(req: Request, id: string, deps: DepsAgente): Promise<Response> {
  return conAgente(req, deps, async (agente) => {
    if (!ID_TRABAJO.safeParse(id).success) return error('no_encontrado', 404);
    const t = await deps.fuente.trabajo(id);
    if (!t || !esDe(t, agente.id)) return error('no_encontrado', 404);

    let bytes: Uint8Array | null = null;
    let nombre = `${t.id}.pdf`;
    if (t.type === 'test_page') {
      const ahora = ahoraDe(deps);
      bytes = pdfPaginaPrueba(['Izao Perfumería', 'Página de prueba', ahora.toISOString().replace('T', ' ').slice(0, 19) + ' UTC', `Trabajo ${t.id.slice(0, 8)}`]);
      nombre = 'pagina-de-prueba.pdf';
    } else if (t.type === 'label') {
      const rel = t.shipment_id ? await deps.fuente.rutaEtiqueta(t.shipment_id) : null;
      const abs = rel ? rutaSegura(deps.mediaRoot, rel) : null;
      if (!abs) return error('no_encontrado', 404);
      bytes = await deps.leerArchivo(abs);
      if (t.order_number && /^[A-Za-z0-9-]+$/.test(t.order_number)) nombre = `${t.order_number}.pdf`;
    } else {
      return error('no_disponible', 501);
    }
    if (!bytes || !esPdf(bytes)) return error('no_encontrado', 404);
    return new Response(bytes as BodyInit, {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-length': String(bytes.byteLength),
        'content-disposition': `attachment; filename="${nombre}"`,
        'cache-control': 'no-store',
      },
    });
  });
}

/** Ruta absoluta solo dentro de `MEDIA_ROOT/labels/` (nada de `..` ni rutas absolutas). */
export function rutaSegura(mediaRoot: string, relativa: string): string | null {
  if (path.isAbsolute(relativa) || relativa.includes('\0')) return null;
  const base = path.resolve(mediaRoot, 'labels');
  const abs = path.resolve(mediaRoot, relativa);
  return abs.startsWith(base + path.sep) && abs.toLowerCase().endsWith('.pdf') ? abs : null;
}

function esPdf(b: Uint8Array): boolean {
  return b.byteLength > 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d;
}

function esPng(b: Uint8Array): boolean {
  const firma = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return b.byteLength > 8 && firma.every((x, i) => b[i] === x);
}

export function manejarResultado(req: Request, id: string, deps: DepsAgente): Promise<Response> {
  return conAgente(req, deps, async (agente) => {
    if (!ID_TRABAJO.safeParse(id).success) return error('no_encontrado', 404);
    const cuerpo = await leerJson(req, MAX_CUERPO_RESULTADO);
    if (!cuerpo.ok) return cuerpo.res;
    const p = ResultadoSchema.safeParse(cuerpo.valor);
    if (!p.success) return error('datos_invalidos', 400);
    const r = p.data;

    const t = await deps.fuente.trabajo(id);
    if (!t || t.claimed_by_agent !== agente.id) return error(t ? 'estado_invalido' : 'no_encontrado', t ? 409 : 404);
    if (t.status === r.status) return json({ ok: true, duplicado: true });
    if (t.status !== 'claimed') return error('estado_invalido', 409);

    let detalle: string | null = r.status === 'failed' ? (r.error ?? '').trim().slice(0, 1000) : null;
    if (r.status === 'failed' && r.screenshot_png_base64) {
      const bytes = new Uint8Array(Buffer.from(r.screenshot_png_base64, 'base64'));
      if (bytes.byteLength > MAX_CAPTURA_BYTES) return error('muy_grande', 413);
      if (!esPng(bytes)) return error('datos_invalidos', 400);
      const ruta = await deps.guardarCaptura(`${t.id}-${ahoraDe(deps).getTime()}.png`, bytes);
      detalle = `${detalle ?? ''} [captura: ${ruta}]`.trim().slice(0, 1200);
    }
    const ahora = ahoraDe(deps);
    const cierre = {
      status: r.status,
      printed_at: r.status === 'printed' ? ahora.toISOString() : null,
      error: detalle,
      attempts: t.attempts + (r.attempts ?? 1),
    };
    const cambio = await deps.fuente.cerrar(t.id, agente.id, cierre);
    if (!cambio) {
      // Otro reporte llegó primero: idempotente si quedó igual.
      const otra = await deps.fuente.trabajo(id);
      if (otra && otra.claimed_by_agent === agente.id && otra.status === r.status) return json({ ok: true, duplicado: true });
      return error('estado_invalido', 409);
    }
    if (r.status === 'failed' && t.order_id) {
      await deps.fuente.alertaPedido(t.order_id, {
        motivo: 'impresion_fallida',
        print_job_id: t.id,
        tipo: t.type,
        intentos: cierre.attempts,
        error: detalle,
      });
    }
    return json({ ok: true, duplicado: false });
  });
}

export function manejarConfig(req: Request, deps: DepsAgente): Promise<Response> {
  return conAgente(req, deps, async (agente) => {
    const remota = agente.remote_config;
    const intervalosRemotos = typeof remota.intervals === 'object' && remota.intervals !== null ? (remota.intervals as Record<string, unknown>) : {};
    const intervalo = (k: keyof typeof INTERVALOS_DEFECTO) => {
      const v = intervalosRemotos[k];
      return typeof v === 'number' && Number.isInteger(v) && v >= 5 && v <= 3600 ? v : INTERVALOS_DEFECTO[k];
    };
    const objeto = (v: unknown) => (typeof v === 'object' && v !== null && !Array.isArray(v) ? v : null);
    return json({
      contract_version: VERSION_CONTRATO,
      contract_revision: REVISION_CONTRATO,
      config_version: versionConfig(agente.mode, remota),
      agent: { id: agente.id, name: agente.name, mode: agente.mode },
      intervals: {
        heartbeat_seconds: intervalo('heartbeat_seconds'),
        claim_seconds: intervalo('claim_seconds'),
        panel_retry_seconds: intervalo('panel_retry_seconds'),
      },
      max_claim: MAX_RECLAMO,
      print: objeto(remota.print),
      panel: objeto(remota.panel),
    });
  });
}

export type { EstadoTrabajo, TrabajoFila };
