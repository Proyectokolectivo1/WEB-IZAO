import type { InputHTMLAttributes } from 'react';

/** Campo con etiqueta visible y error asociado (accesible por lector de pantalla). */
export function CampoTexto({
  id,
  etiqueta,
  error,
  ayuda,
  className,
  ...resto
}: {
  id: string;
  etiqueta: string;
  error?: string | undefined;
  ayuda?: string | undefined;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'id'>) {
  const idError = `${id}-error`;
  const idAyuda = `${id}-ayuda`;
  const describedBy = [error ? idError : null, ayuda ? idAyuda : null].filter(Boolean).join(' ');
  return (
    <div className="adm-campo">
      <label htmlFor={id} className="adm-etiqueta">
        {etiqueta}
      </label>
      <input
        id={id}
        className={`adm-input ${className ?? ''}`.trim()}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        {...resto}
      />
      {ayuda ? (
        <p id={idAyuda} className="adm-suave adm-chico">
          {ayuda}
        </p>
      ) : null}
      {error ? (
        <p id={idError} className="adm-error-campo">
          {error}
        </p>
      ) : null}
    </div>
  );
}
