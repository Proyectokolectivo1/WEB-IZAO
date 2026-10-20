'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Icono } from '@izao/ui';
import { T } from '@/lib/store/textos';
import type { Anuncio } from '@/lib/store/types';

interface Props {
  anuncios: Anuncio[];
  segundos: number;
}

/**
 * Barra de anuncios rotativa (§9.2). El primer mensaje llega ya renderizado en el servidor (sin CLS);
 * rota con desvanecido, se detiene al pasar el mouse o con el foco dentro y respeta `prefers-reduced-motion`.
 */
export function AnuncioBarra({ anuncios, segundos }: Props) {
  const [i, setI] = useState(0);
  const [pausa, setPausa] = useState(false);
  const [reducido, setReducido] = useState(false);
  const n = anuncios.length;

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducido(mq.matches);
    const f = (e: MediaQueryListEvent) => setReducido(e.matches);
    mq.addEventListener('change', f);
    return () => mq.removeEventListener('change', f);
  }, []);

  useEffect(() => {
    if (n < 2 || pausa || reducido) return;
    const t = setInterval(() => setI((x) => (x + 1) % n), Math.max(segundos, 2) * 1000);
    return () => clearInterval(t);
  }, [n, pausa, reducido, segundos]);

  if (n === 0) return null;
  const actual = anuncios[Math.min(i, n - 1)]!;
  const texto = <span key={actual.id} className="animate-[aparecer_450ms_ease-out]">{actual.text}</span>;

  return (
    <div
      className="bg-ink text-bg"
      role="region"
      aria-label={T.header.anuncios}
      onMouseEnter={() => setPausa(true)}
      onMouseLeave={() => setPausa(false)}
      onFocus={() => setPausa(true)}
      onBlur={() => setPausa(false)}
    >
      <div className="mx-auto flex h-9 max-w-[96rem] items-center justify-center gap-1 px-2">
        {n > 1 ? (
          <button
            type="button"
            aria-label={T.header.anuncioAnterior}
            onClick={() => setI((x) => (x - 1 + n) % n)}
            className="hidden size-9 items-center justify-center md:inline-flex"
          >
            <Icono nombre="chevronIzquierda" tamano={14} />
          </button>
        ) : null}
        <p className="etiqueta truncate text-center" aria-live="off">
          {actual.link_url ? (
            <Link href={actual.link_url} className="underline-offset-4 hover:underline">
              {texto}
            </Link>
          ) : (
            texto
          )}
        </p>
        {n > 1 ? (
          <button
            type="button"
            aria-label={T.header.anuncioSiguiente}
            onClick={() => setI((x) => (x + 1) % n)}
            className="hidden size-9 items-center justify-center md:inline-flex"
          >
            <Icono nombre="chevronDerecha" tamano={14} />
          </button>
        ) : null}
      </div>
    </div>
  );
}
