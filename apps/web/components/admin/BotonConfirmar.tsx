'use client';

import { useState, useTransition } from 'react';
import type { ResultadoAccion } from '@/lib/admin/crud/comun';

/**
 * Acción destructiva con confirmación explícita en dos pasos (skill del panel).
 * `accion` es una Server Action ya enlazada a su id; si falla muestra el motivo.
 */
export function BotonConfirmar({
  etiqueta,
  mensaje,
  etiquetaConfirmar,
  accion,
  peligro = true,
}: {
  etiqueta: string;
  mensaje: string;
  etiquetaConfirmar: string;
  accion: () => Promise<ResultadoAccion | void>;
  peligro?: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  if (!abierto) {
    return (
      <button type="button" className="adm-boton adm-boton-secundario" onClick={() => setAbierto(true)}>
        {etiqueta}
      </button>
    );
  }
  return (
    <div className="adm-alerta" role="alertdialog" aria-label={etiqueta}>
      <p>{mensaje}</p>
      {error ? (
        <p className="adm-error-campo" role="alert">
          {error}
        </p>
      ) : null}
      <div className="adm-acciones" style={{ marginTop: '0.75rem' }}>
        <button
          type="button"
          className={`adm-boton ${peligro ? 'adm-boton-peligro' : ''}`.trim()}
          disabled={pendiente}
          onClick={() =>
            iniciar(async () => {
              const r = await accion();
              if (r && !r.ok) setError(r.mensaje ?? 'No se pudo completar la acción.');
            })
          }
        >
          {pendiente ? 'Procesando…' : etiquetaConfirmar}
        </button>
        <button type="button" className="adm-boton adm-boton-secundario" onClick={() => setAbierto(false)}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
