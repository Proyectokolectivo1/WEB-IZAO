'use client';

import { useEffect, useRef } from 'react';
import { idContenido, monedaDePais, parametrosContenido } from '@izao/meta-pixel';
import { eventoInicioCheckout, rastrear, rastrearCompraUnaVez, type DatosCompra } from '@/lib/store/analitica/pixel-cliente';
import type { CodigoPais } from '@/lib/store/types';
import { useCarritoLineas } from '../carrito/CarritoProvider';
import { useConsentimiento } from '../cookies/useConsentimiento';

/**
 * Los tres eventos de página dependen del consentimiento de marketing: sin él `rastrear` no hace nada (no existe `fbq`) y,
 * si la persona acepta con la página ya abierta, el efecto vuelve a correr y envía el evento que corresponde a esta vista.
 */

/** `ViewContent` de la ficha: el SKU y el precio de la variante inicial. Una vez por visita a la ficha. */
export function EventoVistaProducto({
  pais,
  sku,
  varianteId,
  precio,
  nombre,
}: {
  pais: CodigoPais;
  sku: string | null;
  varianteId: string;
  /** Unidad menor, entero en texto. */
  precio: string;
  nombre: string;
}) {
  const { marketing } = useConsentimiento();
  useEffect(() => {
    if (!marketing) return;
    const parametros = parametrosContenido([{ id: idContenido(sku, varianteId), cantidad: 1, precioUnitario: BigInt(precio) }], monedaDePais(pais));
    rastrear('ViewContent', { ...parametros, content_name: nombre });
  }, [marketing, pais, sku, varianteId, precio, nombre]);
  return null;
}

/** `InitiateCheckout` al abrir el checkout con el bolso ya leído y con productos (una vez por visita). */
export function EventoInicioCheckout({ pais }: { pais: CodigoPais }) {
  const { listo, lineas } = useCarritoLineas();
  const { marketing } = useConsentimiento();
  const enviado = useRef(false);
  useEffect(() => {
    if (!marketing || !listo || lineas.length === 0 || enviado.current) return;
    enviado.current = true;
    rastrear('InitiateCheckout', eventoInicioCheckout(lineas, pais));
  }, [marketing, listo, lineas, pais]);
  return null;
}

/**
 * `Purchase` de la página del pedido, solo cuando el pedido ya está pagado (pago completo, financiación o abono: `paid_at`).
 * Si el pago aún está pendiente espera: la página se refresca sola (`RefrescarEstado`) y al llegar `pagado` se dispara.
 * Una vez por pedido (marca en el navegador) y con el mismo `eventID` que envía el servidor.
 */
export function EventoCompra({ pais, pagado, compra }: { pais: CodigoPais; pagado: boolean; compra: DatosCompra }) {
  const { marketing } = useConsentimiento();
  useEffect(() => {
    if (marketing && pagado) rastrearCompraUnaVez(compra, pais);
  }, [marketing, pagado, compra, pais]);
  return null;
}
