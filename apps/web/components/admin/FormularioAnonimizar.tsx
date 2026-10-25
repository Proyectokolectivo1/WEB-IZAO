'use client';

import { useActionState } from 'react';
import { ESTADO_INICIAL, type ResultadoAccion } from '@/lib/admin/crud/comun';
import { PALABRA_CONFIRMACION } from '@/lib/admin/clientes/clientes';
import { CampoTexto } from './CampoTexto';

/** Anonimizar es irreversible: exige anotar la solicitud y escribir la palabra de confirmación. */
export function FormularioAnonimizar({
  id,
  accion,
}: {
  id: string;
  accion: (previo: ResultadoAccion, datos: FormData) => Promise<ResultadoAccion>;
}) {
  const [estado, enviar, pendiente] = useActionState(accion, ESTADO_INICIAL);
  const errores = estado.ok ? {} : (estado.errores ?? {});
  return (
    <form action={enviar} className="adm-form adm-form-ancho" noValidate autoComplete="off">
      <input type="hidden" name="id" value={id} />
      {!estado.ok && estado.mensaje ? (
        <p className="adm-alerta" role="alert">
          {estado.mensaje}
        </p>
      ) : null}
      <CampoTexto
        id="motivo"
        name="motivo"
        etiqueta="Solicitud (número de radicado o fecha)"
        maxLength={300}
        required
        ayuda="Queda en la auditoría. No escribas datos personales del cliente."
        error={errores.motivo}
      />
      <CampoTexto
        id="confirmacion"
        name="confirmacion"
        etiqueta={`Escribe ${PALABRA_CONFIRMACION} para confirmar`}
        required
        autoCapitalize="characters"
        error={errores.confirmacion}
      />
      <div className="adm-acciones">
        <button type="submit" className="adm-boton adm-boton-peligro" disabled={pendiente}>
          {pendiente ? 'Anonimizando…' : 'Anonimizar cliente'}
        </button>
      </div>
    </form>
  );
}
