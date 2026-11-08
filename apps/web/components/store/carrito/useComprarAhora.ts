'use client';

import { useRouter } from 'next/navigation';
import { useCallback } from 'react';
import { rutaCheckout } from '@/lib/store/carrito/logica';
import { useCarritoAcciones } from './CarritoProvider';

type Linea = Parameters<ReturnType<typeof useCarritoAcciones>['agregar']>[0];

/**
 * «Comprar ahora»: suma la línea al bolso (misma acción que «Agregar al bolso», sin abrir el drawer) y lleva
 * directo al checkout. No calcula nada: el servidor recalcula precios, stock y descuentos al crear el pedido.
 */
export function useComprarAhora(): (linea: Linea) => void {
  const { agregar, pais } = useCarritoAcciones();
  const router = useRouter();
  return useCallback(
    (linea: Linea) => {
      agregar(linea);
      router.push(rutaCheckout(pais));
    },
    [agregar, pais, router],
  );
}
