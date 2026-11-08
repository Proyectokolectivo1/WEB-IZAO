import Link from 'next/link';
import { clasesBoton } from '@izao/ui';
import { CAJA_ANTIGUA, CAJA_UNICA, enlaceBanner, type UbicacionBanner } from '@/lib/store/banners';
import type { Banner, CodigoPais } from '@/lib/store/types';
import { ImagenResponsiva } from '../ImagenResponsiva';

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

const POSICION = {
  left: 'items-start text-left',
  center: 'items-center text-center',
  right: 'items-end text-right ml-auto',
} as const;

/**
 * Banner fijo (ubicaciones `mid` y `category`, y `hero` cuando el carrusel tiene una sola imagen: sin JavaScript de carrusel). Todo el recuadro es un enlace a `link_url` (tal cual lo guarda el panel);
 * el nombre accesible es el texto visible (botón o título) o, sin texto, el alternativo de la imagen.
 */
export function BannerFijo({
  banner: b,
  ubicacion,
  pais,
  prioritaria = false,
}: {
  banner: Banner;
  ubicacion: UbicacionBanner;
  pais: CodigoPais;
  /** Imagen del primer viewport (p. ej. un carrusel de una sola imagen arriba de la página). */
  prioritaria?: boolean;
}) {
  const destino = enlaceBanner(b.link_url, pais);
  const color = b.text_color && HEX.test(b.text_color) ? b.text_color : undefined;
  const textoEnlace = b.cta_label ?? b.title;
  const tieneTexto = Boolean(b.title || b.subtitle || b.cta_label);

  return (
    <div className={`relative overflow-hidden rounded-panel bg-surface ${b.imagen_unica ? CAJA_UNICA[ubicacion].clase : CAJA_ANTIGUA[ubicacion]}`} data-testid={`banner-${ubicacion}`}>
      <ImagenResponsiva banner={b} ubicacion={ubicacion} prioritaria={prioritaria} />
      {tieneTexto ? (
        <div className="absolute inset-0 flex flex-col justify-center px-6 sm:px-10 lg:px-16">
          <div className={`flex max-w-lg flex-col gap-3 ${POSICION[b.text_position]} ${b.text_position === 'center' ? 'mx-auto' : ''}`} style={{ color }}>
            {b.subtitle ? <p className="etiqueta">{b.subtitle}</p> : null}
            {b.title ? (
              <h2 className="text-3xl leading-[1.05] md:text-5xl">
                {destino && !b.cta_label ? (
                  <Link href={destino} className="inline-flex min-h-11 items-center after:absolute after:inset-0 after:content-['']">
                    {b.title}
                  </Link>
                ) : (
                  b.title
                )}
              </h2>
            ) : null}
            {b.cta_label && destino ? (
              <Link href={destino} className={`${clasesBoton({ tamano: 'lg' })} w-fit after:absolute after:inset-0 after:content-['']`}>
                {b.cta_label}
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}
      {destino && !textoEnlace ? <Link href={destino} aria-label={b.alt} className="absolute inset-0" /> : null}
    </div>
  );
}
