import { rutasDeMedio, type MediaJson } from '@izao/ui';
import { puntoFocal, sizesImagenUnica, type UbicacionBanner } from '@/lib/store/banners';
import type { Banner } from '@/lib/store/types';

interface Props {
  banner: Pick<Banner, 'desktop' | 'mobile' | 'alt' | 'imagen_unica' | 'focal_x' | 'focal_y'>;
  ubicacion: UbicacionBanner;
  /** Solo para la imagen LCP del hero. */
  prioritaria?: boolean;
  className?: string;
}

// El banner va dentro del contenedor de la página (máx. 96 rem menos el relleno).
const SIZES_ANTIGUO = '(min-width: 1536px) 1472px, (min-width: 640px) calc(100vw - 4rem), calc(100vw - 2rem)';

const fondo = (m: MediaJson) => ({ backgroundColor: 'var(--color-surface)', backgroundImage: m.lqip ? `url("${m.lqip}")` : undefined, backgroundSize: 'cover' as const });

/**
 * Imagen de un banner (§9.1, D-047). El contenedor del padre fija la proporción por breakpoint; la imagen la cubre.
 * - Una sola imagen (banner nuevo): un `<img srcset>` con los anchos de `desktop.variants`, `width`/`height` del original
 *   y `object-position` según el punto focal para decidir qué se recorta en pantallas angostas.
 * - Banner antiguo con imagen móvil propia: `<picture>` con la móvil bajo 768 px y la de escritorio de respaldo.
 */
export function ImagenResponsiva({ banner, ubicacion, prioritaria = false, className = '' }: Props) {
  const { desktop, mobile, alt } = banner;
  const d = rutasDeMedio(desktop);
  const prio = { loading: prioritaria ? ('eager' as const) : ('lazy' as const), fetchPriority: prioritaria ? ('high' as const) : undefined, decoding: prioritaria ? ('sync' as const) : ('async' as const) };

  if (banner.imagen_unica || !rutasDeMedio(mobile)) {
    if (!d) return <div role="img" aria-label={alt} className={`h-full w-full bg-surface ${className}`} />;
    const ancho = desktop.width && desktop.height ? desktop.width : undefined;
    const alto = ancho ? desktop.height ?? undefined : undefined;
    return (
      <img
        src={d.src}
        srcSet={d.srcSet}
        sizes={sizesImagenUnica(ubicacion, null)}
        width={ancho}
        height={alto}
        alt={alt}
        {...prio}
        className={`img-esqueleto h-full w-full object-cover ${className}`}
        style={{ ...fondo(desktop), objectPosition: puntoFocal(banner) }}
      />
    );
  }

  const m = rutasDeMedio(mobile)!;
  return (
    <picture>
      {d ? <source media="(min-width: 768px)" srcSet={d.srcSet} sizes={SIZES_ANTIGUO} /> : null}
      <img src={m.src} srcSet={m.srcSet} sizes={SIZES_ANTIGUO} alt={alt} {...prio} className={`img-esqueleto h-full w-full object-cover ${className}`} style={fondo(mobile)} />
    </picture>
  );
}
