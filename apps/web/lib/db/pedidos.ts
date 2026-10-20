/**
 * Envoltorio de `aplicar_transicion_pedido(p jsonb)` (`20261020214637_pagos_referencia_unica_y_transicion_atomica.sql`).
 *
 * SOLO SERVIDOR. En una transacción: `orders.status` pasa de `from_status` a `to_status` solo si sigue en `from_status`
 * (y fija las fechas pedidas) y se registra el evento `status_changed`. Si algo falla, no queda nada escrito.
 * La legalidad de la transición la decide `transicionar` de `@izao/core/order-state` antes de llamar.
 * Contrato en `docs/estado/izao-db.md`.
 */
import 'server-only';
import { z } from 'zod';
import { ORDER_STATUSES, type OrderStatusEvent } from '@izao/core/order-state';
import { llamarRpc } from './cliente';

const estado = z.enum(ORDER_STATUSES);
const fecha = z.union([z.date().transform((d) => d.toISOString()), z.string().datetime({ offset: true })]);

export const entradaTransicionSchema = z.object({
  order_id: z.guid(),
  from_status: estado,
  to_status: estado,
  /** `system`, `agent`, `admin:<id>` o `webhook:<proveedor>` (CHECK de `order_events.actor`). */
  actor: z.string().regex(/^(system|agent|admin:.+|webhook:.+)$/),
  payload: z.record(z.string(), z.unknown()).optional(),
  fechas: z
    .object({
      paid_at: fecha,
      abandoned_at: fecha,
      sent_to_carrier_at: fecha,
      delivered_at: fecha,
      cancelled_at: fecha,
    })
    .partial()
    .strict()
    .optional(),
});
export type EntradaTransicion = z.input<typeof entradaTransicionSchema>;

const resultadoSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), order_id: z.guid(), from_status: estado, to_status: estado, event_id: z.guid() }),
  z.object({
    ok: z.literal(false),
    /** `estado_cambiado` (+ `status_actual`): otro proceso ya lo movió. `pedido_inexistente`. `datos_invalidos` (+ `detalle`). */
    motivo: z.enum(['estado_cambiado', 'pedido_inexistente', 'datos_invalidos']),
    status_actual: estado.optional(),
    detalle: z.string().optional(),
  }),
]);
export type ResultadoTransicion = z.infer<typeof resultadoSchema>;

/** Aplica una transición ya validada. Lanza `ZodError` si la entrada es inválida y `ErrorDb` si la base falla. */
export async function aplicarTransicionPedidoDb(entrada: EntradaTransicion): Promise<ResultadoTransicion> {
  const p = entradaTransicionSchema.parse(entrada);
  return llamarRpc('aplicar_transicion_pedido', { p }, resultadoSchema);
}

/** Atajo para el evento que devuelve `transicionar`. */
export function aplicarEventoPedidoDb(
  orderId: string,
  evento: OrderStatusEvent,
  fechas?: EntradaTransicion['fechas'],
): Promise<ResultadoTransicion> {
  return aplicarTransicionPedidoDb({
    order_id: orderId,
    from_status: evento.from_status,
    to_status: evento.to_status,
    actor: evento.actor,
    payload: { ...evento.payload },
    fechas,
  });
}
