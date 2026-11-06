/**
 * Reglas puras del cobro del abono de contra entrega en el detalle del pedido (§13.3, §24.1):
 * cuándo se puede copiar el link, cuándo reenviar y cómo se arma la URL pública. Sin servidor ni navegador.
 */

/** Tiempo mínimo entre dos solicitudes de reenvío del mismo pedido. */
export const ESPERA_REENVIO_SEGUNDOS = 60;

export type PedidoCobro = {
  payment_method: string;
  status: string;
  stock_reserved_until: Date | null;
};
export type LinkCobro = { token: string; expires_at: Date };

export type EstadoCobro = {
  /** El pedido es contra entrega y sigue esperando el abono. */
  aplica: boolean;
  reservaVigente: boolean;
  linkVigente: boolean;
  /** Se puede copiar el link: hay uno vigente. */
  puedeCopiar: boolean;
  /** Se puede pedir el reenvío: aplica y la reserva sigue viva. */
  puedeReenviar: boolean;
  /** Explicación para la persona cuando algo no se puede. */
  motivo: string | null;
};

export function evaluarCobro(p: PedidoCobro, link: Pick<LinkCobro, 'expires_at'> | null, ahora: Date): EstadoCobro {
  const aplica = p.payment_method === 'cod' && p.status === 'esperando_abono';
  const reservaVigente = p.stock_reserved_until !== null && p.stock_reserved_until.getTime() > ahora.getTime();
  const linkVigente = link !== null && link.expires_at.getTime() > ahora.getTime();
  let motivo: string | null = null;
  if (p.payment_method !== 'cod') motivo = 'Este pedido no es contra entrega.';
  else if (p.status !== 'esperando_abono') motivo = 'El pedido ya no está esperando el abono.';
  else if (!reservaVigente) motivo = 'La reserva del pedido venció; ya no se puede cobrar el abono.';
  return {
    aplica,
    reservaVigente,
    linkVigente,
    puedeCopiar: aplica && reservaVigente && linkVigente,
    puedeReenviar: aplica && reservaVigente,
    motivo,
  };
}

/** URL pública del cobro: `/{pais}/pagar/{token}` (todo lo comercial es por país). El token solo se arma aquí. */
export function urlCobro(origen: string, pais: string, token: string): string {
  const segmento = pais.trim().toLowerCase();
  if (segmento !== 'co' && segmento !== 'ec') throw new RangeError('País de cobro inválido.');
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(token)) throw new RangeError('Token de cobro inválido.');
  return `${origen.replace(/\/+$/, '')}/${segmento}/pagar/${token}`;
}

export type ResultadoEncolado = 'encolado';

export const MENSAJE_ENCOLADO: Record<ResultadoEncolado, string> = {
  encolado: 'Listo: el cobro quedó en cola y se enviará en unos segundos.',
};
