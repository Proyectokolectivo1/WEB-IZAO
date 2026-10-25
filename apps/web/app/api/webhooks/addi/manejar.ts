/**
 * Callback de Addi (§12.3, D-031). Orden: cuerpo crudo con tope → autenticación HTTP Basic (usuario y clave del
 * callback de `integration_credentials`, comparación en tiempo constante) → esquema → registro idempotente en
 * `webhook_events (provider addi, event_id = applicationId.status.statusTimestamp)` → encolar `addi.callback` →
 * 200 con **el mismo objeto** recibido (Addi reintenta cada 30 min durante 24 h hasta recibirlo).
 * Nada cambia el pedido aquí: el job compara referencia, monto y moneda con `payments` y transiciona.
 * - Autenticación inválida: 401 sin registrar (un tercero no puede ocupar el id del evento real).
 * - Autenticado con cuerpo inválido: 400.
 * - Sin credenciales o con la base/Redis caídos: 503, y Addi reintenta.
 * Las respuestas de error no tienen detalles; los logs solo el motivo, nunca el cuerpo ni la clave.
 */
import type { VerifiedEvent } from '@izao/core/contracts';
import { verificarCallbackAddi, type DatosJobAddi } from '@izao/addi';

export interface DepsWebhookAddi {
  /** Usuario y clave del callback de la credencial activa de Addi (CO); `null` si no hay o está incompleta. */
  credenciales(): Promise<{ usuario: string; clave: string } | null>;
  /** Inserta si no existe; devuelve si ese evento ya se procesó. */
  registrar(evento: VerifiedEvent): Promise<{ procesado: boolean }>;
  encolar(datos: DatosJobAddi): Promise<void>;
}

const MAX_BYTES = 16 * 1024;

function json(cuerpo: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });
}

/** 200 con el mismo texto recibido (ya validado como UTF-8 y como el objeto del callback). */
function eco(crudo: Uint8Array): Response {
  return new Response(new TextDecoder('utf-8').decode(crudo), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export async function manejarWebhookAddi(req: Request, deps: DepsWebhookAddi): Promise<Response> {
  const declarado = Number(req.headers.get('content-length') ?? '0');
  if (declarado > MAX_BYTES) return json({ error: 'PAYLOAD_TOO_LARGE' }, 413);
  const crudo = new Uint8Array(await req.arrayBuffer());
  if (crudo.byteLength > MAX_BYTES) return json({ error: 'PAYLOAD_TOO_LARGE' }, 413);

  const cabeceras: Record<string, string> = {};
  req.headers.forEach((v, k) => {
    cabeceras[k.toLowerCase()] = v;
  });

  try {
    const claves = await deps.credenciales();
    if (!claves) {
      console.error('[webhook addi] sin credenciales activas');
      return json({ error: 'UNAVAILABLE' }, 503);
    }
    const v = verificarCallbackAddi(crudo, cabeceras, claves);
    if (!v.ok) {
      console.warn(`[webhook addi] rechazado: ${v.motivo}`);
      return v.motivo === 'autenticacion'
        ? json({ error: 'UNAUTHORIZED' }, 401, { 'www-authenticate': 'Basic realm="izao-addi"' })
        : json({ error: 'INVALID_INPUT' }, 400);
    }

    const r = await deps.registrar(v.evento);
    if (!r.procesado) await deps.encolar({ event_id: v.evento.event_id, callback: v.callback });
    return eco(crudo);
  } catch (err) {
    console.error(`[webhook addi] falla interna: ${err instanceof Error ? err.name : 'error'}`);
    return json({ error: 'UNAVAILABLE' }, 503);
  }
}
