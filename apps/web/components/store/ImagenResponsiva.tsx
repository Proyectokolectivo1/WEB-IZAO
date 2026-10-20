import { rutasDeMedio, type MediaJson } from '@izao/ui';

interface Props {
  escritorio: MediaJson;
  movil: MediaJson;
  alt: string;
  /** Solo para la imagen LCP del hero. */
  prioritaria?: boolean;
  className?: string;
  sizes?: string;
}

/**
 * `<picture>` con la variante de escritorio desde 768 px y la móvil por debajo (banners, §9.1).
 * El contenedor del padre fija la proporción; la imagen la cubre.
 */
export function ImagenResponsiva({ escritorio, movil, alt, prioritaria = false, className = '', sizes = '100vw' }: Props) {
  const d = rutasDeMedio(escritorio);
  const m = rutasDeMedio(movil);
  const base = m ?? d;
  if (!base) return <div role="img" aria-label={alt} className={`h-full w-full bg-surface ${className}`} />;
  return (
    <picture>
      {d ? <source media="(min-width: 768px)" srcSet={d.srcSet} sizes={sizes} /> : null}
      <img
        src={base.src}
        srcSet={m?.srcSet}
        sizes={sizes}
        alt={alt}
        loading={prioritaria ? 'eager' : 'lazy'}
        fetchPriority={prioritaria ? 'high' : undefined}
        decoding={prioritaria ? 'sync' : 'async'}
        className={`h-full w-full object-cover ${className}`}
        style={{ backgroundColor: 'var(--color-surface)', backgroundImage: movil.lqip ? `url("${movil.lqip}")` : undefined, backgroundSize: 'cover' }}
      />
    </picture>
  );
}
