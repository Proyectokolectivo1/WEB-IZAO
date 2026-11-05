'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Icono, Sheet } from '@izao/ui';
import { T } from '@/lib/store/textos';
import type { CategoriaMenu, CodigoPais } from '@/lib/store/types';

/** Menú móvil: panel lateral con categorías y subcategorías plegables. */
export function MenuMovil({ pais, categorias }: { pais: CodigoPais; categorias: CategoriaMenu[] }) {
  const [abierto, setAbierto] = useState(false);
  const [desplegada, setDesplegada] = useState<string | null>(null);
  const cerrar = () => setAbierto(false);
  const fila = 'flex min-h-12 w-full items-center justify-between border-b border-line px-5 text-left font-display text-2xl';

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        aria-label={T.header.menu}
        aria-haspopup="dialog"
        className="inline-flex size-11 items-center justify-center rounded-control hover:bg-surface lg:hidden"
      >
        <Icono nombre="menu" tamano={22} />
      </button>
      <Sheet abierto={abierto} onCerrar={cerrar} titulo={T.header.menu} etiquetaCerrar={T.header.cerrarMenu} lado="izquierda">
        <nav aria-label={T.header.principal}>
          <ul>
            <li>
              <Link href={`/${pais}/catalogo`} onClick={cerrar} className={fila}>
                {T.header.todosLosAromas}
              </Link>
            </li>
            {categorias.map((c) => (
              <li key={c.id}>
                {c.children.length > 0 ? (
                  <>
                    <button
                      type="button"
                      className={fila}
                      aria-expanded={desplegada === c.id}
                      onClick={() => setDesplegada((d) => (d === c.id ? null : c.id))}
                    >
                      {c.name}
                      <Icono nombre={desplegada === c.id ? 'chevronArriba' : 'chevronAbajo'} />
                    </button>
                    {desplegada === c.id ? (
                      <ul className="bg-surface/60">
                        <li>
                          <Link href={`/${pais}/categoria/${c.slug}`} onClick={cerrar} className="flex min-h-11 items-center px-8 text-[0.9375rem] underline underline-offset-4">
                            {T.header.verTodo}
                          </Link>
                        </li>
                        {c.children.map((h) => (
                          <li key={h.id}>
                            <Link href={`/${pais}/categoria/${h.slug}`} onClick={cerrar} className="flex min-h-11 items-center px-8 text-[1rem]">
                              {h.name}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </>
                ) : (
                  <Link href={`/${pais}/categoria/${c.slug}`} onClick={cerrar} className={fila}>
                    {c.name}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </nav>
      </Sheet>
    </>
  );
}
