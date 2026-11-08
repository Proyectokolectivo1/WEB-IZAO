'use client';

import dynamic from 'next/dynamic';
import { useRef, useState } from 'react';
import { Icono, IzaoImage } from '@izao/ui';
import { T } from '@/lib/store/textos';
import type { MediaRef } from '@/lib/store/types';

const ImagenAmpliada = dynamic(() => import('./ImagenAmpliada').then((m) => m.ImagenAmpliada), { ssr: false });

interface Props {
  imagenes: MediaRef[];
  nombre: string;
}

const ZOOM = 2;
const UMBRAL_DESLIZAR = 48;

/**
 * Galería de la ficha (§7.6): miniaturas, zoom al pasar el mouse (solo puntero fino), deslizar en táctil y
 * pantalla completa con pellizco. La imagen principal tiene proporción fija 4:5, así cambiar de foto no mueve nada.
 */
export function Galeria({ imagenes, nombre }: Props) {
  const [indice, setIndice] = useState(0);
  const [ampliada, setAmpliada] = useState(false);
  const [montarAmpliada, setMontarAmpliada] = useState(false);
  const [alta, setAlta] = useState(false);
  const interior = useRef<HTMLDivElement>(null);
  const inicioX = useRef<number | null>(null);
  const deslizo = useRef(false);
  const total = imagenes.length;
  const actual = imagenes[indice] ?? null;

  const ir = (n: number) => setIndice(((n % total) + total) % total);

  function alMover(e: React.PointerEvent<HTMLButtonElement>) {
    if (e.pointerType !== 'mouse' || !interior.current) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 100;
    const y = ((e.clientY - r.top) / r.height) * 100;
    interior.current.style.transformOrigin = `${x}% ${y}%`;
  }

  function alEntrar(e: React.PointerEvent<HTMLButtonElement>) {
    if (e.pointerType !== 'mouse' || !interior.current) return;
    setAlta(true); // el navegador elige la variante más grande del `srcset` solo cuando hace falta
    interior.current.style.transform = `scale(${ZOOM})`;
  }

  function alSalir() {
    if (interior.current) interior.current.style.transform = 'scale(1)';
  }

  return (
    <div data-testid="galeria" className={`grid gap-3 md:gap-4 ${total > 1 ? 'md:grid-cols-[5rem_minmax(0,1fr)]' : ''}`}>
      <div className="relative md:order-2">
        <button
          type="button"
          data-testid="galeria-principal"
          // Sin foto no hay nada que ampliar: el nombre es el texto visible (WCAG 2.5.3, el nombre incluye lo que se ve).
          aria-label={actual ? T.ficha.ampliarImagen : T.ficha.sinFoto}
          aria-haspopup={actual ? 'dialog' : undefined}
          disabled={!actual}
          className="raton:cursor-zoom-in relative block aspect-[4/5] w-full touch-pan-y overflow-hidden rounded-card bg-surface"
          onPointerEnter={alEntrar}
          onPointerMove={alMover}
          onPointerLeave={alSalir}
          onPointerDown={(e) => {
            deslizo.current = false;
            inicioX.current = e.pointerType === 'touch' ? e.clientX : null;
          }}
          onPointerUp={(e) => {
            if (inicioX.current === null || total < 2) return;
            const dx = e.clientX - inicioX.current;
            inicioX.current = null;
            if (Math.abs(dx) < UMBRAL_DESLIZAR) return;
            deslizo.current = true;
            ir(indice + (dx < 0 ? 1 : -1));
          }}
          onClick={() => {
            if (deslizo.current || !actual) return;
            setMontarAmpliada(true);
            setAmpliada(true);
          }}
        >
          <div ref={interior} className="h-full w-full transition-transform duration-300 ease-izao motion-reduce:transition-none will-change-transform">
            <IzaoImage
              key={indice}
              media={actual}
              alt={actual?.alt ?? nombre}
              sizes={alta ? '2400px' : '(min-width:1024px) 46vw, (min-width:768px) 56vw, 100vw'}
              prioritaria={indice === 0}
              className="h-full object-cover"
              draggable={false}
            />
          </div>
          {actual ? null : (
            <span className="textura-calida absolute inset-0 flex flex-col items-center justify-center gap-3 font-display text-2xl text-ink/70">
              <Icono nombre="gota" tamano={40} className="text-ink/30" />
              {T.ficha.sinFoto}
            </span>
          )}
        </button>

        {total > 1 ? (
          <p className="pointer-events-none absolute bottom-3 left-3 bg-bg/90 px-2 py-1 text-[0.8125rem] tabular-nums md:hidden" aria-hidden="true">
            {indice + 1} / {total}
          </p>
        ) : null}
        <p className="solo-lectores" aria-live="polite">
          {T.ficha.imagenN(indice + 1, Math.max(total, 1))}
        </p>
      </div>

      {total > 1 ? (
        <ul
          aria-label={T.ficha.galeria}
          className="sin-scroll-visible -mx-4 flex gap-2 overflow-x-auto px-4 md:order-1 md:mx-0 md:max-h-[40rem] md:flex-col md:overflow-y-auto md:overflow-x-visible md:px-0"
        >
          {imagenes.map((m, k) => (
            <li key={k} className="w-16 shrink-0 md:w-full">
              <button
                type="button"
                onClick={() => setIndice(k)}
                aria-label={T.ficha.imagenN(k + 1, total)}
                aria-current={k === indice}
                data-testid="miniatura"
                className={`relative block aspect-[4/5] w-full overflow-hidden rounded-control border ${k === indice ? 'border-ink' : 'border-transparent hover:border-line'}`}
              >
                <IzaoImage media={m} alt="" sizes="80px" className="h-full object-cover" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {montarAmpliada ? (
        <ImagenAmpliada abierto={ampliada} onCerrar={() => setAmpliada(false)} imagenes={imagenes} indice={indice} onIndice={ir} nombre={nombre} />
      ) : null}
    </div>
  );
}
