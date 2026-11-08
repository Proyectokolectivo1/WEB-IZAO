'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Icono, Skeleton, clasesBoton, useMenosMovimiento } from '@izao/ui';
import { CAJA_ANTIGUA, CAJA_UNICA, CARRUSEL_SEGUNDOS, enlaceBanner } from '@/lib/store/banners';
import { T } from '@/lib/store/textos';
import type { Banner, CodigoPais } from '@/lib/store/types';
import { ImagenResponsiva } from '../ImagenResponsiva';

const UMBRAL_DESLIZAR_PX = 48;
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

const POSICION = {
  left: 'items-start text-left',
  center: 'items-center text-center',
  right: 'items-end text-right',
} as const;

const BOTON_FLECHA =
  'absolute top-1/2 z-20 hidden size-11 -translate-y-1/2 items-center justify-center rounded-full bg-bg/90 text-ink shadow-elev transition-colors hover:bg-bg md:inline-flex';

/**
 * Carrusel de banners de la parte superior del home (ubicación `hero`).
 * - Desvanecido (solo `opacity`) con leve *ken burns* en escritorio; la caja reserva la proporción: 4:5 móvil, 12:5 escritorio (sin CLS).
 * - Autoplay con el tiempo del panel (defecto 6 s): se detiene con el puntero encima, con el foco dentro, mientras se toca, con la pestaña oculta, con
 *   `prefers-reduced-motion` y con el botón de pausa (WCAG 2.2.2).
 * - Solo la primera diapositiva pide su imagen con prioridad; las demás se montan cuando les toca (la siguiente se precarga).
 * - Cada banner sigue `link_url` tal cual; si el destino es una ficha (`/…/perfume/{slug}?variante={sku}`) la ficha preselecciona la variante.
 */
