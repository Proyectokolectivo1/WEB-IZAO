'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Icono, clasesBoton, useMenosMovimiento } from '@izao/ui';
import type { Banner } from '@/lib/store/types';
import { ImagenResponsiva } from '../ImagenResponsiva';

const AUTOPLAY_MS = 6000;
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

const POSICION = {
  left: 'items-start text-left',
  center: 'items-center text-center',
  right: 'items-end text-right',
} as const;

/** Carrusel hero (§8.5): desvanecido con leve *ken burns* en escritorio, 6 s, pausa con el mouse o el foco, deslizar en táctil. */
export function Hero({ banners }: { banners: Banner[] }) {
  const [i, setI] = useState(0);
  const [pausa, setPausa] = useState(false);
  const reducido = useMenosMovimiento();
  const n = banners.length;
  const inicioX = useRef<number | null>(null);

  useEffect(() => {
    if (n < 2 || pausa || reducido) return;
    const t = setInterval(() => setI((x) => (x + 1) % n), AUTOPLAY_MS);
    return () => clearInterval(t);
  }, [n, pausa, reducido]);

  if (n === 0) return null;
  const ir = (k: number) => setI(((k % n) + n) % n);

  return (
    <section
      aria-roledescription="carrusel"
      aria-label={banners[0]?.alt}
      className="relative"
      onMouseEnter={() => setPausa(true)}
      onMouseLeave={() => setPausa(false)}
      onFocus={() => setPausa(true)}
      onBlur={() => setPausa(false)}
      onPointerDown={(e) => {
        inicioX.current = e.clientX;
      }}
      onPointerUp={(e) => {
        if (inicioX.current !== null && n > 1) {
          const dx = e.clientX - inicioX.current;
          if (Math.abs(dx) > 48) ir(i + (dx < 0 ? 1 : -1));
        }
        inicioX.current = null;
      }}
    >
      <div className="grid overflow-hidden">
        {banners.map((b, k) => {
          const activo = k === i;
          const color = b.text_color && HEX.test(b.text_color) ? b.text_color : undefined;
          return (
            <div
              key={b.id}
              role="group"
              aria-roledescription="diapositiva"
              aria-label={`${k + 1} / ${n}`}
              aria-hidden={!activo}
              inert={!activo}
              className={`relative [grid-area:1/1] aspect-[4/5] transition-opacity duration-700 ease-izao md:aspect-[12/5] ${
                activo ? 'opacity-100' : 'pointer-events-none opacity-0'
              }`}
            >
              <div className={`h-full w-full transition-transform duration-[7000ms] ease-linear ${activo ? 'md:scale-[1.04]' : 'scale-100'}`}>
                <ImagenResponsiva escritorio={b.desktop} movil={b.mobile} alt={b.alt} prioritaria={k === 0} />
              </div>
              {b.title || b.subtitle || b.cta_label ? (
                <div className="absolute inset-0 mx-auto flex max-w-[96rem] flex-col justify-end px-6 pb-14 sm:px-10 md:justify-center md:pb-0 lg:px-16">
                  <div className={`flex max-w-xl flex-col gap-4 ${POSICION[b.text_position]} ${b.text_position === 'right' ? 'ml-auto' : b.text_position === 'center' ? 'mx-auto' : ''}`} style={{ color }}>
                    {b.subtitle ? <p className="etiqueta">{b.subtitle}</p> : null}
                    {b.title ? <h2 className="text-4xl leading-[1.05] md:text-6xl">{b.title}</h2> : null}
                    {b.cta_label && b.link_url ? (
                      <Link href={b.link_url} className={clasesBoton({ variante: 'primario', tamano: 'lg' })} tabIndex={activo ? 0 : -1}>
                        {b.cta_label}
                      </Link>
                    ) : null}
                  </div>
                </div>
              ) : b.link_url ? (
                <Link href={b.link_url} aria-label={b.alt} className="absolute inset-0" tabIndex={activo ? 0 : -1} />
              ) : null}
            </div>
          );
        })}
      </div>

      {n > 1 ? (
        <div className="absolute inset-x-0 bottom-3 flex items-center justify-center gap-1">
          <button type="button" aria-label="Anterior" onClick={() => ir(i - 1)} className="hidden size-11 items-center justify-center md:inline-flex">
            <Icono nombre="chevronIzquierda" />
          </button>
          {banners.map((b, k) => (
            <button
              key={b.id}
              type="button"
              aria-label={`${k + 1} / ${n}`}
              aria-current={k === i}
              onClick={() => ir(k)}
              className="group inline-flex size-11 items-center justify-center"
            >
              <span className={`block h-[3px] rounded-sm bg-ink transition-all ${k === i ? 'w-8' : 'w-4 opacity-45'}`} />
            </button>
          ))}
          <button type="button" aria-label="Siguiente" onClick={() => ir(i + 1)} className="hidden size-11 items-center justify-center md:inline-flex">
            <Icono nombre="chevronDerecha" />
          </button>
        </div>
      ) : null}
    </section>
  );
}
