import type { ButtonHTMLAttributes } from 'react';

export type VarianteBoton = 'primario' | 'secundario' | 'texto';
export type TamanoBoton = 'md' | 'lg' | 'sm';

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-control text-[0.9375rem] font-semibold tracking-wide ' +
  'transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50 select-none';

const VARIANTES: Record<VarianteBoton, string> = {
  primario: 'bg-ink text-bg hover:bg-ink-hover border border-ink',
  secundario: 'border border-ink/25 bg-surface/60 text-ink hover:border-ink hover:bg-ink hover:text-bg',
  texto: 'border border-transparent bg-transparent text-ink underline underline-offset-4 hover:bg-surface',
};

// El mínimo táctil es 44 px en todos los tamaños (§8.8).
const TAMANOS: Record<TamanoBoton, string> = {
  sm: 'min-h-11 px-4',
  md: 'min-h-11 px-6',
  lg: 'min-h-12 px-8',
};

interface OpcionesClase {
  variante?: VarianteBoton;
  tamano?: TamanoBoton;
  bloque?: boolean;
  className?: string;
}

/** Clases del botón, para aplicarlas también a enlaces (`<Link>`, `<a>`). */
export function clasesBoton({ variante = 'primario', tamano = 'md', bloque, className }: OpcionesClase = {}): string {
  return [BASE, VARIANTES[variante], TAMANOS[tamano], bloque ? 'w-full' : '', className ?? '']
    .filter(Boolean)
    .join(' ');
}

interface Props extends ButtonHTMLAttributes<HTMLButtonElement>, OpcionesClase {}

export function Button({ variante, tamano, bloque, className, type = 'button', ...resto }: Props) {
  return <button type={type} className={clasesBoton({ variante, tamano, bloque, className })} {...resto} />;
}
