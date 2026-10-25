'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { ESTADO_INICIAL, type ResultadoAccion } from '@/lib/admin/crud/comun';
import { ETIQUETA_TIPO, ICONOS_BENEFICIO, MAX_BENEFICIOS, type TipoSeccion } from '@/lib/admin/home/home';
import { CampoAreaTexto } from './CampoAreaTexto';
import { CampoSelect } from './CampoSelect';
import { CampoTexto } from './CampoTexto';

export type ValoresSeccion = {
  id?: string;
  type: TipoSeccion;
  is_active: boolean;
  title: string;
  body: string;
  cta_label: string;
  cta_url: string;
  beneficios: { icon: string; title: string; text: string }[];
};

const ETIQUETA_ICONO: Record<(typeof ICONOS_BENEFICIO)[number], string> = {
  camion: 'Camión (envíos)',
  caja: 'Caja (paquete)',
  escudo: 'Escudo (garantía)',
  tarjeta: 'Tarjeta (pagos)',
  chat: 'Chat (asesoría)',
  reloj: 'Reloj (tiempos)',
  check: 'Visto bueno',
  estrella: 'Estrella',
  gota: 'Gota (fragancia)',
  flor: 'Flor',
  hoja: 'Hoja',
};

/** Contenido propio de una sección del home. Lo que no es de este tipo no aparece. */
export function FormularioSeccionHome({
  inicial,
  pais,
  accion,
}: {
  inicial: ValoresSeccion;
  pais: 'CO' | 'EC';
  accion: (previo: ResultadoAccion, datos: FormData) => Promise<ResultadoAccion>;
}) {
  const [estado, enviar, pendiente] = useActionState(accion, ESTADO_INICIAL);
  const errores = estado.ok ? {} : (estado.errores ?? {});
  const t = inicial.type;
  const filas = Array.from({ length: MAX_BENEFICIOS }, (_, n) => inicial.beneficios[n] ?? { icon: 'check', title: '', text: '' });
  return (
    <form action={enviar} className="adm-form adm-form-ancho" noValidate>
      {inicial.id ? <input type="hidden" name="id" value={inicial.id} /> : null}
      <input type="hidden" name="pais" value={pais} />
      <input type="hidden" name="type" value={t} />
      {!estado.ok && estado.mensaje ? (
        <p className="adm-alerta" role="alert">
          {estado.mensaje}
        </p>
      ) : null}
      <CampoTexto
        id="title"
        name="title"
        etiqueta="Título de la sección (opcional)"
        defaultValue={inicial.title}
        maxLength={80}
        ayuda="Si lo dejas vacío, la sección va sin título."
        error={errores.title}
      />
      {t === 'advice' ? (
        <>
          <CampoAreaTexto id="body" name="body" etiqueta="Texto" rows={3} defaultValue={inicial.body} maxLength={400} error={errores.body} />
          <div className="adm-fila">
            <CampoTexto id="cta_label" name="cta_label" etiqueta="Texto del botón" defaultValue={inicial.cta_label} maxLength={40} error={errores.cta_label} />
            <CampoTexto
              id="cta_url"
              name="cta_url"
              etiqueta="A dónde lleva el botón"
              defaultValue={inicial.cta_url}
              maxLength={300}
              ayuda="Una ruta del sitio (/co/contacto) o un enlace https."
              error={errores.cta_url}
            />
          </div>
        </>
      ) : null}
      {t === 'benefits' ? (
        <fieldset className="adm-fieldset">
          <legend>Beneficios (hasta {MAX_BENEFICIOS}; las filas sin título se ignoran)</legend>
          {errores.benef_0_title ? <p className="adm-error-campo">{errores.benef_0_title}</p> : null}
          {filas.map((b, n) => (
            <div key={n} className="adm-fila">
              <CampoSelect
                id={`benef_${n}_icon`}
                name={`benef_${n}_icon`}
                etiqueta={`Ícono ${n + 1}`}
                opciones={ICONOS_BENEFICIO.map((i) => ({ valor: i, etiqueta: ETIQUETA_ICONO[i] }))}
                defaultValue={b.icon}
              />
              <CampoTexto id={`benef_${n}_title`} name={`benef_${n}_title`} etiqueta={`Título ${n + 1}`} defaultValue={b.title} maxLength={60} error={errores[`beneficios.${n}.title`]} />
              <CampoTexto id={`benef_${n}_text`} name={`benef_${n}_text`} etiqueta={`Texto ${n + 1} (opcional)`} defaultValue={b.text} maxLength={160} error={errores[`beneficios.${n}.text`]} />
            </div>
          ))}
        </fieldset>
      ) : null}
      {t === 'hero' || t === 'categories' || t === 'families' || t === 'banner' || t === 'collection_tabs' || t === 'reviews' ? (
        <p className="adm-suave adm-chico">El contenido de esta sección sale de otros módulos del panel; aquí solo controlas su título, su orden y si se muestra.</p>
      ) : null}
      <label className="adm-check">
        <input type="checkbox" name="is_active" defaultChecked={inicial.is_active} />
        Mostrar en el home de {pais === 'CO' ? 'Colombia' : 'Ecuador'}
      </label>
      <div className="adm-acciones">
        <button type="submit" className="adm-boton" disabled={pendiente}>
          {pendiente ? 'Guardando…' : `Guardar ${ETIQUETA_TIPO[t].toLowerCase()}`}
        </button>
        <Link href={`/admin/home?pais=${pais}`} className="adm-enlace-boton adm-boton-secundario">
          Cancelar
        </Link>
      </div>
    </form>
  );
}
