import 'server-only';
/**
 * Acciones operativas sobre un pedido desde el panel (§24.1): cancelar, marcar pagado, nota interna, reintentar el
 * envío a MasterShop y reimprimir la etiqueta. Cada una valida la entrada, aplica las reglas de negocio, deja rastro
 * en `order_events` (cuando corresponde) y en `audit_log`. El permiso lo verifica la Server Action que las llama.
 *
 * Los cambios de estado pasan siempre por `transicionar` (reglas) + `aplicarEventoPedidoDb` (una transacción que
 * solo cambia el estado si sigue siendo el que se leyó). Las dependencias externas (MasterShop, Redis, stock) se
 * inyectan para poder probarlas.
 */
import { transicionar, type OrderStatus } from '@izao/core/order-state';
import { urlEtiquetaSegura, type ResultadoReintentoEnvio } from '@izao/mastershop';
import { z } from 'zod';
import { encolarRecalculoMetricas } from '@/app/api/checkout/cola-metricas';
import { auditarCambio } from '@/lib/admin/auditoria';
import { aplicarEventoPedidoDb, type ResultadoTransicion } from '@/lib/db/pedidos';
import { cancelarPedidoDb, type EntradaCancelar, type ResultadoCancelar } from '@/lib/db/panel-atomicas';
import type { Cliente } from '../catalogo/taxonomias-servidor';

type Ctx = {
  cliente: Cliente;
  actor: string;
  ip: string | null;
  ahora?: () => Date;
  /** Encola `metrics.recompute_day` del pedido (§21.4). Por defecto, el productor de la web. */
  recalcular?: (orderId: string) => Promise<void>;
};

/** Best effort: si Redis falla, el cambio del pedido ya está hecho y el nocturno `metrics.recompute_recent` lo corrige. */
async function recalcularMetricas(args: Pick<Ctx, 'recalcular'>, orderId: string): Promise<void> {
  try {
    await (args.recalcular ?? encolarRecalculoMetricas)(orderId);
  } catch (e) {
    console.error('[panel] no se pudo encolar el recálculo de métricas:', e instanceof Error ? e.name : 'error');
  }
}
export type ResultadoPedido = { ok: true; mensaje: string } | { ok: false; mensaje: string };
export type AplicarEvento = (
  orderId: string,
  evento: Parameters<typeof aplicarEventoPedidoDb>[1],
  fechas?: Parameters<typeof aplicarEventoPedidoDb>[2],
) => Promise<ResultadoTransicion>;

export const TIPO_EVENTO_NOTA = 'nota_interna';
export const TIPO_EVENTO_REINTENTO = 'reintento_envio_solicitado';

const motivoSchema = z.string().trim().min(3, 'Escribe el motivo (mínimo 3 caracteres).').max(300, 'El motivo es demasiado largo (máximo 300).');
const referenciaSchema = z.string().trim().min(3, 'Escribe la referencia del pago (mínimo 3 caracteres).').max(200, 'La referencia es demasiado larga (máximo 200).');
const notaSchema = z.string().trim().min(1, 'Escribe la nota.').max(1000, 'La nota es demasiado larga (máximo 1000).');

function primerError(r: { success: false; error: z.ZodError }): string {
  return r.error.issues[0]?.message ?? 'Datos no válidos.';
}

type PedidoBasico = { number: string; status: string; payment_method: string; country_code?: string | null };

async function leerPedido(cliente: Cliente, orderId: string): Promise<PedidoBasico | null> {
  const { data, error } = await cliente.from('orders').select('number, status, payment_method, country_code').eq('id', orderId).maybeSingle();
  if (error) throw new Error('No se pudo leer el pedido.');
  return (data as PedidoBasico | null) ?? null;
}

type EnvioBasico = {
  id: string;
  provider_order_id: number | null;
  provider_status_id: number | null;
  label_local_path: string | null;
  label_url: string | null;
};

