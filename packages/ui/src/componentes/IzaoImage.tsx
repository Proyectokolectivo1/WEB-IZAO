import type { CSSProperties, ImgHTMLAttributes } from 'react';

/** Forma de `media` tal como llega de la base (`variants`: ancho → ruta relativa a /media/). */
export interface MediaJson {
  variants?: Record<string, string> | null;
  lqip?: string | null;
  alt?: string | null;
  width?: number | null;
  height?: number | null;
}

interface Props extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'srcSet' | 'alt' | 'width' | 'height'> {
  media: MediaJson | null | undefined;
  /** Texto alternativo; si falta usa el del medio. Obligatorio para publicar en el panel. */
  alt: string;
  sizes: string;
  /** Proporción ancho/alto cuando el medio no trae dimensiones, p. ej. 4/5. */
  proporcion?: number;
  /** Solo para la imagen LCP: carga ansiosa y prioridad alta. */
  prioritaria?: boolean;
  raiz?: string;
  /** Radio de las esquinas (tokens): `card` por defecto, `control` para miniaturas pequeñas, `none` si el contenedor ya recorta. */
  redondeo?: 'card' | 'control' | 'none';
}

const REDONDEO = { card: 'rounded-card', control: 'rounded-control', none: '' } as const;

export function rutasDeMedio(media: MediaJson | null | undefined, raiz = '/media/') {
  const entradas = Object.entries(media?.variants ?? {})
    .map(([w, ruta]) => [Number(w), ruta] as const)
    .filter(([w, ruta]) => Number.isFinite(w) && w > 0 && typeof ruta === 'string' && ruta.length > 0)
    .sort((a, b) => a[0] - b[0]);
  if (entradas.length === 0) return null;
  const url = (r: string) => `${raiz}${r.replace(/^\/+/, '')}`;
  return {
    srcSet: entradas.map(([w, r]) => `${url(r)} ${w}w`).join(', '),
    src: url(entradas[Math.min(1, entradas.length - 1)]![1]),
    ancho: entradas[entradas.length - 1]![0],
  };
}

/**
 * Imagen propia: `srcset` con las variantes pregeneradas, LQIP de fondo y dimensiones reservadas.
 * No usa el optimizador de Next (§27). Sin medio, muestra un marcador neutro del mismo tamaño.
 */
export function IzaoImage({
  media,
  alt,
  sizes,
  proporcion = 4 / 5,
  prioritaria = false,
  raiz,
  redondeo = 'card',
  className = '',
  style,
  ...resto
}: Props) {
  const rutas = rutasDeMedio(media, raiz);
  const ratio = media?.width && media?.height ? media.width / media.height : proporcion;
  const radio = REDONDEO[redondeo];
  const caja: CSSProperties = { aspectRatio: String(ratio), ...style };

  if (!rutas) {
    // Relleno sin foto: con texto alternativo es una imagen; sin él es decorativo (`role="img"` sin nombre rompe WCAG).
    return alt ? (
      <div role="img" aria-label={alt} className={`w-full bg-surface ${radio} ${className}`} style={caja} />
    ) : (
      <div aria-hidden="true" className={`w-full bg-surface ${radio} ${className}`} style={caja} />
    );
  }

  const fondo: CSSProperties = media?.lqip
    ? { backgroundImage: `url("${media.lqip}")`, backgroundSize: 'cover', backgroundColor: 'var(--color-surface)' }
    : { backgroundColor: 'var(--color-surface)' };

  return (
    <img
      src={rutas.src}
      srcSet={rutas.srcSet}
      sizes={sizes}
      alt={alt}
      width={media?.width ?? Math.round(rutas.ancho)}
      height={media?.height ?? Math.round(rutas.ancho / ratio)}
      loading={prioritaria ? 'eager' : 'lazy'}
      fetchPriority={prioritaria ? 'high' : undefined}
      decoding={prioritaria ? 'sync' : 'async'}
      className={`block w-full ${radio} ${className}`}
      style={{ ...fondo, ...style }}
      {...resto}
    />
  );
}
