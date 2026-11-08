/**
 * Job `carrier.create` (cola `carrier`, §14.5 pasos 1–2). Lo encola `encolarTransportadora` cuando el pago
 * o el abono quedan aprobados, y el botón "Reintentar" del panel sobre `error_transportadora`.
 *
 * 1. Solo actúa sobre `pagado`, `abono_pagado` o `error_transportadora`; sobre `enviado_transportadora`
 *    retoma lo que faltó (confirmar o esperar la etiqueta). Cualquier otro estado: no hace nada.
 * 2. Si `shipments` ya tiene `provider_order_id`, no vuelve a crear (un reintento tras una caída).
 *    Si no, arma el pedido con `buildCarrierOrder` (líneas con `buildCarrierLines`, modo A/B del país) y
 *    lo crea; el `500` "409 - La orden ya existe" lo resuelve el cliente consultando por `externalOrderId`.
 * 3. Guarda el envío y pasa a `enviado_transportadora` con `transicionar` + `aplicar_transicion_pedido`.
 * 4. Con "Confirmar automáticamente" activo: `PUT {idStatus: 2}` (el `409` concurrente lo reintenta el
 *    cliente a los 5 s; el `502` se consulta, nunca se reintenta a ciegas). Luego programa `carrier.poll_label`.
 *
 * Métricas (§21.4): `enviado_transportadora` y `error_transportadora` pasan por la fuente envuelta con
 * `conRecalculoMetricas` (`dependenciasCarrierDesdeEnv`), que encola `metrics.recompute_day` de los días del pedido.
 *
 * Reintentos propios (no los de BullMQ) con las esperas de §14.5: cada reintento es un job nuevo con id fijo
 * `carrier.create.{id}.r{n}`. Al agotarlos, o ante un error que no se arregla reintentando (validación, llave),
 * el pedido pasa a `error_transportadora` con una alerta que lleva el error completo de MasterShop.
 */
import type { CarrierProvider } from '@izao/core/contracts';
import type { OrderStatus } from '@izao/core/order-state';
import {
  CARRIER_CREATE_RETRY_DELAYS_MS,
  LABEL_POLL_INTERVAL_MS,
  isMasterShopError,
  type DatosJobCrear,
} from '@izao/mastershop';
import type { Order } from '@izao/core/contracts';
import {
  ACTOR_SISTEMA,
  errorParaEvento,
  esReintentable,
  mover,
  type DepsCarrier,
} from './comun.js';
import type { AjustesTransportadora, EnvioFila } from './fuente.js';

export type AccionCrear =
  | 'creado'
  | 'confirmado'
  | 'sin_confirmar'
  | 'ya_enviado'
  | 'reintento_programado'
  | 'error_transportadora'
  | 'pedido_no_encontrado'
  | 'fuera_de_fase'
  | 'sin_transportadora'
  | 'movido_por_otro';

export interface ResultadoCrear {
  accion: AccionCrear;
  order_id: string;
  provider_order_id?: number;
}

const LISTOS: ReadonlySet<OrderStatus> = new Set<OrderStatus>(['pagado', 'abono_pagado', 'error_transportadora']);

class FalloDefinitivo extends Error {
  constructor(
    readonly motivo: string,
    readonly causa: unknown = null,
  ) {
    super(motivo);
  }
}

/** Reintento propio con la espera de §14.5 (o la del `429`, si es mayor); al agotarlos, fallo definitivo. */
async function reintentarOFallar(deps: DepsCarrier, pedido: Order, datos: DatosJobCrear, e: unknown, etapa: string) {
  const espera = CARRIER_CREATE_RETRY_DELAYS_MS[datos.intento];
  if (espera === undefined || !esReintentable(e)) {
    throw new FalloDefinitivo(espera === undefined ? `${etapa}_reintentos_agotados` : `${etapa}_rechazado`, e);
  }
  const sugerida = isMasterShopError(e) ? (e.retryAfterMs ?? 0) : 0;
  await deps.programar.crear(pedido.id, datos.intento + 1, Math.max(espera, sugerida));
  await deps.fuente.registrarEvento(pedido.id, 'transportadora', ACTOR_SISTEMA, {
    accion: 'reintento_programado',
    etapa,
    intento: datos.intento + 1,
    espera_ms: Math.max(espera, sugerida),
    error: errorParaEvento(e),
  });
}

async function marcarError(deps: DepsCarrier, pedido: Order, f: FalloDefinitivo): Promise<AccionCrear> {
  await deps.fuente.registrarEvento(pedido.id, 'alerta', ACTOR_SISTEMA, {
    motivo: 'error_transportadora',
    detalle: f.motivo,
    error: errorParaEvento(f.causa),
    accion_sugerida: 'reintentar',
  });
  if (pedido.status === 'error_transportadora' || pedido.status === 'enviado_transportadora') return 'error_transportadora';
  const r = await mover(deps, pedido.id, pedido.status, 'error_transportadora', ACTOR_SISTEMA, { motivo: f.motivo });
  return r === 'movido_por_otro' ? 'movido_por_otro' : 'error_transportadora';
}

