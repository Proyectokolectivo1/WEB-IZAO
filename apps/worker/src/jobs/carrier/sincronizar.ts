/**
 * Job `carrier.sync` (§14.5 paso 4): lo encola el webhook de MasterShop (y el polling de respaldo). Nunca se
 * confía en el cuerpo de la notificación: se reconsulta `GET /api/orders`, se guarda en `shipments` (estado,
 * guía, novedad, tarifas) y se aplica `planInternalTransition` paso a paso con `transicionar` +
 * `aplicar_transicion_pedido`. Un estado atrasado, sin camino o desconocido no mueve el pedido: alerta.
 * Si la etiqueta ya está disponible y no se guardó, la guarda y crea el `print_job`.
 *
 * Idempotente: repetir la misma notificación deja todo igual (la transición ya aplicada es `sin_cambio`).
 * Un error reintentable se relanza para que BullMQ reintente; el resto se marca en `webhook_events`.
 */
import { planInternalTransition, type DatosJobSync } from '@izao/mastershop';
import {
  ACTOR_SISTEMA,
  ACTOR_WEBHOOK,
  errorParaEvento,
  esReintentable,
  guardarEtiqueta,
  guardarRemoto,
  mover,
  type DepsCarrier,
} from './comun.js';

export type AccionSync =
  | 'sin_cambio'
  | 'transicionado'
  | 'alerta'
  | 'pedido_desconocido'
  | 'referencia_no_coincide'
  | 'movido_por_otro'
  | 'sin_credenciales'
  | 'error';

export interface ResultadoSync {
  accion: AccionSync;
  order_id: string | null;
  pasos?: string[];
}

async function marcar(deps: DepsCarrier, datos: DatosJobSync, r: ResultadoSync): Promise<ResultadoSync> {
  if (datos.event_id) {
    const fallo = r.accion === 'error' || r.accion === 'sin_credenciales';
    await deps.fuente.marcarWebhook(datos.event_id, fallo ? { ok: false, error: r.accion } : { ok: true });
  }
  return r;
}

export async function procesarSync(datos: DatosJobSync, deps: DepsCarrier): Promise<ResultadoSync> {
  const actor = datos.origen === 'webhook' ? ACTOR_WEBHOOK : ACTOR_SISTEMA;
  let orderId: string | null = null;
  if (datos.provider_order_id !== null) orderId = await deps.fuente.pedidoPorIdProveedor(datos.provider_order_id);
  if (orderId === null && datos.external_order_id !== null) orderId = await deps.fuente.pedidoPorNumero(datos.external_order_id);
  const pedido = orderId === null ? null : await deps.fuente.pedido(orderId);
  if (!pedido) return marcar(deps, datos, { accion: 'pedido_desconocido', order_id: null });

  const creds = await deps.fuente.credenciales();
  if (!creds) return marcar(deps, datos, { accion: 'sin_credenciales', order_id: pedido.id });

  const envio = await deps.fuente.envio(pedido.id);
  const providerOrderId = envio?.provider_order_id ?? datos.provider_order_id;
  let remoto;
  try {
    remoto = await deps
      .transportadora(creds)
      .getOrder(providerOrderId !== null ? { providerOrderId } : { externalOrderId: pedido.number });
  } catch (e) {
    if (esReintentable(e)) throw e;
    await deps.fuente.registrarEvento(pedido.id, 'alerta', actor, { motivo: 'sincronizacion_error', error: errorParaEvento(e) });
    return marcar(deps, datos, { accion: 'error', order_id: pedido.id });
  }

  if (remoto.externalOrderId !== '' && remoto.externalOrderId !== pedido.number) {
    await deps.fuente.registrarEvento(pedido.id, 'alerta', actor, {
      motivo: 'referencia_no_coincide',
      provider_order_id: remoto.providerOrderId,
      external_order_id: remoto.externalOrderId,
    });
    return marcar(deps, datos, { accion: 'referencia_no_coincide', order_id: pedido.id });
  }

  const actualizado = await guardarRemoto(deps, pedido.id, pedido.number, envio, remoto, datos.origen);
  const plan = planInternalTransition(pedido.status, remoto.statusId);
  let resultado: ResultadoSync = { accion: 'sin_cambio', order_id: pedido.id };

  if (plan.kind === 'transicion') {
    let desde = pedido.status;
    const pasos: string[] = [];
    for (const hacia of plan.path) {
      const m = await mover(deps, pedido.id, desde, hacia, actor, {
        provider_order_id: remoto.providerOrderId,
        id_status: remoto.statusId,
      });
      if (m !== 'aplicada') {
        resultado = { accion: 'movido_por_otro', order_id: pedido.id, pasos };
        break;
      }
      pasos.push(hacia);
      desde = hacia;
    }
    if (resultado.accion !== 'movido_por_otro') resultado = { accion: 'transicionado', order_id: pedido.id, pasos };
  } else if (plan.kind !== 'sin_cambio') {
    await deps.fuente.registrarEvento(pedido.id, 'alerta', actor, { motivo: 'sincronizacion', ...plan.alerta });
    resultado = { accion: 'alerta', order_id: pedido.id };
  }

  if (actualizado.label_url && !actualizado.label_local_path && remoto.statusId !== 9) {
    try {
      await guardarEtiqueta(deps, pedido.id, pedido.number, actualizado, actor);
    } catch (e) {
      // La etiqueta la vuelve a intentar `carrier.poll_label`; la sincronización no falla por esto.
      await deps.fuente.registrarEvento(pedido.id, 'alerta', actor, { motivo: 'etiqueta_error', error: errorParaEvento(e) });
    }
  }
  return marcar(deps, datos, resultado);
}
