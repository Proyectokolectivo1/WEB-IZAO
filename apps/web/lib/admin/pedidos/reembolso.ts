/**
 * Reembolso manual de un pedido cancelado sin despachar (D-061). Izao no reembolsa por API: la cancelación desde
 * `error_transportadora` deja la alerta `reembolso_manual_pendiente` (la escribe `cancelar_pedido` en la misma
 * transacción) y el panel dice cuánto y con qué referencia devolver en el proveedor. Funciones puras (sin I/O).
 */
import { formatMoney, money, type CurrencyCode } from '@izao/core/money';

export const MOTIVO_ALERTA_REEMBOLSO = 'reembolso_manual_pendiente';

export type PagoParaReembolso = {
  provider: string;
  amount: number;
  status: string;
  provider_reference: string | null;
};

const NOMBRE_PROVEEDOR: Record<string, string> = { wompi: 'Wompi', addi: 'Addi', sistecredito: 'Sistecrédito' };

export const ADVERTENCIA_CANCELAR =
  'El pedido pasa a Cancelado y se libera el stock reservado. Si el envío está creado en MasterShop, también se cancela allá. No se puede deshacer.';

export function pagosPorReembolsar<T extends PagoParaReembolso>(pagos: readonly T[]): T[] {
  return pagos.filter((p) => p.status === 'approved');
}

function monto(amount: number, moneda: string): string {
  if (!Number.isSafeInteger(amount)) return '—';
  return formatMoney(money(BigInt(amount), moneda as CurrencyCode));
}

/**
 * Texto del reembolso pendiente: proveedor, monto y referencia de cada pago aprobado. Sin pagos aprobados pero con
 * el pedido pagado a mano, el reembolso va por el medio en que se recibió. Sin dinero cobrado, `null`.
 */
export function textoReembolso(aprobados: readonly PagoParaReembolso[], moneda: string, pagadoAMano: boolean): string | null {
  if (aprobados.length === 0) {
    return pagadoAMano ? 'Requiere reembolso manual por el medio en que se recibió el pago (pago marcado a mano).' : null;
  }
  const partes = aprobados.map((p) => {
    const ref = p.provider_reference ? `referencia ${p.provider_reference}` : 'sin referencia';
    return `en ${NOMBRE_PROVEEDOR[p.provider] ?? p.provider}: ${monto(p.amount, moneda)} (${ref})`;
  });
  return `Requiere reembolso manual ${partes.join('; ')}.`;
}

/** Advertencia del diálogo «Cancelar pedido» según el estado (la regla real la aplica el servidor). */
export function advertenciaCancelar(
  pedido: { status: string; currency_code: string; paid_at: string | null },
  pagos: readonly PagoParaReembolso[],
): string {
  if (pedido.status !== 'error_transportadora') return ADVERTENCIA_CANCELAR;
  const reembolso = textoReembolso(pagosPorReembolsar(pagos), pedido.currency_code, pedido.paid_at !== null);
  return [
    'MasterShop nunca aceptó este pedido: pasa a Cancelado, el stock vuelve al inventario y ya no se podrá reenviar a la transportadora.',
    reembolso ? `${reembolso} Izao no hace el reembolso: hazlo en el proveedor y deja una nota con el comprobante.` : null,
    'No se puede deshacer.',
  ]
    .filter(Boolean)
    .join(' ');
}

/** `true` si la línea de tiempo tiene la alerta de reembolso manual pendiente. */
export function haySolicitudReembolso(eventos: readonly { type: string; motivo_alerta: string | null }[]): boolean {
  return eventos.some((e) => e.type === 'alerta' && e.motivo_alerta === MOTIVO_ALERTA_REEMBOLSO);
}
