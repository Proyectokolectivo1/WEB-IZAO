'use client';

import Link from 'next/link';
import { useId, useState } from 'react';
import { T } from '@/lib/store/textos';
import type { CodigoPais, ColeccionTab } from '@/lib/store/types';
import { TarjetaProducto } from '../catalogo/TarjetaProducto';

/** Pestañas de colecciones (Hot Sale, Nuevo, Combos, Más vendidos) con «Ver todos». Patrón WAI-ARIA de pestañas. */
export function PestanasColecciones({ pais, colecciones }: { pais: CodigoPais; colecciones: ColeccionTab[] }) {
  const [activa, setActiva] = useState(0);
  const uid = useId();
  const actual = colecciones[activa] ?? colecciones[0]!;

  function alTeclear(e: React.KeyboardEvent, k: number) {
    const n = colecciones.length;
    const destino = e.key === 'ArrowRight' ? (k + 1) % n : e.key === 'ArrowLeft' ? (k - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : null;
    if (destino === null) return;
    e.preventDefault();
    setActiva(destino);
    document.getElementById(`${uid}-tab-${destino}`)?.focus();
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <div role="tablist" aria-label={T.home.colecciones} className="sin-scroll-visible -mx-1 flex overflow-x-auto">
          {colecciones.map((c, k) => (
            <button
              key={c.id}
              id={`${uid}-tab-${k}`}
              role="tab"
              type="button"
              aria-selected={k === activa}
              aria-controls={`${uid}-panel`}
              tabIndex={k === activa ? 0 : -1}
              onClick={() => setActiva(k)}
              onKeyDown={(e) => alTeclear(e, k)}
              className={`min-h-11 shrink-0 whitespace-nowrap border-b-2 px-4 font-display text-2xl ${k === activa ? 'border-ink' : 'border-transparent text-ink/70 hover:text-ink'}`}
            >
              {c.name}
            </button>
          ))}
        </div>
        <Link href={`/${pais}/coleccion/${actual.slug}`} className="inline-flex min-h-11 shrink-0 items-center text-[0.9375rem] underline underline-offset-4">
          {T.home.verTodos}
        </Link>
      </div>
      <div id={`${uid}-panel`} role="tabpanel" aria-labelledby={`${uid}-tab-${activa}`} className="pt-8">
        <ul className="grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
          {actual.items.map((item) => (
            <li key={item.product_id}>
              <TarjetaProducto item={item} pais={pais} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
