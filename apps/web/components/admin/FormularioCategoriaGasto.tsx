'use client';

import { useActionState } from 'react';
import { ESTADO_INICIAL, type ResultadoAccion } from '@/lib/admin/crud/comun';
import { CampoTexto } from './CampoTexto';

/** Crear una categoría de gasto (con la opción de pauta publicitaria) o renombrar una existente. */
export function FormularioCategoriaGasto({
  id,
  nombre = '',
  accion,
  etiquetaBoton,
}: {
  id?: string;
  nombre?: string;
  accion: (previo: ResultadoAccion, datos: FormData) => Promise<ResultadoAccion>;
  etiquetaBoton: string;
}) {
  const [estado, enviar, pendiente] = useActionState(accion, ESTADO_INICIAL);
  const errores = estado.ok ? {} : (estado.errores ?? {});
  const idCampo = `cat-${id ?? 'nueva'}`;
  return (
    <form action={enviar} className="adm-form" noValidate>
      {id ? <input type="hidden" name="id" value={id} /> : null}
      {!estado.ok && estado.mensaje && !estado.errores ? (
        <p className="adm-alerta" role="alert">
          {estado.mensaje}
        </p>
      ) : null}
      <CampoTexto id={idCampo} name="name" etiqueta={id ? 'Nombre' : 'Nombre de la categoría'} defaultValue={nombre} maxLength={60} required error={errores.name} />
      {id ? null : (
        <label className="adm-check">
          <input type="checkbox" name="es_pauta" />
          Es pauta publicitaria (cuenta para el ROAS)
        </label>
      )}
      <div className="adm-acciones">
        <button type="submit" className="adm-boton" disabled={pendiente}>
          {pendiente ? 'Guardando…' : etiquetaBoton}
        </button>
      </div>
    </form>
  );
}
