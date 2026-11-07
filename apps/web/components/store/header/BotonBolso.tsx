'use client';

import { useEffect, useRef } from 'react';
import { Icono, prefiereMenosMovimiento } from '@izao/ui';
import { animate } from 'motion/mini';
import { T } from '@/lib/store/textos';
import { useCarritoAcciones, useCarritoLineas, usePulsoBolso } from '../carrito/CarritoProvider';

/** Botón del bolso con contador. Rebota al agregar algo (solo `transform`). */
export function BotonBolso() {
  const { abrir } = useCarritoAcciones();
  const { unidades, listo } = useCarritoLineas();
  const pulso = usePulsoBolso();
  const ref = useRef<HTMLSpanElement>(null);
  const primera = useRef(true);

  useEffect(() => {
    if (primera.current) {
      primera.current = false;
      return;
    }
    if (!ref.current || prefiereMenosMovimiento()) return;
    animate(ref.current, { transform: ['scale(1)', 'scale(1.22)', 'scale(1)'] }, { duration: 0.45, ease: [0.2, 0.7, 0.2, 1] });
  }, [pulso]);

  return (
    <button
      type="button"
      onClick={abrir}
      aria-label={T.header.carrito(listo ? unidades : 0)}
      aria-haspopup="dialog"
      className="relative inline-flex size-11 items-center justify-center rounded-control hover:bg-surface"
    >
      <span ref={ref} className="inline-flex">
        <Icono nombre="bolso" tamano={22} />
      </span>
      {listo && unidades > 0 ? (
        <span
          aria-hidden="true"
          data-testid="contador-carrito"
          className="absolute right-0.5 top-0.5 inline-flex min-w-[1.125rem] items-center justify-center rounded-sm bg-ink px-1 text-[0.6875rem] font-semibold leading-[1.125rem] text-bg tabular-nums"
        >
          {unidades}
        </span>
      ) : null}
    </button>
  );
}
