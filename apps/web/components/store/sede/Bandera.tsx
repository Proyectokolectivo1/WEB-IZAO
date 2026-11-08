import type { CodigoPais } from '@/lib/store/types';

/**
 * Banderas dibujadas a mano (no son logos de marcas). Los colores salen de la clase `.bandera` de `tokens.css`.
 * Decorativas: el nombre del país siempre va en texto al lado.
 */
export function Bandera({ pais, className = '' }: { pais: CodigoPais; className?: string }) {
  return (
    <svg viewBox="0 0 36 24" aria-hidden="true" focusable="false" className={`bandera block h-auto rounded-control ${className}`}>
      <rect width="36" height="12" className="b-amarillo" />
      <rect y="12" width="36" height="6" className="b-azul" />
      <rect y="18" width="36" height="6" className="b-rojo" />
      {pais === 'ec' ? (
        <g>
          {/* Escudo sencillo: óvalo con montaña y sol, sin detalles que imiten un emblema oficial. */}
          <ellipse cx="18" cy="12" rx="4.6" ry="5.6" className="b-azul" />
          <ellipse cx="18" cy="12" rx="3.7" ry="4.7" className="b-verde" />
          <path d="M14.6 14.6 17.4 10.4l1.6 2.1 1.2-1.5 1.2 3.6z" className="b-tierra" />
          <circle cx="18" cy="9" r="1.3" className="b-amarillo" />
        </g>
      ) : null}
    </svg>
  );
}