async function leerEnvio(cliente: Cliente, orderId: string): Promise<EnvioBasico | null> {
  const { data, error } = await cliente
    .from('shipments')
    .select('id, provider_order_id, provider_status_id, label_local_path, label_url')
    .eq('order_id', orderId)
    .maybeSingle();
  if (error) throw new Error('No se pudo leer el envío.');
  return (data as EnvioBasico | null) ?? null;
}

function mensajeTransicion(r: Exclude<ResultadoTransicion, { ok: true }>): string {
  if (r.motivo === 'estado_cambiado') return 'El pedido cambió de estado mientras lo gestionabas. Recarga la página para ver el estado actual.';
  if (r.motivo === 'pedido_inexistente') return 'Ese pedido ya no existe.';
  return 'No se pudo cambiar el estado del pedido. Inténtalo de nuevo.';
}

// ---------------------------------------------------------------------------
// Cancelar
// ---------------------------------------------------------------------------

/** Estados de MasterShop en los que aún se puede cancelar desde nuestro lado: 1 (creada) y 2 (confirmada). */
const ESTADOS_CANCELABLES_REMOTOS: readonly number[] = [1, 2];
const ESTADO_REMOTO_CANCELADO = 9;

export type CancelarDb = (entrada: EntradaCancelar) => Promise<ResultadoCancelar>;

/**
 * Cancela un pedido. Si el envío está en MasterShop (estado 1 o 2) se cancela allá primero (es externo y no puede ir en la
 * transacción); luego `cancelar_pedido` hace en UNA transacción el cambio de estado, el evento y la liberación de la
 * reserva de stock, solo si el pedido sigue en el estado que se leyó.
 */
export async function cancelarPedidoBd(
  args: Ctx & {
    orderId: string;
    motivo: string;
    /** `pais` = país del pedido: cada país tiene su propia llave de MasterShop (D-052). */
    cancelarEnMasterShop: (providerOrderId: number, pais: 'CO' | 'EC') => Promise<void>;
    cancelar?: CancelarDb;
  },
): Promise<ResultadoPedido> {
  const { cliente, actor, ip, orderId } = args;
  const motivo = motivoSchema.safeParse(args.motivo);
  if (!motivo.success) return { ok: false, mensaje: primerError(motivo) };
  const ahora = (args.ahora ?? (() => new Date()))();
  const cancelar = args.cancelar ?? cancelarPedidoDb;

  const pedido = await leerPedido(cliente, orderId);
  if (!pedido) return { ok: false, mensaje: 'Ese pedido ya no existe.' };

  const t = transicionar({ from: pedido.status as OrderStatus, to: 'cancelado', actor: `admin:${actor}`, payload: { motivo: motivo.data } });
  if (!t.ok) return { ok: false, mensaje: `Este pedido no se puede cancelar desde el estado "${pedido.status}".` };

  const envio = await leerEnvio(cliente, orderId);
  let canceladoEnMasterShop = false;
  if (envio && envio.provider_order_id !== null && envio.provider_status_id !== ESTADO_REMOTO_CANCELADO) {
    if (envio.provider_status_id === null || !ESTADOS_CANCELABLES_REMOTOS.includes(envio.provider_status_id)) {
      return {
        ok: false,
        mensaje:
          'El envío ya avanzó en MasterShop y no se puede cancelar desde aquí. Cancélalo en MasterShop: el pedido se actualizará solo cuando ellos lo confirmen.',
      };
    }
    try {
      await args.cancelarEnMasterShop(envio.provider_order_id, pedido.country_code === 'EC' ? 'EC' : 'CO');
      canceladoEnMasterShop = true;
    } catch (e) {
      console.error('[panel] no se pudo cancelar en MasterShop:', e instanceof Error ? e.name : 'error');
      if (esEstadoNoEditable(e)) {
        // D-044: MasterShop confirma solo (estado 3) y por API solo se cancela en 1 y 2; nuestro estado local iba atrasado.
        return {
          ok: false,
          mensaje: `El pedido ya avanzó en MasterShop y no se puede cancelar desde aquí. Cancélalo directamente en MasterShop (pedido ${envio.provider_order_id}); Izao se actualizará cuando ellos lo confirmen. Este pedido no se cambió.`,
        };
      }
      return { ok: false, mensaje: 'MasterShop no aceptó la cancelación. No se cambió nada; inténtalo de nuevo o cancélalo allá.' };
    }
  }

  const r = await cancelar({
    order_id: orderId,
    from_status: pedido.status as OrderStatus,
    actor: `admin:${actor}`,
    motivo: motivo.data,
    cancelled_at: ahora.toISOString(),
  });
  if (!r.ok) {
    const extra = canceladoEnMasterShop ? ' La cancelación en MasterShop sí se hizo; el pedido se sincronizará.' : '';
    return { ok: false, mensaje: mensajeCancelacion(r.motivo) + extra };
  }

  await recalcularMetricas(args, orderId);
  await auditarCambio({
    actor,
    accion: 'pedido.cancelado',
    entidad: 'orders',
    entidadId: orderId,
    ip,
    diff: {
      numero: pedido.number,
      antes: { status: pedido.status },
      despues: { status: 'cancelado' },
      motivo: motivo.data,
      cancelado_en_mastershop: canceladoEnMasterShop,
      stock_estado: r.stock_estado,
      stock_liberado: r.stock_liberado,
      stock_devuelto: r.stock_devuelto,
      unidades_devueltas: r.unidades_devueltas,
      stock_retenido: r.stock_retenido,
    },
  });
  return { ok: true, mensaje: 'Pedido cancelado.' };
}

