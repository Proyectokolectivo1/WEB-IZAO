'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { ESTADO_INICIAL, type ResultadoAccion } from '@/lib/admin/crud/comun';
import { CampoTexto } from './CampoTexto';

export type CampoCredencial = {
  key: string;
  label: string;
  secret: boolean;
  required: boolean;
  help?: string | undefined;
  /** Valor visible de un campo público ya guardado. Los secretos nunca traen valor. */
  valor: string;
  /** Vista enmascarada de un secreto ya guardado (`prv_test_****0001`). */
  guardado: string | null;
};

/**
 * Formulario generado desde el esquema del proveedor. Los secretos se escriben en campos de contraseña y
 * jamás se rellenan; dejar uno en blanco conserva el valor guardado.
 */
export function FormularioCredencial({
  proveedor,
  pais,
  ambiente,
  campos,
  existe,
  accion,
  volverHref,
}: {
  proveedor: string;
  pais: string;
  ambiente: string;
  campos: CampoCredencial[];
  existe: boolean;
  accion: (previo: ResultadoAccion, datos: FormData) => Promise<ResultadoAccion>;
  volverHref: string;
}) {
  const [estado, enviar, pendiente] = useActionState(accion, ESTADO_INICIAL);
  const errores = estado.ok ? {} : (estado.errores ?? {});
  return (
    <form action={enviar} className="adm-form adm-form-ancho" noValidate autoComplete="off">
      <input type="hidden" name="proveedor" value={proveedor} />
      <input type="hidden" name="pais" value={pais} />
      <input type="hidden" name="ambiente" value={ambiente} />
      {!estado.ok && estado.mensaje ? (
        <p className="adm-alerta" role="alert">
          {estado.mensaje}
        </p>
      ) : null}
      {estado.ok && estado.mensaje ? (
        <p className="adm-ok" role="status">
          {estado.mensaje}
        </p>
      ) : null}
      {errores.pais || errores.ambiente || errores.form ? (
        <p className="adm-error-campo" role="alert">
          {errores.pais ?? errores.ambiente ?? errores.form}
        </p>
      ) : null}
      {campos.map((c) => (
        <CampoTexto
          key={c.key}
          id={`cred-${c.key}`}
          name={`campo_${c.key}`}
          etiqueta={`${c.label}${c.required ? '' : ' (opcional)'}`}
          type={c.secret ? 'password' : 'text'}
          autoComplete="off"
          spellCheck={false}
          defaultValue={c.secret ? '' : c.valor}
          placeholder={c.secret && c.guardado ? c.guardado : undefined}
          maxLength={500}
          ayuda={
            c.secret && c.guardado
              ? `Guardado: ${c.guardado}. Déjalo en blanco para conservarlo.${c.help ? ` ${c.help}` : ''}`
              : c.help
          }
          error={errores[c.key]}
        />
      ))}
      <div className="adm-acciones">
        <button type="submit" className="adm-boton" disabled={pendiente}>
          {pendiente ? 'Guardando…' : existe ? 'Guardar cambios' : 'Guardar credenciales'}
        </button>
        <Link href={volverHref} className="adm-enlace-boton">
          Volver
        </Link>
      </div>
    </form>
  );
}
