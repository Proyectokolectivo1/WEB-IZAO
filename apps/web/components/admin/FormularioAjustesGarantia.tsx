'use client';

import { useActionState } from 'react';
import { ESTADO_INICIAL, type ResultadoAccion } from '@/lib/admin/crud/comun';
import { CampoAreaTexto } from './CampoAreaTexto';
import { CampoTexto } from './CampoTexto';

export type ValoresAjustesGarantia = {
  period_days: string;
  response_days: string;
  /** Un motivo por línea. */
  reasons: string;
  instructions_html: string;
  conditions_html: string;
};

/** Plazo, tiempo de respuesta, motivos y textos de la garantía de un país (§19). */
export function FormularioAjustesGarantia({
  pais,
  inicial,
  accion,
}: {
  pais: 'CO' | 'EC';
  inicial: ValoresAjustesGarantia;
  accion: (previo: ResultadoAccion, datos: FormData) => Promise<ResultadoAccion>;
}) {
  const [estado, enviar, pendiente] = useActionState(accion, ESTADO_INICIAL);
  const errores = estado.ok ? {} : (estado.errores ?? {});
  return (
    <form action={enviar} className="adm-form adm-form-ancho" noValidate>
      <input type="hidden" name="country_code" value={pais} />
      {!estado.ok && estado.mensaje ? (
        <p className="adm-alerta" role="alert">
          {estado.mensaje}
        </p>
      ) : null}
      <div className="adm-fila">
        <CampoTexto
          id="period_days"
          name="period_days"
          etiqueta="Plazo para solicitar (días desde la entrega)"
          inputMode="numeric"
          defaultValue={inicial.period_days}
          error={errores.period_days}
        />
        <CampoTexto
          id="response_days"
          name="response_days"
          etiqueta="Tiempo de respuesta (días)"
          inputMode="numeric"
          defaultValue={inicial.response_days}
          ayuda="Se le informa a la persona y marca como vencidos los casos abiertos que lo superan."
          error={errores.response_days}
        />
      </div>
      <CampoAreaTexto
        id="reasons"
        name="reasons"
        etiqueta="Motivos del formulario (uno por línea)"
        rows={6}
        defaultValue={inicial.reasons}
        ayuda="Es la lista que ve la persona en el formulario público."
        error={errores.reasons}
      />
      <CampoAreaTexto
        id="instructions_html"
        name="instructions_html"
        etiqueta="Instrucciones (HTML sencillo)"
        rows={8}
        defaultValue={inicial.instructions_html}
        ayuda="Párrafos (p), listas (ul, ol, li), negrita (strong), cursiva (em) y enlaces (a). Al guardar se quita todo lo demás."
        error={errores.instructions_html}
      />
      <CampoAreaTexto
        id="conditions_html"
        name="conditions_html"
        etiqueta="Condiciones (HTML sencillo)"
        rows={8}
        defaultValue={inicial.conditions_html}
        error={errores.conditions_html}
      />
      <div className="adm-acciones">
        <button type="submit" className="adm-boton" disabled={pendiente}>
          {pendiente ? 'Guardando…' : 'Guardar ajustes'}
        </button>
      </div>
    </form>
  );
}
