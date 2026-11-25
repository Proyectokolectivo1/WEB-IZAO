'use client';

import { abrirPreferenciasCookies } from '@/lib/store/consentimiento';
import { TCK } from '@/lib/store/textos-cookies';

/** Enlace «Cookies» del pie: abre las preferencias para cambiar la decisión cuando se quiera. */
export function EnlaceCookies({ className }: { className?: string }) {
  return (
    <button type="button" aria-haspopup="dialog" aria-label={TCK.ui.enlacePieAria} data-testid="enlace-cookies" onClick={abrirPreferenciasCookies} className={className}>
      {TCK.ui.enlacePie}
    </button>
  );
}
