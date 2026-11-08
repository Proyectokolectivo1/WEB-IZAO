import { BannerFijo } from './home/BannerFijo';
import { Hero } from './home/Hero';
import { T } from '@/lib/store/textos';
import type { Banner, CodigoPais } from '@/lib/store/types';

interface Props {
  banners: Banner[];
  pais: CodigoPais;
  /** Segundos entre imágenes (panel). */
  segundos: number;
  /** La primera imagen está en el primer viewport. */
  prioritaria?: boolean;
  /** Ancla para enlaces del panel a «esta sección de la página». */
  id?: string;
}

/**
 * Carrusel de banners `hero` del home y del catálogo. Con una sola imagen no hay carrusel: se pinta el banner fijo
 * (sin flechas, puntos ni autoavance, y sin cargar el JavaScript del carrusel). Con dos o más entra `Hero`, que
 * solo viaja al navegador en ese caso.
 */
export function CarruselBanners({ banners, pais, segundos, prioritaria = true, id }: Props) {
  if (banners.length === 0) return null;
  if (banners.length === 1) {
    return (
      <section id={id} aria-label={T.home.carrusel} className="mx-auto w-full max-w-[96rem] scroll-mt-24 px-4 pt-3 sm:px-8 sm:pt-4">
        <BannerFijo banner={banners[0]!} ubicacion="hero" pais={pais} prioritaria={prioritaria} />
      </section>
    );
  }
  return (
    <div id={id} className="scroll-mt-24">
      <Hero banners={banners} pais={pais} segundos={segundos} prioritaria={prioritaria} />
    </div>
  );
}