/** `MasterShopError` con `kind: 'estado_no_editable'` (409 del `PUT`: el pedido ya no está en 1 o 2). Sin importar la clase: sobrevive a límites de módulo. */
function esEstadoNoEditable(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { kind?: unknown }).kind === 'estado_no_editable';
}

function mensajeCancelacion(motivo: 'transicion_invalida' | 'estado_cambiado' | 'pedido_inexistente' | 'datos_invalidos'): string {
  if (motivo === 'estado_cambiado') return 'El pedido cambió de estado mientras lo gestionabas. Recarga la página para ver el estado actual.';
  if (motivo === 'pedido_inexistente') return 'Ese pedido ya no existe.';
  if (motivo === 'transicion_invalida') return 'Este pedido ya no se puede cancelar desde su estado actual.';
  return 'No se pudo cancelar el pedido. Inténtalo de nuevo.';
}

// ---------------------------------------------------------------------------
// Marcar pagado
// ---------------------------------------------------------------------------

export async function marcarPagadoBd(
  args: Ctx & {
    orderId: string;
    referencia: string;
    /** Descuenta definitivamente el stock reservado. `false` si no alcanza. */
    confirmarStock: (orderId: string) => Promise<boolean>;
    encolarEnvio: (orderId: string, estado: string) => Promise<ResultadoReintentoEnvio>;
    aplicar?: AplicarEvento;
  },
): Promise<ResultadoPedido> {
  const { cliente, actor, ip, orderId } = args;
  const referencia = referenciaSchema.safeParse(args.referencia);
  if (!referencia.success) return { ok: false, mensaje: primerError(referencia) };
  const ahora = (args.ahora ?? (() => new Date()))();
  const aplicar = args.aplicar ?? aplicarEventoPedidoDb;

  const pedido = await leerPedido(cliente, orderId);
  if (!pedido) return { ok: false, mensaje: 'Ese pedido ya no existe.' };
  // Regla del negocio (§24.1): solo se marca pagado a mano un pedido que espera confirmación manual.
  if (pedido.status !== 'pendiente_manual') {
    return { ok: false, mensaje: 'Solo se puede marcar como pagado un pedido en "Pendiente manual".' };
  }
  const t = transicionar({
    from: 'pendiente_manual',
    to: 'pagado',
    actor: `admin:${actor}`,
    payload: { motivo: 'pago_manual', referencia: referencia.data },
  });
  if (!t.ok) return { ok: false, mensaje: t.error.message };

  let hayStock: boolean;
  try {
    hayStock = await args.confirmarStock(orderId);
  } catch (e) {
    console.error('[panel] no se pudo confirmar el stock:', e instanceof Error ? e.name : 'error');
    return { ok: false, mensaje: 'No se pudo confirmar el stock del pedido. No se cambió nada; inténtalo de nuevo.' };
  }
  if (!hayStock) return { ok: false, mensaje: 'Ya no hay stock suficiente para este pedido. No se marcó como pagado.' };

  const r = await aplicar(orderId, t.event, { paid_at: ahora.toISOString() });
  if (!r.ok) return { ok: false, mensaje: mensajeTransicion(r) };
  await recalcularMetricas(args, orderId);

  let envio: 'encolado' | 'ya_pendiente' | 'fallo';
  try {
    const e = await args.encolarEnvio(orderId, 'pagado');
    envio = e === 'estado_invalido' ? 'fallo' : e;
  } catch (e) {
    console.error('[panel] no se pudo encolar el envío tras el pago manual:', e instanceof Error ? e.name : 'error');
    envio = 'fallo';
  }
  await auditarCambio({
    actor,
    accion: 'pedido.marcado_pagado',
    entidad: 'orders',
    entidadId: orderId,
    ip,
    diff: { numero: pedido.number, antes: { status: 'pendiente_manual' }, despues: { status: 'pagado' }, referencia: referencia.data, envio },
  });
  return {
    ok: true,
    mensaje:
      envio === 'fallo'
        ? 'Pedido marcado como pagado, pero no se pudo poner en cola el envío a MasterShop. Usa "Reintentar envío".'
        : 'Pedido marcado como pagado. El envío a MasterShop quedó en cola.',
  };
}

