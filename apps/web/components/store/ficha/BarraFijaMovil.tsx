'use client';

import { useEffect, useState } from 'react';
import { Button, Icono } from '@izao/ui';
import { lineaDe, presentacionDe } from '@/lib/store/ficha-util';
import { formatearPrecio } from '@/lib/store/pais';
import { T } from '@/lib/store/textos';
import type { CodigoPais, FichaProducto } from '@/lib/store/types';
import { useCarritoAcciones } from '../carrito/CarritoProvider';
import { useComprarAhora } from '../carrito/useComprarAhora';

export const ID_BOTON_AGREGAR = 'agregar-ficha';
/** Alto de la barra (dos filas: precio y botones). El botón principal cuenta como oculto al pasar por debajo de ella. */
const ALTO_BARRA = 112;

interface Props {
  ficha: FichaProducto;
  pais: CodigoPais;
  varianteId: string | null;
}

/**
 * Barra fija inferior (solo móvil, §7.6) con el precio de la variante elegida, «Agregar» y «Comprar ahora». Aparece cuando el
 * botón principal sale de la pantalla y se oculta (y deja de recibir foco) cuando vuelve a verse.
 */
export function BarraFijaMovil({ ficha, pais, varianteId }: Props) {
  const { agregar } = useCarritoAcciones();
  const comprarAhora = useComprarAhora();
  const [visible, setVisible] = useState(false);
  const v = ficha.variants.find((x) => x.id === varianteId) ?? null;

  useEffect(() => {
    const boton = document.getElementById(ID_BOTON_AGREGAR);
    if (!boton || typeof IntersectionObserver === 'undefined') return;
    const obs = new IntersectionObserver(([e]) => setVisible(!!e && !e.isIntersecting), { threshold: 0, rootMargin: `0px 0px -${ALTO_BARRA}px 0px` });
    obs.observe(boton);
    return () => obs.disconnect();
  }, []);

  if (!v) return null;
  const presentacion = presentacionDe(ficha, v);

  return (
    <div
      data-testid="barra-fija"
      role="region"
      aria-label={T.ficha.barraCompra}
      inert={!visible}
      className={`fixed inset-x-0 bottom-0 z-30 rounded-t-panel bg-bg px-4 pt-3 shadow-elev transition-transform duration-300 ease-izao motion-reduce:transition-none lg:hidden ${
        visible ? 'translate-y-0' : 'translate-y-full'
      }`}
      style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
    >
      <div className="mx-auto flex max-w-xl flex-col gap-2">
        <div className="flex items-baseline justify-between gap-4">
          <p className="min-w-0 truncate text-[0.8125rem]">{presentacion ?? ficha.name}</p>
          <p className="font-display text-xl leading-tight tabular-nums">{formatearPrecio(v.price, pais)}</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button
            data-testid="barra-agregar"
            tamano="lg"
            className="px-3!"
            aria-label={v.in_stock ? T.ficha.agregarAlBolso : undefined}
            disabled={!v.in_stock}
            onClick={() => agregar(lineaDe(ficha, v, 1), { abrirBolso: true })}
          >
            <Icono nombre="bolso" tamano={18} />
            {v.in_stock ? T.ficha.barraAgregar : T.ficha.agotado}
          </Button>
          <Button
            data-testid="barra-comprar-ahora"
            variante="secundario"
            tamano="lg"
            className="px-3!"
            disabled={!v.in_stock}
            onClick={() => comprarAhora(lineaDe(ficha, v, 1))}
          >
            {T.ficha.barraComprar}
          </Button>
        </div>
      </div>
    </div>
  );
}
