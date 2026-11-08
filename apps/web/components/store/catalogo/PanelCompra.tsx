'use client';

import { useEffect, useState } from 'react';
import { Button, Chip, Icono } from '@izao/ui';
import { lineaDe, presentacionDe, varianteInicial } from '@/lib/store/ficha-util';
import { formatearPrecio } from '@/lib/store/pais';
import { T } from '@/lib/store/textos';
import type { CodigoPais, FichaProducto } from '@/lib/store/types';
import { Cantidad } from '../Cantidad';
import { useCarritoAcciones } from '../carrito/CarritoProvider';
import { useComprarAhora } from '../carrito/useComprarAhora';

interface Props {
  ficha: FichaProducto;
  pais: CodigoPais;
  /** Se llama después de agregar (la vista rápida se cierra). */
  alAgregar?: () => void;
  /** Id del botón de agregar. */
  idBotonAgregar?: string;
  /** Avisa a la ficha qué variante está elegida (precio de la barra fija). */
  alElegir?: (variantId: string) => void;
  /** Variante que debe quedar elegida (por `?variante={SKU}`); se aplica cuando llega. */
  varianteIdPedida?: string | null;
}

/** Variantes en chips con precio, cantidad y botón de agregar. Lo comparten la vista rápida y la ficha. */
export function PanelCompra({ ficha, pais, alAgregar, idBotonAgregar, alElegir, varianteIdPedida }: Props) {
  const { agregar } = useCarritoAcciones();
  const comprarAhora = useComprarAhora();
  const [elegida, setElegida] = useState(() => varianteInicial(ficha.variants)?.id ?? null);
  const [cantidad, setCantidad] = useState(1);
  useEffect(() => {
    if (varianteIdPedida) setElegida(varianteIdPedida);
  }, [varianteIdPedida]);
  const v = ficha.variants.find((x) => x.id === elegida) ?? null;
  const precio = (n: number) => formatearPrecio(n, pais);
  const ahorro = v?.compare_at_price && v.compare_at_price > v.price ? v.compare_at_price - v.price : 0;

  return (
    <div className="bloque-calido flex flex-col gap-5 p-5 sm:p-6">
      {ficha.variants.length > 1 ? (
        <fieldset>
          <legend className="etiqueta pb-2 text-ink/70">{T.ficha.elegir}</legend>
          <div className="flex flex-wrap gap-2">
            {ficha.variants.map((x) => (
              <Chip
                key={x.id}
                seleccionado={x.id === elegida}
                disabled={!x.in_stock}
                onClick={() => {
                  setElegida(x.id);
                  setCantidad(1);
                  alElegir?.(x.id);
                }}
                className="flex-col !items-start gap-0 py-2"
              >
                <span>{presentacionDe(ficha, x) ?? x.sku ?? ficha.name}</span>
                <span className="text-[0.8125rem] tabular-nums opacity-90">{precio(x.price)}</span>
              </Chip>
            ))}
          </div>
        </fieldset>
      ) : null}

      {v ? (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="font-display text-4xl tabular-nums">{precio(v.price)}</p>
          {v.compare_at_price && v.compare_at_price > v.price ? (
            <s className="text-lg text-ink/70 tabular-nums">{precio(v.compare_at_price)}</s>
          ) : null}
          {ahorro > 0 ? <p className="text-[0.9375rem] text-success">{T.ficha.ahorras(precio(ahorro))}</p> : null}
        </div>
      ) : null}

      {v?.in_stock && v.stock_bajo ? <p className="text-[0.9375rem]">{T.ficha.pocasUnidades}</p> : null}

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {v?.in_stock ? (
            <Cantidad
              valor={cantidad}
              max={Math.max(v.stock_disponible, 1)}
              onCambiar={setCantidad}
              etiqueta={T.ficha.cantidad}
              etiquetaMas={T.ficha.mas}
              etiquetaMenos={T.ficha.menos}
            />
          ) : null}
          <Button
            id={idBotonAgregar}
            data-testid="boton-agregar"
            tamano="lg"
            className="min-w-[12rem] flex-1 whitespace-nowrap px-4!"
            disabled={!v || !v.in_stock}
            onClick={() => {
              if (!v) return;
              agregar(lineaDe(ficha, v, cantidad), { abrirBolso: true });
              alAgregar?.();
            }}
          >
            <Icono nombre="bolso" tamano={18} />
            {v?.in_stock ? T.ficha.agregarAlBolso : T.ficha.agotado}
          </Button>
        </div>
        {/* «Comprar ahora»: suma la cantidad elegida y va directo al pago, sin pasar por el bolso. */}
        <Button
          variante="secundario"
          tamano="lg"
          bloque
          data-testid="boton-comprar-ahora"
          disabled={!v || !v.in_stock}
          onClick={() => {
            if (!v) return;
            alAgregar?.();
            comprarAhora(lineaDe(ficha, v, cantidad));
          }}
        >
          {T.ficha.comprarAhora}
        </Button>
      </div>
    </div>
  );
}