async function confirmarYProgramar(
  deps: DepsCarrier,
  carrier: CarrierProvider,
  pedido: Order,
  datos: DatosJobCrear,
  ajustes: AjustesTransportadora,
  providerOrderId: number,
  statusId: number,
): Promise<AccionCrear> {
  if (statusId === 1) {
    if (!ajustes.autoConfirmar) return 'sin_confirmar';
    try {
      await carrier.confirmOrder(providerOrderId);
    } catch (e) {
      await reintentarOFallar(deps, pedido, datos, e, 'confirmar');
      return 'reintento_programado';
    }
    await deps.fuente.guardarEnvio(pedido.id, {
      external_order_id: pedido.number,
      provider_status_id: 2,
      historial: { id_status: 2, at: ((deps.ahora ?? (() => new Date()))()).toISOString(), origen: 'confirmacion' },
    });
    await deps.fuente.registrarEvento(pedido.id, 'transportadora', ACTOR_SISTEMA, {
      accion: 'confirmado',
      provider_order_id: providerOrderId,
    });
  }
  if (statusId === 9) return 'ya_enviado';
  await deps.programar.etiqueta(pedido.id, 0, LABEL_POLL_INTERVAL_MS);
  return statusId === 1 ? 'confirmado' : 'ya_enviado';
}

export async function procesarCrear(datos: DatosJobCrear, deps: DepsCarrier): Promise<ResultadoCrear> {
  const pedido = await deps.fuente.pedido(datos.order_id);
  if (!pedido) return { accion: 'pedido_no_encontrado', order_id: datos.order_id };
  const reanudar = pedido.status === 'enviado_transportadora';
  if (!LISTOS.has(pedido.status) && !reanudar) return { accion: 'fuera_de_fase', order_id: pedido.id };

  const ajustes = await deps.fuente.ajustes(pedido.country_code);
  if (!ajustes || ajustes.proveedor !== 'mastershop') {
    await deps.fuente.registrarEvento(pedido.id, 'alerta', ACTOR_SISTEMA, {
      motivo: 'pais_sin_transportadora',
      pais: pedido.country_code,
    });
    return { accion: 'sin_transportadora', order_id: pedido.id };
  }

  let actual: OrderStatus = pedido.status;
  try {
    const creds = await deps.fuente.credenciales(pedido.country_code);
    if (!creds) throw new FalloDefinitivo('sin_credenciales');
    const pago = await deps.fuente.pagoAprobado(pedido.id);
    const carrier = deps.transportadora(
      creds,
      {
        mode: ajustes.modo,
        paymentGateway: pago?.provider ?? pedido.payment_method,
        paymentReference: pago?.referencia ?? null,
      },
      pedido.country_code,
    );

    const envio: EnvioFila | null = await deps.fuente.envio(pedido.id);
    let providerOrderId = envio?.provider_order_id ?? null;
    let statusId = envio?.provider_status_id ?? 1;
    let creado = false;

    if (reanudar && providerOrderId === null) {
      // Estado sin envío registrado: no se crea a ciegas (lo resuelve la sincronización o el admin).
      await deps.fuente.registrarEvento(pedido.id, 'alerta', ACTOR_SISTEMA, { motivo: 'enviado_sin_envio' });
      return { accion: 'ya_enviado', order_id: pedido.id };
    }

    if (providerOrderId === null) {
      try {
        const r = await carrier.createOrder(pedido);
        providerOrderId = r.providerOrderId;
        statusId = r.statusId;
      } catch (e) {
        await reintentarOFallar(deps, pedido, datos, e, 'crear');
        return { accion: 'reintento_programado', order_id: pedido.id };
      }
      creado = true;
      await deps.fuente.guardarEnvio(pedido.id, {
        external_order_id: pedido.number,
        provider_order_id: providerOrderId,
        provider_status_id: statusId,
        historial: { id_status: statusId, at: ((deps.ahora ?? (() => new Date()))()).toISOString(), origen: 'creacion' },
      });
      await deps.fuente.registrarEvento(pedido.id, 'transportadora', ACTOR_SISTEMA, {
        accion: 'creado',
        provider_order_id: providerOrderId,
        id_status: statusId,
        intento: datos.intento,
      });
    }

    if (!reanudar) {
      const m = await mover(deps, pedido.id, pedido.status, 'enviado_transportadora', ACTOR_SISTEMA, {
        provider_order_id: providerOrderId,
      });
      if (m !== 'aplicada') {
        // El pedido ya existe en MasterShop pero otro proceso movió el pedido (p. ej. el admin lo canceló).
        await deps.fuente.registrarEvento(pedido.id, 'alerta', ACTOR_SISTEMA, {
          motivo: 'pedido_movido_tras_crear',
          provider_order_id: providerOrderId,
        });
        return { accion: 'movido_por_otro', order_id: pedido.id, provider_order_id: providerOrderId };
      }
      actual = 'enviado_transportadora';
    }

    const accion = await confirmarYProgramar(
      deps,
      carrier,
      { ...pedido, status: actual },
      datos,
      ajustes,
      providerOrderId,
      statusId,
    );
    const final: AccionCrear = creado && accion !== 'reintento_programado' && accion !== 'confirmado' ? 'creado' : accion;
    return { accion: final, order_id: pedido.id, provider_order_id: providerOrderId };
  } catch (e) {
    if (!(e instanceof FalloDefinitivo)) throw e;
    return { accion: await marcarError(deps, { ...pedido, status: actual }, e), order_id: pedido.id };
  }
}
