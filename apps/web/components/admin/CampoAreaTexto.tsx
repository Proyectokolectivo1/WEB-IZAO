import type { TextareaHTMLAttributes } from 'react';

export function CampoAreaTexto({
  id,
  etiqueta,
  error,
  ayuda,
  ...resto
}: {
  id: string;
  etiqueta: string;
  error?: string | undefined;
  ayuda?: string | undefined;
} & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'>) {
  const describedBy = [error ? `${id}-error` : null, ayuda ? `${id}-ayuda` : null].filter(Boolean).join(' ');
  return (
    <div className="adm-campo">
      <label htmlFor={id} className="adm-etiqueta">
        {etiqueta}
      </label>
      <textarea
        id={id}
        className="adm-input adm-textarea"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        {...resto}
      />
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
