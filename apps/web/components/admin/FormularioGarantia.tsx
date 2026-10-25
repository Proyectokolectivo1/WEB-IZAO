'use client';

import { useActionState } from 'react';
import { ESTADO_INICIAL, type ResultadoAccion } from '@/lib/admin/crud/comun';
import { ETIQUETA_ESTADO_GARANTIA, ETIQUETA_RESOLUCION, RESOLUCIONES, type EstadoGarantia } from '@/lib/admin/garantias/garantias';
import { CampoAreaTexto } from './CampoAreaTexto';
import { CampoSelect } from './CampoSelect';
import { CampoTexto } from './CampoTexto';

export type ValoresGarantia = {
  id: string;
  status: EstadoGarantia;
  resolution: string;
  /** Costo asumido en unidad mayor, como texto. */
  cost_amount: string;
  admin_notes: string;
};

/** Gestión de un caso: estados permitidos desde el actual, solución, costo asumido y notas. */
export function FormularioGarantia({
  inicial,
  moneda,
  estadosPermitidos,
  accion,
}: {
  inicial: ValoresGarantia;
  moneda: 'COP' | 'USD';
  estadosPermitidos: readonly EstadoGarantia[];
  accion: (previo: ResultadoAccion, datos: FormData) => Promise<ResultadoAccion>;
}) {
  const [estado, enviar, pendiente] = useActionState(accion, ESTADO_INICIAL);
  const errores = estado.ok ? {} : (estado.errores ?? {});
  const opciones = [inicial.status, ...estadosPermitidos.filter((e) => e !== inicial.status)].map((e) => ({
    valor: e,
    etiqueta: e === inicial.status ? `${ETIQUETA_ESTADO_GARANTIA[e]} (actual)` : ETIQUETA_ESTADO_GARANTIA[e],
  }));
  return (
    <form action={enviar} className="adm-form adm-form-ancho" noValidate>
      <input type="hidden" name="id" value={inicial.id} />
      {!estado.ok && estado.mensaje ? (
        <p className="adm-alerta" role="alert">
          {estado.mensaje}
        </p>
      ) : null}
      <CampoSelect id="status" name="status" etiqueta="Estado" opciones={opciones} defaultValue={inicial.status} error={errores.status} />
      <CampoSelect
        id="resolution"
        name="resolution"
        etiqueta="Solución"
        vacio="Aún sin definir"
        opciones={RESOLUCIONES.map((r) => ({ valor: r, etiqueta: ETIQUETA_RESOLUCION[r] }))}
        defaultValue={inicial.resolution}
        ayuda="Obligatoria para marcar el caso como resuelto."
        error={errores.resolution}
      />
      <CampoTexto
        id="cost_amount"
        name="cost_amount"
        etiqueta={`Costo asumido (${moneda})`}
        inputMode="decimal"
        defaultValue={inicial.cost_amount}
        ayuda="Lo que le costó a Izao resolver el caso (producto, envío). Alimenta la métrica de garantías; los casos rechazados no suman."
        error={errores.cost_amount}
      />
      <CampoAreaTexto id="admin_notes" name="admin_notes" etiqueta="Notas internas" rows={4} defaultValue={inicial.admin_notes} maxLength={2000} error={errores.admin_notes} />
      <CampoTexto
        id="nota_historial"
        name="nota_historial"
        etiqueta="Comentario para el historial (opcional)"
        maxLength={500}
        autoComplete="off"
        ayuda="Queda anotado junto al cambio de estado, con tu nombre y la hora."
        error={errores.nota_historial}
      />
      <div className="adm-acciones">
        <button type="submit" className="adm-boton" disabled={pendiente}>
          {pendiente ? 'Guardando…' : 'Guardar caso'}
        </button>
      </div>
    </form>
  );
}
