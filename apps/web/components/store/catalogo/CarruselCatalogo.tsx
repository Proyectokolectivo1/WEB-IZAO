import { tienda } from '@/lib/store/datos';
import type { CodigoPais } from '@/lib/store/types';
import { CarruselBanners } from '../CarruselBanners';

/**
 * Carrusel de banners arriba del catálogo: los mismos banners `hero` que el home, con el tiempo entre imágenes que fija
 * el panel. Si el panel lo apaga para el catálogo, no hay banners o la base falla, no pinta nada (el listado no depende de él).
 */
export async function CarruselCatalogo({ pais }: { pais: CodigoPais }) {
  const carrusel = await tienda()
    .carrusel(pais)
    .catch(() => null);
  if (!carrusel?.enCatalogo || carrusel.banners.length === 0) return null;
  return <CarruselBanners id="carrusel-catalogo" banners={carrusel.banners} pais={pais} segundos={carrusel.segundos} />;
}
