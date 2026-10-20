'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { extremosControl, normalizarRango } from '@/lib/store/lote';
import { aTextoEditable, aUnidadMenor, formatearPrecio, monedaDe, pasoPrecio } from '@/lib/store/pais';
import { T } from '@/lib/store/textos';
import type { CodigoPais } from '@/lib/store/types';

interface Props {
  pais: CodigoPais;
  /** Mínimo y máximo reales del país, en unidad menor. */
  limites: { min: number; max: number };
  valor: { price_min?: number; price_max?: number };
  onCambio: (v: { price_min?: number; price_max?: number }) => void;
  /** Sufijo de los `data-testid` (la hoja móvil usa `-hoja` para no repetir los del panel de escritorio). */
  sufijo?: string;
}

/**
 * Rango de precio con doble manija y campos numéricos editables (§7.2). Las manijas son `<input type=range>`
 * nativos (teclado y lectores de pantalla); el cambio se confirma al soltar la manija o al salir del campo.
 */
export function RangoPrecio({ pais, limites, valor, onCambio, sufijo = '' }: Props) {
  const uid = useId();
  const paso = pasoPrecio(pais);
  const ext = extremosControl(valor, limites, paso);
  const [loc, setLoc] = useState({ min: ext.min, max: ext.max });
  const [edicion, setEdicion] = useState<{ min?: string; max?: string }>({});
  const ultimo = useRef(loc);
  ultimo.current = loc;

  // Si el valor cambia desde fuera (chips, «Limpiar todo»), el control lo sigue.
  useEffect(() => {
    setLoc({ min: ext.min, max: ext.max });
    setEdicion({});
  }, [ext.min, ext.max]);

  const confirmar = (n: { min: number; max: number }) => onCambio(normalizarRango(n, limites, paso));

  const mover = (lado: 'min' | 'max', v: number) => {
    setLoc((p) => {
      const sig = lado === 'min' ? { min: Math.min(v, p.max), max: p.max } : { min: p.min, max: Math.max(v, p.min) };
      ultimo.current = sig;
      return sig;
    });
  };

  const confirmarTexto = (lado: 'min' | 'max') => {
    const txt = edicion[lado];
    if (txt === undefined) return;
    const menor = txt.trim() === '' ? (lado === 'min' ? ext.piso : ext.techo) : aUnidadMenor(txt, pais);
    setEdicion((e) => ({ ...e, [lado]: undefined }));
    if (menor === null) return;
    const sig = lado === 'min' ? { min: menor, max: loc.max } : { min: loc.min, max: menor };
    const ordenado = sig.min > sig.max ? { min: sig.max, max: sig.min } : sig;
    setLoc(ordenado);
    confirmar(ordenado);
  };

  const pct = (v: number) => ((v - ext.piso) / Math.max(ext.techo - ext.piso, 1)) * 100;
  const moneda = monedaDe(pais);
  const campo = 'min-h-11 w-full rounded-md border border-line bg-transparent px-3 text-[0.9375rem] tabular-nums';

  return (
    <div>
      <div className="rango-doble" role="group" aria-label={T.listado.rangoPrecio}>
        <div aria-hidden="true" className="absolute inset-x-3 top-1/2 h-px -translate-y-1/2 bg-ink/25" />
        <div
          aria-hidden="true"
          className="absolute top-1/2 h-0.5 -translate-y-1/2 bg-ink"
          style={{ left: `calc(0.75rem + (100% - 1.5rem) * ${pct(loc.min) / 100})`, right: `calc(0.75rem + (100% - 1.5rem) * ${1 - pct(loc.max) / 100})` }}
        />
        <input
          type="range"
          min={ext.piso}
          max={ext.techo}
          step={paso}
          value={loc.min}
          aria-label={T.listado.barraPrecioMin}
          aria-valuetext={formatearPrecio(loc.min, pais)}
          style={{ zIndex: loc.min > (ext.piso + ext.techo) / 2 ? 3 : 2 }}
          onChange={(e) => mover('min', Number(e.target.value))}
          onPointerUp={() => confirmar(ultimo.current)}
          onKeyUp={() => confirmar(ultimo.current)}
          onBlur={() => confirmar(ultimo.current)}
        />
        <input
          type="range"
          min={ext.piso}
          max={ext.techo}
          step={paso}
          value={loc.max}
          aria-label={T.listado.barraPrecioMax}
          aria-valuetext={formatearPrecio(loc.max, pais)}
          style={{ zIndex: 2 }}
          onChange={(e) => mover('max', Number(e.target.value))}
          onPointerUp={() => confirmar(ultimo.current)}
          onKeyUp={() => confirmar(ultimo.current)}
          onBlur={() => confirmar(ultimo.current)}
        />
      </div>

      <div className="mt-2 grid grid-cols-2 gap-3">
        {(['min', 'max'] as const).map((lado) => (
          <div key={lado}>
            <label htmlFor={`${uid}-${lado}`} className="etiqueta mb-1 block text-ink/70">
              {lado === 'min' ? T.listado.precioMinimo : T.listado.precioMaximo} ({moneda})
            </label>
            <input
              id={`${uid}-${lado}`}
              data-testid={`precio-${lado}${sufijo}`}
              type="text"
              inputMode={moneda === 'USD' ? 'decimal' : 'numeric'}
              autoComplete="off"
              className={campo}
              value={edicion[lado] ?? aTextoEditable(loc[lado], pais)}
              onChange={(e) => setEdicion((p) => ({ ...p, [lado]: e.target.value }))}
              onBlur={() => confirmarTexto(lado)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  confirmarTexto(lado);
                }
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
