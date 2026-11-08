'use client';

import { EVENTO_ABRIR_SEDE } from '@/lib/store/sede';
import type { CodigoPais } from '@/lib/store/types';
import { Bandera } from './Bandera';

/** Muestra el país actual (`etiqueta` = aclaración para lectores, se dice después del texto visible) y abre la ventana de sede (la lógica vive en `SelectorSede`, que baja su código al primer clic). */
export function BotonSede({ pais, etiqueta, texto, className = 'inline-flex', antes }: { pais: CodigoPais; etiqueta: string; texto?: string; className?: string; antes?: () => void }) {
  const abrir = () => {
    // Si había otro panel abierto (menú móvil), se espera a que termine de cerrarse.
    antes?.();
    window.setTimeout(() => window.dispatchEvent(new Event(EVENTO_ABRIR_SEDE)), antes ? 320 : 0);
  };
  return (
    <button
      type="button"
      data-testid="boton-sede"
      onClick={abrir}
      aria-haspopup="dialog"
      className={`min-h-11 items-center gap-2 rounded-control px-2 text-[0.8125rem] font-semibold uppercase tracking-[0.08em] hover:bg-surface ${className}`}
    >
      <Bandera pais={pais} className="w-6" />
      {/* WCAG 2.5.3: el nombre accesible empieza por el texto visible; la aclaración va solo para lectores de pantalla. */}
      <span>{texto ?? pais}</span>
      <span className="solo-lectores">. {etiqueta}</span>
    </button>
  );
}
