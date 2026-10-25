'use client';

import { useActionState } from 'react';
import { ESTADO_INICIAL, type ResultadoAccion } from '@/lib/admin/crud/comun';
import { CampoAreaTexto } from './CampoAreaTexto';
import { CampoTexto } from './CampoTexto';

export type ValoresChatbot = {
  is_enabled: boolean;
  model_primary: string;
  model_fallback: string;
  /** USD, como texto. */
  presupuesto: string;
  degrade_at_pct: string;
  extra_instructions: string;
  welcome_CO: string;
  welcome_EC: string;
  max_output_tokens: string;
  history_turns: string;
  max_input_chars: string;
  max_messages_per_session: string;
};

/** Ajustes de Iza (§20.6). Todo se edita aquí; el servidor vuelve a validar y audita el cambio. */
export function FormularioChatbot({
  inicial,
  accion,
}: {
  inicial: ValoresChatbot;
  accion: (previo: ResultadoAccion, datos: FormData) => Promise<ResultadoAccion>;
}) {
  const [estado, enviar, pendiente] = useActionState(accion, ESTADO_INICIAL);
  const errores = estado.ok ? {} : (estado.errores ?? {});
  return (
    <form action={enviar} className="adm-form adm-form-ancho" noValidate>
      {!estado.ok && estado.mensaje ? (
        <p className="adm-alerta" role="alert">
          {estado.mensaje}
        </p>
      ) : null}

      <label className="adm-check">
        <input type="checkbox" name="is_enabled" defaultChecked={inicial.is_enabled} />
        Iza activa (el botón de chat aparece en la tienda)
      </label>
      {errores.is_enabled ? <p className="adm-error-campo">{errores.is_enabled}</p> : null}

      <fieldset className="adm-fieldset">
        <legend>Modelos</legend>
        <div className="adm-fila">
          <CampoTexto
            id="model_primary"
            name="model_primary"
            etiqueta="Modelo principal"
            defaultValue={inicial.model_primary}
            placeholder="proveedor/modelo"
            autoComplete="off"
            spellCheck={false}
            ayuda="El identificador exacto de OpenRouter."
            error={errores.model_primary}
          />
          <CampoTexto
            id="model_fallback"
            name="model_fallback"
            etiqueta="Modelo de respaldo"
            defaultValue={inicial.model_fallback}
            placeholder="proveedor/modelo"
            autoComplete="off"
            spellCheck={false}
            ayuda="Más económico: se usa al acercarse al límite del mes."
            error={errores.model_fallback}
          />
        </div>
      </fieldset>

      <fieldset className="adm-fieldset">
        <legend>Presupuesto</legend>
        <div className="adm-fila">
          <CampoTexto
            id="presupuesto"
            name="presupuesto"
            etiqueta="Presupuesto del mes (USD)"
            inputMode="decimal"
            defaultValue={inicial.presupuesto}
            ayuda="Al llegar al 100 % Iza deriva al asesor por WhatsApp. Pon además un límite de crédito en la llave de OpenRouter."
            error={errores.presupuesto}
          />
          <CampoTexto
            id="degrade_at_pct"
            name="degrade_at_pct"
            etiqueta="Pasar al modelo de respaldo al (%)"
            inputMode="numeric"
            defaultValue={inicial.degrade_at_pct}
            error={errores.degrade_at_pct}
          />
        </div>
      </fieldset>

      <fieldset className="adm-fieldset">
        <legend>Mensaje de bienvenida</legend>
        <CampoAreaTexto id="welcome_CO" name="welcome_CO" etiqueta="Colombia" rows={2} defaultValue={inicial.welcome_CO} maxLength={300} ayuda="Vacío = el mensaje de fábrica." error={errores.welcome_CO} />
        <CampoAreaTexto id="welcome_EC" name="welcome_EC" etiqueta="Ecuador" rows={2} defaultValue={inicial.welcome_EC} maxLength={300} error={errores.welcome_EC} />
      </fieldset>

      <CampoAreaTexto
        id="extra_instructions"
        name="extra_instructions"
        etiqueta="Instrucciones adicionales para Iza"
        rows={6}
        defaultValue={inicial.extra_instructions}
        maxLength={2000}
        ayuda="Se suman a las reglas base (no afirmar originalidad, no inventar precios, no pedir datos de tarjeta). No pueden quitarlas."
        error={errores.extra_instructions}
      />

      <fieldset className="adm-fieldset">
        <legend>Límites</legend>
        <div className="adm-fila">
          <CampoTexto id="max_output_tokens" name="max_output_tokens" etiqueta="Largo máximo de la respuesta (tokens)" inputMode="numeric" defaultValue={inicial.max_output_tokens} error={errores.max_output_tokens} />
          <CampoTexto id="history_turns" name="history_turns" etiqueta="Turnos de historial" inputMode="numeric" defaultValue={inicial.history_turns} error={errores.history_turns} />
        </div>
        <div className="adm-fila">
          <CampoTexto id="max_input_chars" name="max_input_chars" etiqueta="Caracteres por mensaje del cliente" inputMode="numeric" defaultValue={inicial.max_input_chars} error={errores.max_input_chars} />
          <CampoTexto id="max_messages_per_session" name="max_messages_per_session" etiqueta="Mensajes por sesión" inputMode="numeric" defaultValue={inicial.max_messages_per_session} error={errores.max_messages_per_session} />
        </div>
      </fieldset>

      <div className="adm-acciones">
        <button type="submit" className="adm-boton" disabled={pendiente}>
          {pendiente ? 'Guardando…' : 'Guardar ajustes'}
        </button>
      </div>
    </form>
  );
}
