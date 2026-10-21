'use client';

import { useActionState, useMemo, useState } from 'react';
import { ESTADO_INICIAL } from '@/lib/admin/crud/comun';
import type { ResultadoPlantilla } from '@/lib/admin/whatsapp/plantillas-servidor';
import {
  VARIABLES_PLANTILLA,
  normalizarMapa,
  posicionesDelTexto,
  textoDeEjemplo,
  type VariablePlantilla,
} from '@/lib/admin/whatsapp/etiquetas';
import { BotonConfirmar } from './BotonConfirmar';
import { CampoAreaTexto } from './CampoAreaTexto';
import { CampoTexto } from './CampoTexto';

export type ValoresPlantilla = {
  id: string;
  language: string;
  body_text: string;
  footer_text: string;
  button_text: string;
  button_url: string;
  variables_map: Record<string, string>;
};

export function FormularioPlantilla({
  inicial,
  nombreMeta,
  accion,
  accionEnvio,
  problemasIniciales,
}: {
  inicial: ValoresPlantilla;
  nombreMeta: string;
  accion: (previo: ResultadoPlantilla, datos: FormData) => Promise<ResultadoPlantilla>;
  /** Envío a aprobación (Server Action ya enlazada al id). Solo se ofrece con el borrador guardado. */
  accionEnvio: () => Promise<ResultadoPlantilla>;
  problemasIniciales: readonly { codigo: string; mensaje: string }[];
}) {
  const [estado, enviar, pendiente] = useActionState(accion, ESTADO_INICIAL as ResultadoPlantilla);
  const [idioma, setIdioma] = useState(inicial.language);
  const [cuerpo, setCuerpo] = useState(inicial.body_text);
  const [pie, setPie] = useState(inicial.footer_text);
  const [textoBoton, setTextoBoton] = useState(inicial.button_text);
  const [urlBoton, setUrlBoton] = useState(inicial.button_url);
  const [mapa, setMapa] = useState<Record<string, string>>(inicial.variables_map);

  const posiciones = useMemo(() => posicionesDelTexto(cuerpo), [cuerpo]);
  const hayBoton = Boolean(textoBoton.trim() && urlBoton.trim());
  const mapaFinal = useMemo(() => normalizarMapa(mapa, hayBoton, posiciones), [mapa, hayBoton, posiciones]);
  const errores = estado.ok ? {} : (estado.errores ?? {});
  const problemas = estado.problemas ?? problemasIniciales;

  const sucio =
    idioma !== inicial.language ||
    cuerpo !== inicial.body_text ||
    pie !== inicial.footer_text ||
    textoBoton !== inicial.button_text ||
    urlBoton !== inicial.button_url ||
    JSON.stringify(mapaFinal) !== JSON.stringify(normalizarMapa(inicial.variables_map, Boolean(inicial.button_text && inicial.button_url), posicionesDelTexto(inicial.body_text)));

  return (
    <>
      <form action={enviar} className="adm-form adm-form-ancho" noValidate>
        <input type="hidden" name="id" value={inicial.id} />
        <input type="hidden" name="variables_map" value={JSON.stringify(mapaFinal)} />
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
        <p className="adm-suave adm-chico">
          Nombre en Meta: <strong>{nombreMeta}</strong>. Se asigna solo según la versión y no cambia.
        </p>
        <CampoTexto
          id="language"
          name="language"
          etiqueta="Idioma"
          value={idioma}
          maxLength={10}
          required
          ayuda='Normalmente "es".'
          error={errores.language}
          onChange={(e) => setIdioma(e.target.value)}
        />
        <CampoAreaTexto
          id="body_text"
          name="body_text"
          etiqueta="Texto del mensaje"
          value={cuerpo}
          rows={9}
          maxLength={1500}
          ayuda={`Escribe {{1}}, {{2}}… donde va cada dato. Meta no admite una variable al inicio ni al final. ${cuerpo.length}/1024 caracteres.`}
          error={errores.body_text}
          onChange={(e) => setCuerpo(e.target.value)}
        />
        <fieldset className="adm-fieldset">
          <legend>Datos de cada variable</legend>
          {posiciones.length === 0 ? (
            <p className="adm-suave">El texto no tiene variables.</p>
          ) : (
            posiciones.map((n) => (
              <div className="adm-campo" key={n}>
                <label htmlFor={`var-${n}`} className="adm-etiqueta">
                  Variable {`{{${n}}}`}
                </label>
                <select
                  id={`var-${n}`}
                  className="adm-input"
                  value={mapa[String(n)] ?? ''}
                  onChange={(e) => setMapa((m) => ({ ...m, [String(n)]: e.target.value }))}
                >
                  <option value="">Elige el dato</option>
                  {(Object.keys(VARIABLES_PLANTILLA) as VariablePlantilla[]).map((v) => (
                    <option key={v} value={v}>
                      {VARIABLES_PLANTILLA[v]}
                    </option>
                  ))}
                </select>
              </div>
            ))
          )}
        </fieldset>
        <CampoTexto
          id="footer_text"
          name="footer_text"
          etiqueta="Pie del mensaje"
          value={pie}
          maxLength={120}
          ayuda="Opcional. Hasta 60 caracteres."
          error={errores.footer_text}
          onChange={(e) => setPie(e.target.value)}
        />
        <fieldset className="adm-fieldset">
          <legend>Botón</legend>
          <CampoTexto
            id="button_text"
            name="button_text"
            etiqueta="Texto del botón"
            value={textoBoton}
            maxLength={60}
            ayuda="Opcional. Hasta 25 caracteres."
            error={errores.button_text}
            onChange={(e) => setTextoBoton(e.target.value)}
          />
          <CampoTexto
            id="button_url"
            name="button_url"
            etiqueta="Enlace del botón"
            value={urlBoton}
            maxLength={2100}
            ayuda="Termina en {{1}}, que se reemplaza por el código seguro del link de cobro de cada pedido."
            error={errores.button_url}
            onChange={(e) => setUrlBoton(e.target.value)}
          />
        </fieldset>
        {problemas.length > 0 ? (
          <div className="adm-aviso" role="status">
            <p>
              <strong>Antes de enviar a Meta, corrige:</strong>
            </p>
            <ul>
              {problemas.map((p, i) => (
                <li key={`${p.codigo}-${i}`}>{p.mensaje}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="adm-acciones">
          <button type="submit" className="adm-boton" disabled={pendiente}>
            {pendiente ? 'Guardando…' : 'Guardar borrador'}
          </button>
        </div>
      </form>

      <section className="adm-form-ancho" aria-label="Vista previa">
        <h2>Vista previa</h2>
        <div className="adm-previa">
          <p style={{ whiteSpace: 'pre-wrap' }}>{textoDeEjemplo(cuerpo, mapaFinal)}</p>
          {pie ? <p className="adm-suave adm-chico">{pie}</p> : null}
          {hayBoton ? (
            <p>
              <strong>{textoBoton}</strong>
            </p>
          ) : null}
        </div>
        <p className="adm-suave adm-chico">Los datos de la vista previa son de ejemplo.</p>
      </section>

      <section className="adm-form-ancho" aria-label="Envío a Meta">
        <h2>Enviar a aprobación</h2>
        <p className="adm-suave">
          Meta revisa la plantilla antes de permitir su uso. Cuando la apruebe, el sistema la activa sola y deja de usar la
          versión anterior.
        </p>
        {sucio ? (
          <p className="adm-aviso">Guarda el borrador para poder enviarlo: se envía lo último guardado.</p>
        ) : (
          <BotonConfirmar
          etiqueta="Enviar a Meta"
          mensaje={`Vas a enviar "${nombreMeta}" a revisión de Meta. Una vez enviada no se puede editar: si hay que cambiarla se crea una versión nueva.`}
          etiquetaConfirmar="Sí, enviar a Meta"
          peligro={false}
          accion={accionEnvio}
        />
        )}
      </section>
    </>
  );
}
