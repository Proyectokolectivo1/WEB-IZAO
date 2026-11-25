'use client';

import { useMemo, useSyncExternalStore } from 'react';
import { instantaneaConsentimiento, interpretar, suscribirConsentimiento } from '@/lib/store/consentimiento';

export interface EstadoConsentimiento {
  /** `false` en el servidor y en la primera pintura del navegador: aún no se sabe qué decidió la persona. */
  listo: boolean;
  /** Ya eligió (aceptar, rechazar o guardar preferencias) y la decisión sigue vigente. */
  decidido: boolean;
  analitica: boolean;
  marketing: boolean;
}

const SIN_LEER: EstadoConsentimiento = { listo: false, decidido: false, analitica: false, marketing: false };

/** Decisión de cookies como almacén externo: se actualiza sola al guardar (misma pestaña) o cambiar en otra. */
export function useConsentimiento(): EstadoConsentimiento {
  const crudo = useSyncExternalStore(suscribirConsentimiento, instantaneaConsentimiento, () => null);
  return useMemo(() => {
    if (crudo === null) return SIN_LEER;
    const c = interpretar(crudo);
    return { listo: true, decidido: c !== null, analitica: c?.analitica ?? false, marketing: c?.marketing ?? false };
  }, [crudo]);
}
