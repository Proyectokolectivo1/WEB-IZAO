import type { ReactNode } from 'react';

/** Clases de un control de formulario: 44 px mínimo, borde fino, fondo champaña al enfocar (§8.1). */
export const CLASE_CONTROL =
  'min-h-12 w-full rounded-control border border-line bg-bg px-3 text-base text-ink placeholder:text-ink/50 ' +
  'focus:bg-surface disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-danger';

/** Atributos de accesibilidad de un control: error y ayuda asociados por `aria-describedby`. */
export function propsControl(id: string, error?: string, ayuda?: string) {
  const ids = [error ? `${id}-error` : null, ayuda ? `${id}-ayuda` : null].filter(Boolean).join(' ');
  return {
    id,
    'aria-invalid': error ? (true as const) : undefined,
    'aria-describedby': ids || undefined,
  };
}

interface Props {
  id: string;
  etiqueta: string;
  error?: string;
  ayuda?: string;
  className?: string;
  children: ReactNode;
}

/** Etiqueta + control + ayuda + error. El error se anuncia (`role="alert"` no: lo recoge el resumen de errores). */
export function Campo({ id, etiqueta, error, ayuda, className, children }: Props) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-2 block text-[0.9375rem] font-medium">
        {etiqueta}
      </label>
      {children}
      {ayuda ? (
        <p id={`${id}-ayuda`} className="pt-1.5 text-[0.875rem] text-ink/80">
          {ayuda}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="pt-1.5 text-[0.875rem] text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Numeración editorial de los pasos (01, 02…), en la fuente de cuerpo y no en la de títulos. */
export function NumeroPaso({ n }: { n: string }) {
  return (
    <span className="etiqueta" style={{ fontFamily: 'var(--font-body)' }} aria-hidden="true">
      {n}
    </span>
  );
}
