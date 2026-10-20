'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { TC } from '@/lib/store/textos-checkout';

const CADA_MS = 15_000;
const MAXIMO_INTENTOS = 40; // ~10 minutos; después basta con recargar.

/** Vuelve a pedir la página mientras el pedido espera un pago, para que el estado se actualice solo. */
export function RefrescarEstado({ activo }: { activo: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!activo) return;
    let n = 0;
    const id = window.setInterval(() => {
      n += 1;
      if (document.visibilityState === 'visible') router.refresh();
      if (n >= MAXIMO_INTENTOS) window.clearInterval(id);
    }, CADA_MS);
    return () => window.clearInterval(id);
  }, [activo, router]);
  return activo ? (
    <p role="status" className="solo-lectores">
      {TC.pedido.actualizando}
    </p>
  ) : null;
}
