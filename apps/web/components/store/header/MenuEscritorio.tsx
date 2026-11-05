'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { Icono, IzaoImage } from '@izao/ui';
import { T } from '@/lib/store/textos';
import type { CategoriaMenu, CodigoPais } from '@/lib/store/types';

/** Menú con mega-menú (§8.4): categorías y subcategorías con imagen. Teclado: botón de disclosure, `Esc` cierra. */
export function MenuEscritorio({ pais, categorias }: { pais: CodigoPais; categorias: CategoriaMenu[] }) {
  const [abierta, setAbierta] = useState<string | null>(null);
  const raiz = useRef<HTMLUListElement>(null);

  const cerrar = () => setAbierta(null);
  const enlace = 'inline-flex min-h-11 items-center gap-1 px-3 text-[0.9375rem] hover:underline underline-offset-8 decoration-1';

  return (
    <nav aria-label={T.header.principal} className="hidden lg:block">
      <ul
        ref={raiz}
        className="flex items-center"
        onKeyDown={(e) => {
          if (e.key === 'Escape' && abierta) {
            cerrar();
          }
        }}
        onBlur={(e) => {
          if (!raiz.current?.contains(e.relatedTarget as Node | null)) cerrar();
        }}
      >
        <li>
          <Link href={`/${pais}/catalogo`} className={enlace}>
            {T.header.todosLosAromas}
          </Link>
        </li>
        {categorias.map((c) => {
          const tieneHijos = c.children.length > 0;
          return (
            <li
              key={c.id}
              onPointerEnter={(e) => e.pointerType === 'mouse' && tieneHijos && setAbierta(c.id)}
              onPointerLeave={(e) => e.pointerType === 'mouse' && cerrar()}
            >
              {tieneHijos ? (
                <>
                  <button
                    type="button"
                    className={enlace}
                    aria-expanded={abierta === c.id}
                    aria-controls={`mega-${c.id}`}
                    onClick={() => setAbierta((a) => (a === c.id ? null : c.id))}
                  >
                    {c.name}
                    <Icono nombre="chevronAbajo" tamano={14} />
                  </button>
                  {abierta === c.id ? (
                    <div id={`mega-${c.id}`} className="absolute inset-x-0 top-full rounded-b-panel border-y border-line bg-bg shadow-elev">
                      <div className="mx-auto grid max-w-[96rem] grid-cols-[14rem_1fr] gap-10 px-8 py-8">
                        <div>
                          <p className="etiqueta pb-3 text-ink/70">{T.header.categorias}</p>
                          <Link
                            href={`/${pais}/categoria/${c.slug}`}
                            onClick={cerrar}
                            className="font-display text-3xl leading-tight underline-offset-8 hover:underline"
                          >
                            {c.name}
                          </Link>
                          <p className="pt-3">
                            <Link href={`/${pais}/categoria/${c.slug}`} onClick={cerrar} className="text-[0.9375rem] underline underline-offset-4">
                              {T.header.verTodo}
                            </Link>
                          </p>
                        </div>
                        <ul className="grid grid-cols-3 gap-6 xl:grid-cols-5">
                          {c.children.map((h) => (
                            <li key={h.id}>
                              <Link href={`/${pais}/categoria/${h.slug}`} onClick={cerrar} className="group block">
                                {h.image ? (
                                  <IzaoImage media={h.image} alt="" sizes="200px" proporcion={1} className="mb-2 object-cover" />
                                ) : null}
                                <span className="text-[0.9375rem] underline-offset-4 group-hover:underline">{h.name}</span>
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  ) : null}
                </>
              ) : (
                <Link href={`/${pais}/categoria/${c.slug}`} className={enlace}>
                  {c.name}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
