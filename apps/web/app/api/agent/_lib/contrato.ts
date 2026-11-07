/**
 * Contrato v1 (revisión 1.1, compatible) de la API del agente de impresión (`docs/integraciones/agente-api.md`, §15.3). Esquemas de entrada,
 * hash del token y formas de respuesta. Sin dependencias de Next ni de la base.
 */
import { createHash } from 'node:crypto';
import { urlEtiquetaSegura } from '@izao/mastershop';
import { z } from 'zod';

export const VERSION_CONTRATO = 1;
/** Revisión compatible: 1.1 agrega `label_url` en los trabajos (D-051). Un agente 1.0 la ignora. */
export const REVISION_CONTRATO = '1.1';
export const MAX_RECLAMO = 5;
/** Un trabajo reclamado por otro agente sin resultado en este tiempo se puede volver a reclamar. */
export const RECLAMO_VENCIDO_MS = 15 * 60_000;
/** Valores de §15 si el panel no los configura. */
export const INTERVALOS_DEFECTO = Object.freeze({ heartbeat_seconds: 30, claim_seconds: 10, panel_retry_seconds: 300 });

const TOKEN = /^[A-Za-z0-9_-]{32,256}$/;

/** `print_agents.token_hash`: sha256 del token en hexadecimal minúscula (el panel usa la misma función). */
export function hashTokenAgente(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Token del encabezado `Authorization: Bearer …`; `null` si falta o no tiene la forma esperada. */
export function tokenDeEncabezado(valor: string | null): string | null {
  if (!valor) return null;
  const m = /^Bearer ([^\s]+)$/.exec(valor.trim());
  return m && TOKEN.test(m[1]!) ? m[1]! : null;
}

const textoCorto = (max: number) => z.string().max(max);

export const LatidoSchema = z.strictObject({
  version: textoCorto(40).min(1),
  printer: textoCorto(200).nullable(),
  printer_ok: z.boolean(),
  queue_size: z.number().int().min(0).max(100_000),
  last_error: textoCorto(500).nullable(),
  panel_state: z.enum(['ok', 'needs_login', 'paused', 'disabled']).optional(),
});
export type Latido = z.infer<typeof LatidoSchema>;

export const ReclamoSchema = z.strictObject({ max: z.number().int().min(1).max(MAX_RECLAMO).optional() });

/** PNG en base64, ≤ 2 MB decodificado (≈ 2,8 MB en base64). */
export const MAX_CAPTURA_BYTES = 2 * 1024 * 1024;

export const ResultadoSchema = z
  .strictObject({
    status: z.enum(['printed', 'failed']),
    attempts: z.number().int().min(1).max(10).optional(),
    error: textoCorto(1000).optional(),
    screenshot_png_base64: z
      .string()
      .max(Math.ceil((MAX_CAPTURA_BYTES * 4) / 3) + 4)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/)
      .optional(),
  })
  .refine((r) => r.status === 'printed' || (r.error !== undefined && r.error.trim() !== ''), {
    message: 'error es obligatorio en failed',
    path: ['error'],
  });
export type ResultadoAgente = z.infer<typeof ResultadoSchema>;

export const ID_TRABAJO = z.uuid();

export type TipoTrabajo = 'label' | 'packing_list' | 'test_page';
export type EstadoTrabajo = 'queued' | 'claimed' | 'printed' | 'failed' | 'cancelled';

export interface TrabajoFila {
  id: string;
  type: TipoTrabajo;
  status: EstadoTrabajo;
  order_id: string | null;
  shipment_id: string | null;
  order_number: string | null;
  claimed_by_agent: string | null;
  claimed_at: string | null;
  attempts: number;
  requested_by: string;
  created_at: string;
  /** `shipments.label_url` (URL pública de MasterShop), sin validar. */
  label_url?: string | null;
  /** El servidor tiene la copia en `MEDIA_ROOT/labels/` (`shipments.label_local_path`). */
  label_local?: boolean;
}

export interface TrabajoRespuesta {
  id: string;
  type: TipoTrabajo;
  order_number: string | null;
  reprint: boolean;
  created_at: string;
  claimed_at: string | null;
  label_path: string;
  /**
   * v1.1: solo en `label` sin copia en el servidor (el CDN bloquea su IP, D-051). El agente descarga el PDF de aquí
   * sin `Authorization`. Siempre `https://cdn.bemaster.com/…` (validada); `null` en los demás casos.
   */
  label_url: string | null;
}

/** URL pública que se entrega al agente, o `null` si el servidor tiene copia o la URL no es del CDN esperado. */
export function urlEtiquetaParaAgente(t: TrabajoFila): string | null {
  if (t.type !== 'label' || t.label_local === true) return null;
  return urlEtiquetaSegura(t.label_url ?? null);
}

export function aRespuesta(t: TrabajoFila): TrabajoRespuesta {
  return {
    id: t.id,
    type: t.type,
    order_number: t.order_number,
    reprint: t.requested_by !== 'auto',
    created_at: t.created_at,
    claimed_at: t.claimed_at,
    label_path: `/api/agent/jobs/${t.id}/label`,
    label_url: urlEtiquetaParaAgente(t),
  };
}

/** Versión de la configuración: cambia si cambia el modo o la configuración remota. */
export function versionConfig(mode: string, remota: unknown): string {
  return createHash('sha256').update(JSON.stringify({ mode, remota })).digest('hex').slice(0, 16);
}
