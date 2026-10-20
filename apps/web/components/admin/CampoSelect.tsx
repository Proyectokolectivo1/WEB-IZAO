import type { SelectHTMLAttributes } from 'react';

export type OpcionSelect = { valor: string; etiqueta: string };

export function CampoSelect({
  id,
  etiqueta,
  opciones,
  vacio,
  error,
  ayuda,
  ...resto
}: {
  id: string;
  etiqueta: string;
  opciones: readonly OpcionSelect[];
  /** Texto de la opción sin valor (p. ej. "Sin marca"). Si falta, no hay opción vacía. */
  vacio?: string;
  error?: string | undefined;
  ayuda?: string | undefined;
} & Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'>) {
  const describedBy = [error ? `${id}-error` : null, ayuda ? `${id}-ayuda` : null].filter(Boolean).join(' ');
  return (
    <div className="adm-campo">
      <label htmlFor={id} className="adm-etiqueta">
        {etiqueta}
      </label>
      <select
        id={id}
        className="adm-input"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        {...resto}
      >
        {vacio !== undefined ? <option value="">{vacio}</option> : null}
        {opciones.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.etiqueta}
          </option>
        ))}
      </select>
      {ayuda ? (
        <p id={`${id}-ayuda`} className="adm-suave adm-chico">
          {ayuda}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="adm-error-campo">
          {error}
        </p>
      ) : null}
    </div>
  );
}