// ---------------------------------------------------------------------------
// Nota interna
// ---------------------------------------------------------------------------

export async function agregarNotaBd(args: Ctx & { orderId: string; texto: string }): Promise<ResultadoPedido> {
  const { cliente, actor, ip, orderId } = args;
  const texto = notaSchema.safeParse(args.texto);
  if (!texto.success) return { ok: false, mensaje: primerError(texto) };
  const { data, error } = await cliente.from('orders').select('number').eq('id', orderId).maybeSingle();
  if (error) throw new Error('No se pudo leer el pedido.');
  if (!data) return { ok: false, mensaje: 'Ese pedido ya no existe.' };

  const { error: e2 } = await cliente
    .from('order_events')
    .insert({ order_id: orderId, type: TIPO_EVENTO_NOTA, payload: { texto: texto.data }, actor: `admin:${actor}` });
  if (e2) {
    console.error('[panel] no se pudo guardar la nota:', e2.code ?? 'error');
    return { ok: false, mensaje: 'No se pudo guardar la nota. Inténtalo de nuevo.' };
  }
  await auditarCambio({
    actor,
    accion: 'pedido.nota_agregada',
    entidad: 'orders',
    entidadId: orderId,
    ip,
    diff: { numero: (data as { number: string }).number, largo: texto.data.length },
  });
  return { ok: true, mensaje: 'Nota guardada.' };
}

// ---------------------------------------------------------------------------
// Reintentar envío a MasterShop
// ---------------------------------------------------------------------------

export const MENSAJE_REINTENTO: Record<ResultadoReintentoEnvio, string> = {
  encolado: 'Reintento en cola. En unos segundos el pedido pasará a "Enviado a transportadora" o mostrará el error.',
  ya_pendiente: 'Ya hay un reintento en curso para este pedido. Espera unos segundos.',
  estado_invalido: 'Solo se puede reintentar el envío de pedidos pagados, con abono pagado o con error de transportadora.',
};

