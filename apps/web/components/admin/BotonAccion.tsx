'use client';

import { useState, useTransition } from 'react';
import type { ResultadoAccion } from '@/lib/admin/crud/comun';

/**
 * Botón que ejecuta una Server Action ya enlazada y muestra su mensaje (éxito o error) debajo.
 * Para acciones reversibles; las destructivas usan `BotonConfirmar`.
 */
export function BotonAccion({
  etiqueta,
  procesando = 'Procesando…',
  accion,
  secundario = true,
  deshabilitado = false,
}: {
  etiqueta: string;
  procesando?: string;
  accion: () => Promise<ResultadoAccion>;
  secundario?: boolean;
  deshabilitado?: boolean;
}) {
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pendiente, iniciar] = useTransition();
  return (
    <div>
      <button
        type="button"
        className={`adm-boton ${secundario ? 'adm-boton-secundario' : ''}`.trim()}
        disabled={pendiente || deshabilitado}
        onClick={() =>
          iniciar(async () => {
            const r = await accion();
            setAviso({ ok: r.ok, texto: r.mensaje ?? (r.ok ? 'Listo.' : 'No se pudo completar la acción.') });
          })
        }
      >
        {pendiente ? procesando : etiqueta}
      </button>
      {aviso ? (
        <p className={aviso.ok ? 'adm-ok' : 'adm-alerta'} role={aviso.ok ? 'status' : 'alert'} style={{ overflowWrap: 'anywhere' }}>
          {aviso.texto}
        </p>
      ) : null}
    </div>
  );
}
