'use client';

import { useActionState } from 'react';
import { ESTADO_INICIAL, type ResultadoAccion } from '@/lib/admin/crud/comun';
import type { FormularioMetodo } from '@/lib/admin/pagos/ajustes-servidor';
import { CampoTexto } from './CampoTexto';

/** Un método de pago del país: activo, orden, textos y comisión estimada (§12.2). */
export function FormularioMetodoPago({
  pais,
  etiqueta,
  inicial,
  moneda,
  accion,
}: {
  pais: 'CO' | 'EC';
  etiqueta: string;
  inicial: FormularioMetodo;
  moneda: 'COP' | 'USD';
  accion: (previo: ResultadoAccion, datos: FormData) => Promise<ResultadoAccion>;
}) {
  const [estado, enviar, pendiente] = useActionState(accion, ESTADO_INICIAL);
  const errores = estado.ok ? {} : (estado.errores ?? {});
  const id = `${pais}-${inicial.method}`;
  return (
    <form action={enviar} className="adm-form adm-tarjeta" noValidate aria-labelledby={`t-${id}`}>
      <input type="hidden" name="pais" value={pais} />
      <input type="hidden" name="metodo" value={inicial.method} />
      <h3 id={`t-${id}`}>{etiqueta}</h3>
      {!estado.ok && estado.mensaje && !estado.errores ? (
        <p className="adm-alerta" role="alert">
          {estado.mensaje}
        </p>
      ) : null}
      {estado.ok && estado.mensaje ? (
        <p className="adm-ok" role="status">
          {estado.mensaje}
        </p>
      ) : null}
      <label className="adm-check">
        <input type="checkbox" name="is_enabled" defaultChecked={inicial.is_enabled} />
        Visible en el pago de la tienda
      </label>
      {errores.is_enabled ? <p className="adm-error-campo">{errores.is_enabled}</p> : null}
      <div className="adm-fila">
        <CampoTexto
          id={`${id}-nombre`}
          name="display_name"
          etiqueta="Nombre que ve el cliente"
          defaultValue={inicial.display_name}
          maxLength={60}
          error={errores.display_name}
        />
        <CampoTexto
          id={`${id}-orden`}
          name="sort_order"
          etiqueta="Orden"
          inputMode="numeric"
          defaultValue={inicial.sort_order}
          error={errores.sort_order}
        />
      </div>
      <CampoTexto
        id={`${id}-desc`}
        name="description"
        etiqueta="Descripción corta"
        defaultValue={inicial.description}
        maxLength={200}
        error={errores.description}
      />
      <div className="adm-fila">
        <CampoTexto
          id={`${id}-pct`}
          name="fee_pct"
          etiqueta="Comisión (%)"
          inputMode="decimal"
          defaultValue={inicial.fee_pct}
          error={errores.fee_pct}
        />
        <CampoTexto
          id={`${id}-fija`}
          name="fee_fixed"
          etiqueta={`Comisión fija (${moneda})`}
          inputMode="decimal"
          defaultValue={inicial.fee_fixed}
          error={errores.fee_fixed}
        />
        <CampoTexto
          id={`${id}-iva`}
          name="fee_tax_pct"
          etiqueta="Impuesto sobre la comisión (%)"
          inputMode="decimal"
          defaultValue={inicial.fee_tax_pct}
          error={errores.fee_tax_pct}
        />
      </div>
      <p className="adm-suave adm-chico">
        La comisión solo alimenta el costo estimado de la pasarela en las métricas; no cambia lo que paga el cliente.
      </p>
      <div className="adm-acciones">
        <button type="submit" className="adm-boton" disabled={pendiente}>
          {pendiente ? 'Guardando…' : 'Guardar método'}
        </button>
      </div>
    </form>
  );
}