export function Hero({
  banners,
  pais,
  segundos = CARRUSEL_SEGUNDOS.defecto,
  prioritaria = true,
}: {
  banners: Banner[];
  pais: CodigoPais;
  /** Tiempo entre imágenes: lo fija el panel (`home_sections.config.interval_seconds`); se acota a 3–30 s. */
  segundos?: number;
  /** La primera imagen es la del primer viewport (LCP). `false` si el carrusel queda más abajo. */
  prioritaria?: boolean;
}) {
  const [i, setI] = useState(0);
  const [encima, setEncima] = useState(false);
  const [tocando, setTocando] = useState(false);
  const [pausadoPorUsuario, setPausadoPorUsuario] = useState(false);
  const [oculta, setOculta] = useState(false);
  // Diapositivas cuya imagen ya se pidió: la primera y, luego, la siguiente a la visible.
  const [montadas, setMontadas] = useState<ReadonlySet<number>>(() => new Set([0]));
  const reducido = useMenosMovimiento();
  const n = banners.length;
  const inicioX = useRef<number | null>(null);
  const deslizo = useRef(false);

  const detenido = encima || tocando || pausadoPorUsuario || oculta || reducido;

  const ir = useCallback(
    (k: number) => {
      setI(((k % n) + n) % n);
    },
    [n],
  );

  useEffect(() => {
    if (n < 2 || detenido) return;
    const ms = Math.min(CARRUSEL_SEGUNDOS.maximo, Math.max(CARRUSEL_SEGUNDOS.minimo, Number.isFinite(segundos) ? segundos : CARRUSEL_SEGUNDOS.defecto)) * 1000;
    const t = setInterval(() => setI((x) => (x + 1) % n), ms);
    return () => clearInterval(t);
  }, [n, detenido, segundos]);

  useEffect(() => {
    const alCambiar = () => setOculta(document.hidden);
    document.addEventListener('visibilitychange', alCambiar);
    return () => document.removeEventListener('visibilitychange', alCambiar);
  }, []);

  // Monta la diapositiva visible y la siguiente (así el cambio nunca muestra un hueco).
  useEffect(() => {
    if (n < 2) return;
    setMontadas((prev) => {
      const sig = new Set(prev);
      sig.add(i);
      sig.add((i + 1) % n);
      return sig.size === prev.size ? prev : sig;
    });
  }, [i, n]);

  if (n === 0) return null;

  return (
    <section
      aria-roledescription="carrusel"
      aria-label={T.home.carrusel}
      data-testid="hero-carrusel"
      className="relative mx-auto w-full max-w-[96rem] px-4 pt-3 sm:px-8 sm:pt-4"
      onMouseEnter={() => setEncima(true)}
      onMouseLeave={() => setEncima(false)}
      onFocus={() => setEncima(true)}
      onBlur={() => setEncima(false)}
      onKeyDown={(e) => {
        // Flechas del teclado con el foco dentro del carrusel (no roba las del campo de texto de otra parte: solo aplica aquí).
        if (n < 2 || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
        e.preventDefault();
        ir(i + (e.key === 'ArrowRight' ? 1 : -1));
      }}
    >
      <div
        className="relative touch-pan-y select-none overflow-hidden rounded-panel bg-surface"
        onPointerDown={(e) => {
          inicioX.current = e.clientX;
          deslizo.current = false;
          if (e.pointerType !== 'mouse') setTocando(true);
        }}
        onPointerUp={(e) => {
          if (inicioX.current !== null && n > 1) {
            const dx = e.clientX - inicioX.current;
            if (Math.abs(dx) > UMBRAL_DESLIZAR_PX) {
              deslizo.current = true;
              ir(i + (dx < 0 ? 1 : -1));
            }
          }
          inicioX.current = null;
          setTocando(false);
        }}
        onPointerCancel={() => {
          inicioX.current = null;
          setTocando(false);
        }}
        // Un deslizamiento no debe abrir el enlace del banner.
        onClickCapture={(e) => {
          if (deslizo.current) {
            e.preventDefault();
            e.stopPropagation();
            deslizo.current = false;
          }
        }}
        aria-live={detenido ? 'polite' : 'off'}
      >
        <div className="grid">
          {banners.map((b, k) => {
            const activo = k === i;
            const color = b.text_color && HEX.test(b.text_color) ? b.text_color : undefined;
            const destino = enlaceBanner(b.link_url, pais);
            // El texto del enlace es lo que se ve: el botón, o el título si no hay botón.
            const textoEnlace = b.cta_label ?? b.title;
            return (
              <div
                key={b.id}
                role="group"
                aria-roledescription="diapositiva"
                aria-label={T.home.diapositivaN(k + 1, n)}
                aria-hidden={!activo}
                inert={!activo}
                data-testid="hero-diapositiva"
                className={`relative [grid-area:1/1] overflow-hidden transition-opacity duration-700 ease-izao motion-reduce:transition-none ${b.imagen_unica ? CAJA_UNICA.hero.clase : CAJA_ANTIGUA.hero} ${
                  activo ? 'opacity-100' : 'pointer-events-none opacity-0'
                }`}
              >
                <div className={`h-full w-full transition-transform duration-[7000ms] ease-linear motion-reduce:transition-none ${activo && !reducido ? 'md:scale-[1.04]' : 'scale-100'}`}>
                  {montadas.has(k) ? (
                    <ImagenResponsiva banner={b} ubicacion="hero" prioritaria={prioritaria && k === 0} />
                  ) : (
                    <Skeleton className="h-full w-full rounded-none" />
                  )}
                </div>

                {b.title || b.subtitle || b.cta_label ? (
                  <div className="absolute inset-0 flex flex-col justify-end px-6 pb-16 sm:px-10 md:justify-center md:px-20 md:pb-0">
                    <div
                      className={`flex max-w-xl flex-col gap-4 ${POSICION[b.text_position]} ${b.text_position === 'right' ? 'ml-auto' : b.text_position === 'center' ? 'mx-auto' : ''}`}
                      style={{ color }}
                    >
                      {b.subtitle ? <p className="etiqueta">{b.subtitle}</p> : null}
                      {b.title ? (
                        <h2 className="text-4xl leading-[1.05] md:text-6xl">
                          {destino && !b.cta_label ? (
                            <Link href={destino} tabIndex={activo ? 0 : -1} className="inline-flex min-h-11 items-center after:absolute after:inset-0 after:content-['']">
                              {b.title}
                            </Link>
                          ) : (
                            b.title
                          )}
                        </h2>
                      ) : null}
                      {b.cta_label ? (
                        destino ? (
                          <Link
                            href={destino}
                            tabIndex={activo ? 0 : -1}
                            className={`${clasesBoton({ variante: 'primario', tamano: 'lg' })} after:absolute after:inset-0 after:content-['']`}
                          >
                            {b.cta_label}
                          </Link>
                        ) : null
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {/* Sin texto visible, toda la imagen es el enlace y su nombre es el texto alternativo. */}
                {destino && !textoEnlace ? <Link href={destino} aria-label={b.alt} className="absolute inset-0" tabIndex={activo ? 0 : -1} /> : null}
              </div>
            );
          })}
        </div>

        {n > 1 ? (
          <>
            <button type="button" aria-label={T.home.anterior} onClick={() => ir(i - 1)} className={`${BOTON_FLECHA} left-4`}>
              <Icono nombre="chevronIzquierda" />
            </button>
            <button type="button" aria-label={T.home.siguiente} onClick={() => ir(i + 1)} className={`${BOTON_FLECHA} right-4`}>
              <Icono nombre="chevronDerecha" />
            </button>
          </>
        ) : null}
      </div>

      {n > 1 ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center px-4 sm:bottom-4">
          <div className="pointer-events-auto flex items-center gap-0.5 rounded-full bg-bg/90 px-1.5 shadow-elev">
            <button
              type="button"
              aria-label={pausadoPorUsuario ? T.home.reanudar : T.home.pausar}
              aria-pressed={pausadoPorUsuario}
              onClick={() => setPausadoPorUsuario((p) => !p)}
              className="inline-flex size-11 items-center justify-center rounded-full"
            >
              <Icono nombre={pausadoPorUsuario ? 'reproducir' : 'pausa'} tamano={18} />
            </button>
            {banners.map((b, k) => (
              <button
                key={b.id}
                type="button"
                aria-label={T.home.diapositivaN(k + 1, n)}
                aria-current={k === i}
                data-testid="hero-punto"
                onClick={() => ir(k)}
                className="inline-flex size-11 items-center justify-center rounded-full"
              >
                <span className={`block h-[3px] rounded-full bg-ink transition-all motion-reduce:transition-none ${k === i ? 'w-8' : 'w-4 opacity-45'}`} />
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
