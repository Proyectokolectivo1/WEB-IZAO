'use client';

import { Icono } from '@izao/ui';

interface Props {
  valor: number;
  min?: number;
  max: number;
  onCambiar: (n: number) => void;
  etiquetaMas: string;
  etiquetaMenos: string;
  /** Descripción de lo que se cambia, para el lector de pantalla. */
  etiqueta: string;
}

/** Selector de cantidad con botones de 44 px. El valor se anuncia al cambiar. */
export function Cantidad({ valor, min = 1, max, onCambiar, etiquetaMas, etiquetaMenos, etiqueta }: Props) {
  return (
    <div role="group" aria-label={etiqueta} className="inline-flex items-center rounded-control border border-line">
      <button
        type="button"
        onClick={() => onCambiar(valor - 1)}
        disabled={valor <= min}
        aria-label={etiquetaMenos}
        className="inline-flex size-11 items-center justify-center rounded-l-control hover:bg-surface disabled:opacity-40"
      >
        <Icono nombre="menos" tamano={16} />
      </button>
      <output aria-live="polite" className="min-w-8 text-center text-[0.9375rem] tabular-nums">
        {valor}
      </output>
      <button
        type="button"
        onClick={() => onCambiar(valor + 1)}
        disabled={valor >= max}
        aria-label={etiquetaMas}
        className="inline-flex size-11 items-center justify-center rounded-r-control hover:bg-surface disabled:opacity-40"
      >
        <Icono nombre="mas" tamano={16} />
      </button>
    </div>
  );
}
