'use client';

import { useActionState } from 'react';
import { ESTADO_INICIAL, type ResultadoAccion } from '@/lib/admin/crud/comun';
import type { CamposFormularioAgente } from '@/lib/admin/agentes/esquemas';
import { CampoAreaTexto } from './CampoAreaTexto';
import { CampoSelect } from './CampoSelect';
import { CampoTexto } from './CampoTexto';

const EJEMPLO_PASOS = `[
  {
    "name": "obtener_guia",
    "enabled": true,
    "actions": [
      { "op": "goto", "url": "https://panel.ejemplo.com/pedidos" },
      { "op": "fill", "selector": "#buscar", "value": "{order_number}" },
      { "op": "click", "selector": "button.buscar" },
      { "op": "download", "selector": "a.descargar-guia", "timeout_ms": 15000 }
    ]
  }
]`;

/** Modo, impresión remota, intervalos y modo panel del agente (todo lo que lee `GET /api/agent/config`). */
export function FormularioConfigAgente({
  inicial,
  accion,
}: {
  inicial: CamposFormularioAgente;
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
      {estado.ok && estado.mensaje ? (
        <p className="adm-ok" role="status">
          {estado.mensaje}
        </p>
      ) : null}

      <fieldset className="adm-fieldset">
        <legend>Cómo consigue la guía</legend>
        <CampoSelect
          id="mode"
          name="mode"
          etiqueta="Modo"
          defaultValue={inicial.mode}
          opciones={[
            { valor: 'api', etiqueta: 'API (normal): el servidor trae la guía y el agente solo imprime' },
            { valor: 'panel', etiqueta: 'Panel de MasterShop (respaldo): el agente descarga la guía desde la página' },
          ]}
          error={errores.mode}
        />
      </fieldset>

      <fieldset className="adm-fieldset">
        <legend>Impresión</legend>
        <p className="adm-suave adm-chico">Vacío = el agente usa su propio archivo de configuración.</p>
        <CampoTexto id="print_copies" name="print_copies" etiqueta="Copias (1 a 20)" inputMode="numeric" defaultValue={inicial.print_copies} error={errores.print_copies} />
        <CampoTexto
          id="print_settings"
          name="print_settings"
          etiqueta="Ajustes de SumatraPDF"
          defaultValue={inicial.print_settings}
          ayuda="Por ejemplo: noscale o fit. Solo letras, números, espacios y , = - _ ."
          error={errores.print_settings}
        />
      </fieldset>

      <fieldset className="adm-fieldset">
        <legend>Frecuencias (segundos)</legend>
        <p className="adm-suave adm-chico">Vacío = valores por defecto (30, 10 y 300).</p>
        <CampoTexto id="heartbeat_seconds" name="heartbeat_seconds" etiqueta="Latido (5 a 600)" inputMode="numeric" defaultValue={inicial.heartbeat_seconds} error={errores.heartbeat_seconds} />
        <CampoTexto id="claim_seconds" name="claim_seconds" etiqueta="Revisar trabajos nuevos (2 a 300)" inputMode="numeric" defaultValue={inicial.claim_seconds} error={errores.claim_seconds} />
        <CampoTexto
          id="panel_retry_seconds"
          name="panel_retry_seconds"
          etiqueta="Reintento de sesión en modo panel (30 a 3600)"
          inputMode="numeric"
          defaultValue={inicial.panel_retry_seconds}
          error={errores.panel_retry_seconds}
        />
      </fieldset>

      <fieldset className="adm-fieldset">
        <legend>Modo panel de MasterShop</legend>
        <p className="adm-suave adm-chico">Solo se usa si el modo es "Panel". Los pasos y selectores se ajustan aquí cuando MasterShop cambie su página, sin reinstalar nada.</p>
        <CampoTexto
          id="panel_base_url"
          name="panel_base_url"
          etiqueta="URL del panel (https)"
          inputMode="url"
          defaultValue={inicial.panel_base_url}
          error={errores.panel_base_url}
        />
        <CampoTexto
          id="panel_logged_in_selector"
          name="panel_logged_in_selector"
          etiqueta="Selector visible solo con la sesión iniciada"
          defaultValue={inicial.panel_logged_in_selector}
          error={errores.panel_logged_in_selector}
        />
        <CampoAreaTexto
          id="panel_logged_out_selectors"
          name="panel_logged_out_selectors"
          etiqueta="Selectores de la pantalla de ingreso (uno por línea)"
          rows={3}
          defaultValue={inicial.panel_logged_out_selectors}
          error={errores.panel_logged_out_selectors}
        />
        <CampoAreaTexto
          id="panel_challenge_selectors"
          name="panel_challenge_selectors"
          etiqueta="Selectores del reto de verificación (uno por línea)"
          rows={3}
          defaultValue={inicial.panel_challenge_selectors}
          error={errores.panel_challenge_selectors}
        />
        <CampoAreaTexto
          id="panel_challenge_title_patterns"
          name="panel_challenge_title_patterns"
          etiqueta="Patrones del título del reto (expresión regular, uno por línea)"
          rows={2}
          defaultValue={inicial.panel_challenge_title_patterns}
          error={errores.panel_challenge_title_patterns}
        />
        <CampoAreaTexto
          id="panel_steps"
          name="panel_steps"
          etiqueta="Pasos (JSON)"
          rows={14}
          spellCheck={false}
          style={{ fontFamily: 'ui-monospace, monospace' }}
          defaultValue={inicial.panel_steps}
          ayuda="Operaciones permitidas: goto, click, fill, press, select_option, wait_for, wait_ms, expect_text, download. Sustituciones: {order_number}, {job_id}. Un goto solo puede ir al mismo sitio del panel."
          error={errores.panel_steps}
        />
        <details>
          <summary>Ver un ejemplo de pasos</summary>
          <pre className="adm-codigo">{EJEMPLO_PASOS}</pre>
        </details>
      </fieldset>

      <div className="adm-acciones">
        <button type="submit" className="adm-boton" disabled={pendiente}>
          {pendiente ? 'Guardando…' : 'Guardar configuración'}
        </button>
      </div>
    </form>
  );
}
