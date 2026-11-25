'use client';

import { Suspense, useEffect, useLayoutEffect } from 'react';
import { cargarFbevents, sincronizarPixel, type VentanaFb } from '@/lib/store/analitica/guion-pixel';
import { useConsentimiento } from '../cookies/useConsentimiento';
import { NavegacionPixel } from './NavegacionPixel';

/** Baja `fbevents.js` cuando la página ya cargó (o enseguida si ya lo hizo): no compite con el LCP. */
function cargarCuandoSePueda(): () => void {
  const cargar = () => void cargarFbevents(window as unknown as VentanaFb, document);
  if (document.readyState === 'complete') {
    const t = window.setTimeout(cargar, 0);
    return () => window.clearTimeout(t);
  }
  const alCargar = () => window.setTimeout(cargar, 0);
  window.addEventListener('load', alCargar, { once: true });
  return () => window.removeEventListener('load', alCargar);
}

/**
 * Compuerta del Meta Pixel (§23.2): opt-in estricto. Sin consentimiento de marketing no se define `fbq`, no se descarga
 * `fbevents.js` y no se dispara nada. Al aceptar (en esta página, sin recargar) inicia el Pixel del país, envía el `PageView`
 * de la página actual y baja el script; el arranque va en `useLayoutEffect` para que `ViewContent`, `InitiateCheckout` y
 * `Purchase` (efectos normales, que dependen de la misma decisión) encuentren el Pixel listo. Al retirarlo, deja de aceptar
 * eventos y le avisa a Meta (`consent revoke`); el cambio completo aplica al recargar.
 */
export function ControlPixel({ pixelId }: { pixelId: string }) {
  const { marketing } = useConsentimiento();

  useLayoutEffect(() => {
    sincronizarPixel(marketing, pixelId, window as unknown as VentanaFb);
  }, [marketing, pixelId]);

  useEffect(() => (marketing ? cargarCuandoSePueda() : undefined), [marketing]);

  if (!marketing) return null;
  return (
    <Suspense fallback={null}>
      <NavegacionPixel pixelId={pixelId} />
    </Suspense>
  );
}
