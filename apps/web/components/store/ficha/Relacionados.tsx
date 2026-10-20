'use client';

import { useEffect, useRef, useState } from 'react';
import { GrillaEsqueleto } from '@izao/ui';
import { T } from '@/lib/store/textos';
import type { CodigoPais, ItemCatalogo } from '@/lib/store/types';
import { TarjetaProducto } from '../catalogo/TarjetaProducto';
import { EncabezadoSeccion } from './EncabezadoSeccion';

interface Props {
  pais: CodigoPais;
  productoId: string;
  /** Cuántos aromas pedir (4 llena una fila en escritorio). */
  limite?: number;
  /** Número de la sección (01, 02…). */
  numero: number;
}

/**
 * «También te puede gustar» (§7.6): misma familia y género, en stock, pedidos a `/api/catalog/related` cuando
 * el navegador está ocioso o la sección se acerca. Mientras llega, reserva el alto exacto de las tarjetas.
 * Si no hay coincidencias, la sección desaparece sin dejar hueco.
 */
export function Relacionados({ pais, productoId, limite = 4, numero }: Props) {
  const raiz = useRef<HTMLElement>(null);
  const [estado, setEstado] = useState<'espera' | 'cargando' | 'listo' | 'vacio'>('espera');
  const [items, setItems] = useState<ItemCatalogo[]>([]);

  useEffect(() => {
    const el = raiz.current;
    if (!el) return;
    let activo = true;
    let lanzado = false;
    const control = new AbortController();
    const pedir = () => {
      if (!activo || lanzado) return;
      lanzado = true;
      setEstado('cargando');
      fetch(`/api/catalog/related?country=${pais}&id=${productoId}&limit=${limite}`, { signal: control.signal })
        .then((r) => (r.ok ? (r.json() as Promise<{ items: ItemCatalogo[] }>) : null))
        .then((d) => {
          if (!activo) return;
          setItems(d?.items ?? []);
          setEstado(d && d.items.length > 0 ? 'listo' : 'vacio');
        })
        .catch(() => {
          if (activo) setEstado('vacio');
        });
    };
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    const idle = w.requestIdleCallback ? w.requestIdleCallback(pedir, { timeout: 3000 }) : window.setTimeout(pedir, 2000);
    const obs = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && pedir(), { rootMargin: '600px' });
    obs.observe(el);
    return () => {
      activo = false;
      control.abort();
      obs.disconnect();
      if (w.cancelIdleCallback) w.cancelIdleCallback(idle as number);
      else clearTimeout(idle);
    };
  }, [pais, productoId, limite]);

  if (estado === 'vacio') return null;

  return (
    <section ref={raiz} data-testid="relacionados" aria-label={T.ficha.relacionados} className="pt-20">
      <EncabezadoSeccion n={numero} titulo={T.ficha.relacionados} />
      {estado === 'listo' ? (
        <ul className="grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-4">
          {items.map((it) => (
            <li key={it.product_id}>
              <TarjetaProducto item={it} pais={pais} />
            </li>
          ))}
        </ul>
      ) : (
        <div role="status" className="grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-4">
          <span className="solo-lectores">{T.ficha.cargandoRelacionados}</span>
          <GrillaEsqueleto cantidad={limite} />
        </div>
      )}
    </section>
  );
}
