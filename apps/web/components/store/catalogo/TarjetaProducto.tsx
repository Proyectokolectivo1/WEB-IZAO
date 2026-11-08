'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { memo, useEffect, useRef, useState } from 'react';
import { Button, Etiqueta, Icono, IzaoImage, rutasDeMedio } from '@izao/ui';
import { lineaDe } from '@/lib/store/ficha-util';
import { formatearPrecio } from '@/lib/store/pais';
import { T } from '@/lib/store/textos';
import type { CodigoPais, ItemCatalogo } from '@/lib/store/types';
import { useCarritoAcciones, useDeseo } from '../carrito/CarritoProvider';
import { pedirFicha } from './useFicha';

const VistaRapida = dynamic(() => import('./VistaRapida').then((m) => m.VistaRapida), { ssr: false });

interface Props {
  item: ItemCatalogo;
  pais: CodigoPais;
  /** Nombre de la concentración (del filtro), p. ej. «Eau de parfum». */
  concentracion?: string | null;
  /** Primeras tarjetas de la página: cargan ansiosas (LCP). */
  prioritaria?: boolean;
  /** Nivel del nombre: `h2` en listados (bajo el `h1` de la página), `h3` dentro de una sección con su propio `h2`. */
  nivelTitulo?: 'h2' | 'h3';
}

const norm = (b: string) => b.toLowerCase().replace(/[\s-]+/g, '_');
const TAMANOS = '(min-width:1536px) 18vw, (min-width:1024px) 23vw, (min-width:768px) 31vw, 47vw';

/**
 * `memo`: la grilla puede tener cientos de tarjetas y no deben repintarse cuando cambia el bolso, otro deseo o el estado del
 * listado (cargando, scroll). Solo se actualiza la tarjeta cuyo producto cambió.
 */
