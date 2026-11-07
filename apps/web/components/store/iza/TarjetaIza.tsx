'use client';

import Link from 'next/link';
import { useState } from 'react';
import { IzaoImage, clasesBoton } from '@izao/ui';
import type { TarjetaChat } from '@/lib/store/chat/conversar';
import { TI } from '@/lib/store/chat/textos';
import type { CodigoPais } from '@/lib/store/types';
import { useCarritoAcciones } from '../carrito/CarritoProvider';

/** Tarjeta de producto dentro del chat (§20.1): imagen, nombre, presentación, precio, «Comprar» y «Ver detalle». */
export function TarjetaIza({ tarjeta, pais, onNavegar }: { tarjeta: TarjetaChat; pais: CodigoPais; onNavegar: () => void }) {
  const { agregar } = useCarritoAcciones();
  const [agregado, setAgregado] = useState(false);

  return (
    <li className="flex gap-3 rounded-card border border-line bg-bg p-3" data-testid="tarjeta-iza">
      <Link href={tarjeta.url} onClick={onNavegar} className="w-20 shrink-0" tabIndex={-1} aria-hidden="true">
        <IzaoImage media={tarjeta.imagen} alt="" sizes="80px" redondeo="control" />
      </Link>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="font-display text-xl leading-tight">{tarjeta.nombre}</p>
        {tarjeta.presentacion ? <p className="text-[0.875rem] text-ink/80">{tarjeta.presentacion}</p> : null}
        <p className="text-[0.9375rem] tabular-nums">{tarjeta.precio}</p>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {tarjeta.linea ? (
            <button
              type="button"
              disabled={agregado}
              onClick={() => {
                if (!tarjeta.linea) return;
                agregar({ ...tarjeta.linea, cantidad: 1 }, { abrirBolso: false });
                setAgregado(true);
              }}
              className={clasesBoton({ tamano: 'sm' })}
            >
              {agregado ? TI.tarjeta.agregado : TI.tarjeta.comprar}
            </button>
          ) : (
            <span className="text-[0.875rem] text-ink/80">{TI.tarjeta.agotado}</span>
          )}
          <Link href={tarjeta.url} onClick={onNavegar} className={clasesBoton({ variante: 'texto', tamano: 'sm' })}>
            {TI.tarjeta.verDetalle}
            <span className="solo-lectores"> · {tarjeta.nombre}</span>
          </Link>
        </div>
        {agregado ? (
          <Link href={`/${pais}/checkout`} onClick={onNavegar} className="text-[0.875rem] underline underline-offset-4">
            {TI.tarjeta.finalizar}
          </Link>
        ) : null}
      </div>
    </li>
  );
}