export async function reintentarEnvioBd(
  args: Ctx & { orderId: string; reintentar: (orderId: string, estado: string) => Promise<ResultadoReintentoEnvio> },
): Promise<ResultadoPedido> {
  const { cliente, actor, ip, orderId } = args;
  const pedido = await leerPedido(cliente, orderId);
  if (!pedido) return { ok: false, mensaje: 'Ese pedido ya no existe.' };

  let resultado: ResultadoReintentoEnvio;
  try {
    resultado = await args.reintentar(orderId, pedido.status);
  } catch (e) {
    console.error('[panel] no se pudo encolar el reintento de envío:', e instanceof Error ? e.name : 'error');
    return { ok: false, mensaje: 'No se pudo poner el reintento en cola. Inténtalo de nuevo en un momento.' };
  }
  if (resultado === 'encolado') {
    const { error } = await cliente
      .from('order_events')
      .insert({ order_id: orderId, type: TIPO_EVENTO_REINTENTO, payload: { desde: pedido.status }, actor: `admin:${actor}` });
    if (error) console.error('[panel] no se pudo registrar el evento de reintento:', error.code ?? 'error');
    await auditarCambio({ actor, accion: 'pedido.envio_reintentado', entidad: 'orders', entidadId: orderId, ip, diff: { numero: pedido.number, desde: pedido.status } });
  }
  return { ok: resultado !== 'estado_invalido', mensaje: MENSAJE_REINTENTO[resultado] };
}

// ---------------------------------------------------------------------------
// Reimprimir etiqueta
// ---------------------------------------------------------------------------

/**
 * Crea un trabajo de impresión de la etiqueta con `requested_by = admin:<id>`. Nunca `auto`: el índice único de
 * etiquetas automáticas solo cubre `auto`, y el agente trata distinto la reimpresión manual (se imprime aunque ya
 * haya salido una vez).
 */
export async function reimprimirEtiquetaBd(args: Ctx & { orderId: string }): Promise<ResultadoPedido> {
  const { cliente, actor, ip, orderId } = args;
  const pedido = await leerPedido(cliente, orderId);
  if (!pedido) return { ok: false, mensaje: 'Ese pedido ya no existe.' };
  const envio = await leerEnvio(cliente, orderId);
  if (!envio) return { ok: false, mensaje: 'Este pedido aún no tiene envío en MasterShop.' };
  // D-051: sin copia local sirve la URL de MasterShop (el agente la descarga desde su PC); debe pasar la lista de hosts.
  if (!envio.label_local_path && !urlEtiquetaSegura(envio.label_url)) {
    return { ok: false, mensaje: 'La etiqueta todavía no está disponible. Espera a que MasterShop la genere.' };
  }

  const { data: enCola, error: e1 } = await cliente
    .from('print_jobs')
    .select('id')
    .eq('shipment_id', envio.id)
    .eq('type', 'label')
    .in('status', ['queued', 'claimed'])
    .limit(1);
  if (e1) return { ok: false, mensaje: 'No se pudo verificar la cola de impresión. Inténtalo de nuevo.' };
  if (Array.isArray(enCola) && enCola.length > 0) {
    return { ok: false, mensaje: 'Ya hay una impresión de esta etiqueta en cola. Espera a que el agente la procese.' };
  }

  const { error } = await cliente
    .from('print_jobs')
    .insert({ order_id: orderId, shipment_id: envio.id, type: 'label', status: 'queued', requested_by: `admin:${actor}` });
  if (error) {
    console.error('[panel] no se pudo crear el trabajo de impresión:', error.code ?? 'error');
    return { ok: false, mensaje: 'No se pudo poner la etiqueta en la cola de impresión. Inténtalo de nuevo.' };
  }
  await auditarCambio({ actor, accion: 'pedido.etiqueta_reimpresa', entidad: 'orders', entidadId: orderId, ip, diff: { numero: pedido.number, shipment_id: envio.id } });
  return { ok: true, mensaje: 'Etiqueta en la cola de impresión. El agente la imprimirá en unos segundos.' };
}
