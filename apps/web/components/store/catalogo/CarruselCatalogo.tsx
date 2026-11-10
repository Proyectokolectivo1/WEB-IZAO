import { tienda } from '@/lib/store/datos';
import type { CodigoPais } from '@/lib/store/types';
import { CarruselBanners } from '../CarruselBanners';

/**
 * Banners del carrusel que van arriba del catálogo, o `null` si el panel lo apaga para el catálogo, no hay banners o la
 * base falla (el listado no depende de él). La página lo lee una vez para pintar el carrusel y para saber si la foto del
 * banner es la imagen LCP (entonces ninguna tarjeta pide su foto con prioridad).
 */
export async function leerCarruselCatalogo(pais: CodigoPais) {
  const carrusel = await tienda()
    .carrusel(pais)
    .catch(() => null);
  return carrusel?.enCatalogo && carrusel.banners.length > 0 ? carrusel : null;
}

/** Carrusel de banners arriba del catálogo: los mismos banners `hero` que el home, con el tiempo entre imágenes que fija el panel. */
export function CarruselCatalogo({ pais, carrusel }: { pais: CodigoPais; carrusel: NonNullable<Awaited<ReturnType<typeof leerCarruselCatalogo>>> }) {
  return <CarruselBanners id="carrusel-catalogo" banners={carrusel.banners} pais={pais} segundos={carrusel.segundos} />;
}