export const TarjetaProducto = memo(function TarjetaProducto({ item, pais, concentracion, prioritaria = false, nivelTitulo = 'h3' }: Props) {
  const Titulo = nivelTitulo;
  const { agregar, alternarDeseo } = useCarritoAcciones();
  const guardado = useDeseo(item.product_id);
  const [hoverListo, setHoverListo] = useState(false);
  const [pagina, setPagina] = useState(0);
  const [vista, setVista] = useState(false);
  const [vistaMontada, setVistaMontada] = useState(false);
  const [estado, setEstado] = useState<'reposo' | 'cargando' | 'agregado' | 'error'>('reposo');
  const carrusel = useRef<HTMLDivElement>(null);
  const hayHover = !!item.img_hover;
  const sinFoto = !rutasDeMedio(item.img_primary);
  const badges = new Set(item.badges.map(norm));
  const href = `/${pais}/perfume/${item.slug}`;

  // La imagen hover se pide cuando el navegador está ocioso (solo con ratón) o en el primer pointerenter.
  useEffect(() => {
    if (!hayHover || hoverListo || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    const id = w.requestIdleCallback ? w.requestIdleCallback(() => setHoverListo(true), { timeout: 4000 }) : window.setTimeout(() => setHoverListo(true), 2500);
    return () => (w.cancelIdleCallback ? w.cancelIdleCallback(id) : clearTimeout(id));
  }, [hayHover, hoverListo]);

  useEffect(() => {
    if (estado !== 'agregado') return;
    const t = setTimeout(() => setEstado('reposo'), 2200);
    return () => clearTimeout(t);
  }, [estado]);

  async function alAgregar() {
    if (item.variant_count > 1) return abrirVista();
    setEstado('cargando');
    const f = await pedirFicha(pais, item.slug);
    if (!f) return setEstado('error');
    const disponibles = f.variants.filter((v) => v.in_stock);
    if (f.variants.length === 1 && disponibles.length === 1) {
      agregar(lineaDe(f, disponibles[0]!));
      setEstado('agregado');
    } else {
      setEstado('reposo');
      abrirVista();
    }
  }

  function abrirVista() {
    setVistaMontada(true);
    setVista(true);
  }

  const precioDesde = item.max_price > item.min_price;
  const textoBoton =
    estado === 'agregado' ? T.tarjeta.agregado : item.variant_count > 1 ? T.tarjeta.elegirOpcion : T.tarjeta.agregar;

  return (
    <article
      data-testid="tarjeta-producto"
      data-product-id={item.product_id}
      data-slug={item.slug}
      className="diferir group relative flex flex-col"
      onPointerEnter={() => hayHover && setHoverListo(true)}
    >
      <div className="sombra-tarjeta relative aspect-[4/5] overflow-hidden rounded-card bg-surface transition-shadow duration-500 ease-izao">
        <Link href={href} aria-label={item.name} className="absolute inset-0 block">
          {/* Ratón: crossfade 450 ms con leve zoom */}
          <div className="absolute inset-0 hidden transition-transform duration-[450ms] ease-izao raton:block raton:group-hover:scale-[1.03]">
            <IzaoImage
              media={item.img_primary}
              alt={item.img_primary?.alt ?? item.name}
              sizes={TAMANOS}
              prioritaria={prioritaria}
              className="h-full object-cover"
              data-testid="tarjeta-imagen-principal"
            />
            {hayHover && hoverListo ? (
              <IzaoImage
                media={item.img_hover}
                alt=""
                sizes={TAMANOS}
                className="absolute inset-0 h-full object-cover opacity-0 transition-opacity duration-[450ms] ease-izao group-hover:opacity-100"
                data-testid="tarjeta-imagen-hover"
              />
            ) : null}
          </div>
          {/* Táctil: deslizar entre las 2 primeras imágenes */}
          <div
            ref={carrusel}
            className="sin-scroll-visible absolute inset-0 flex snap-x snap-mandatory overflow-x-auto raton:hidden"
            onScroll={(e) => setPagina(Math.round(e.currentTarget.scrollLeft / Math.max(e.currentTarget.clientWidth, 1)))}
          >
            <div className="h-full w-full shrink-0 snap-start">
              <IzaoImage
                media={item.img_primary}
                alt={item.img_primary?.alt ?? item.name}
                sizes={TAMANOS}
                prioritaria={prioritaria}
                className="h-full object-cover"
              />
            </div>
            {hayHover ? (
              <div className="h-full w-full shrink-0 snap-start">
                <IzaoImage media={item.img_hover} alt="" sizes={TAMANOS} className="h-full object-cover" />
              </div>
            ) : null}
          </div>
        </Link>

        {sinFoto ? (
          // Sin foto no se deja una caja vacía: papel con textura y una gota de aroma.
          <span aria-hidden="true" className="textura-calida pointer-events-none absolute inset-0 grid place-items-center">
            <Icono nombre="gota" tamano={44} className="text-ink/25" />
          </span>
        ) : null}

        {hayHover ? (
          <div data-testid="tarjeta-puntos" className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center gap-1.5 raton:hidden" role="img" aria-label={T.tarjeta.imagenN(pagina + 1, 2)}>
            {[0, 1].map((k) => (
              <span key={k} className={`size-1.5 rounded-full ${pagina === k ? 'bg-ink' : 'bg-ink/35'}`} />
            ))}
          </div>
        ) : null}

        <div className="pointer-events-none absolute left-2 top-2 flex flex-col items-start gap-1">
          {!item.in_stock ? <Etiqueta tono="peligro">{T.tarjeta.agotado}</Etiqueta> : null}
          {item.in_stock && item.discount_pct ? <Etiqueta tono="tinta">{T.tarjeta.descuento(item.discount_pct)}</Etiqueta> : null}
          {badges.has('new') || badges.has('nuevo') ? <Etiqueta>{T.tarjeta.nuevo}</Etiqueta> : null}
          {badges.has('hot_sale') ? <Etiqueta>{T.tarjeta.hotSale}</Etiqueta> : null}
        </div>

        <button
          type="button"
          onClick={() => alternarDeseo(item.product_id)}
          aria-pressed={guardado}
          aria-label={T.tarjeta.deseo}
          className="absolute right-0 top-0 inline-flex size-11 items-center justify-center"
        >
          <Icono nombre="corazon" className={guardado ? 'fill-ink' : ''} />
        </button>
        <button
          type="button"
          data-testid="boton-vista-rapida"
          onClick={abrirVista}
          aria-label={T.tarjeta.vistaRapidaDe(item.name)}
          aria-haspopup="dialog"
          className="absolute bottom-0 right-0 inline-flex size-11 items-center justify-center transition-opacity raton:opacity-0 raton:group-focus-within:opacity-100 raton:group-hover:opacity-100"
        >
          <Icono nombre="ojo" />
        </button>
      </div>

      <div className="flex h-[7.25rem] flex-col pt-3">
        <p className="etiqueta truncate text-ink/75">{[item.brand_name, concentracion].filter(Boolean).join(' · ')}</p>
        <Titulo className="mt-1 text-xl leading-tight">
          {/* Objetivo táctil de 44 px (§8.8) sin mover el diseño: el relleno se compensa con margen negativo. */}
          <Link href={href} className="-my-2.5 line-clamp-2 block py-2.5 underline-offset-4 hover:underline">
            {item.name}
          </Link>
        </Titulo>
        <p className="mt-auto flex flex-wrap items-baseline gap-x-2 text-[0.9375rem]">
          {precioDesde ? <span className="text-ink/70">{T.tarjeta.desdePrecio}</span> : null}
          <span className="text-[1.0625rem] font-semibold tabular-nums">{formatearPrecio(item.min_price, pais)}</span>
          {item.compare_at_price && item.compare_at_price > item.min_price ? (
            <s className="text-[0.875rem] text-ink/70 tabular-nums">{formatearPrecio(item.compare_at_price, pais)}</s>
          ) : null}
        </p>
      </div>

      <Button
        variante="secundario"
        bloque
        className="mt-1"
        data-testid="boton-agregar"
        disabled={!item.in_stock || estado === 'cargando'}
        onClick={alAgregar}
      >
        {estado === 'agregado' ? <Icono nombre="check" tamano={16} /> : null}
        {!item.in_stock ? T.tarjeta.agotado : estado === 'error' ? T.listado.reintentar : textoBoton}
      </Button>

      {vistaMontada ? <VistaRapida pais={pais} slug={item.slug} abierto={vista} onCerrar={() => setVista(false)} /> : null}
    </article>
  );
});
