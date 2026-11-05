import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Icono } from '../iconos/Icono';

interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> {
  seleccionado?: boolean;
  onClick?: () => void;
  children: ReactNode;
}

/** Opción seleccionable (variantes, filtros). Es un botón con `aria-pressed`; alto táctil de 44 px. */
export function Chip({ seleccionado = false, className, children, type = 'button', ...resto }: ChipProps) {
  return (
    <button
      type={type}
      aria-pressed={seleccionado}
      className={[
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-control border px-4 text-[0.875rem] transition-colors duration-200',
        seleccionado
          ? 'border-ink bg-ink text-bg'
          : 'border-line bg-transparent text-ink hover:border-ink hover:bg-surface',
        'disabled:cursor-not-allowed disabled:opacity-45 disabled:line-through',
        className ?? '',
      ].join(' ')}
      {...resto}
    >
      {children}
    </button>
  );
}

interface ChipQuitarProps {
  etiqueta: string;
  /** Texto accesible del botón de quitar, p. ej. «Quitar filtro Mujer». */
  etiquetaQuitar: string;
  onQuitar: () => void;
  testId?: string;
}

/** Chip de filtro activo, con botón para quitarlo. */
export function ChipQuitar({ etiqueta, etiquetaQuitar, onQuitar, testId }: ChipQuitarProps) {
  return (
    <span data-testid={testId} className="inline-flex min-h-11 items-center gap-1 rounded-control bg-surface pl-3 text-[0.875rem] text-ink">
      {etiqueta}
      <button
        type="button"
        onClick={onQuitar}
        aria-label={etiquetaQuitar}
        className="inline-flex size-11 items-center justify-center rounded-control hover:bg-accent/40"
      >
        <Icono nombre="cerrar" tamano={16} />
      </button>
    </span>
  );
}

/** Etiqueta informativa (no interactiva): «Nuevo», «Agotado», porcentaje de descuento. */
export function Etiqueta({
  tono = 'suave',
  children,
  className,
}: {
  tono?: 'suave' | 'tinta' | 'peligro';
  children: ReactNode;
  className?: string;
}) {
  const tonos = {
    suave: 'bg-accent text-ink',
    tinta: 'bg-ink text-bg',
    peligro: 'bg-danger text-bg',
  } as const;
  return (
    <span className={`etiqueta inline-block rounded-sm px-2 py-1 ${tonos[tono]} ${className ?? ''}`}>{children}</span>
  );
}
