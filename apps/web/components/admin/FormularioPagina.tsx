'use client';

import Link from 'next/link';
import { useActionState, useMemo, useState } from 'react';
import {
  ESTADOS_PAGINA,
  ETIQUETA_ESTADO,
  ETIQUETA_TIPO,
  NOMBRE_PAIS_PAGINA,
  PAISES_PAGINA,
  SLUG_SUGERIDO,
  TIPOS_PAGINA,
  esTipoUnico,
  marcadoresPendientes,
  type EstadoPagina,
  type PaisPagina,
  type TipoPagina,
} from '@/lib/admin/contenido/paginas';
import { ESTADO_INICIAL, slugificar, type ResultadoAccion } from '@/lib/admin/crud/comun';
import { depurarHtml } from '@/lib/store/html-seguro';
import { CampoAreaTexto } from './CampoAreaTexto';
import { CampoSelect } from './CampoSelect';
import { CampoTexto } from './CampoTexto';

export type ValoresPagina = {
  id?: string;
  country_code: PaisPagina;
  kind: TipoPagina;
  slug: string;
  title: string;
  content_html: string;
  seo_title: string;
  seo_description: string;
  status: EstadoPagina;
  version: number | null;
  actualizada: string | null;
};

export type PublicadaUnica = { id: string; pais: PaisPagina; tipo: TipoPagina; titulo: string };

export function FormularioPagina({
  inicial,
  publicadas,
  accion,
  volverHref,
}: {
  inicial: ValoresPagina;
  /** Páginas legales hoy publicadas, para avisar cuál se reemplaza. */
  publicadas: readonly PublicadaUnica[];
  accion: (previo: ResultadoAccion, datos: FormData) => Promise<ResultadoAccion>;
  volverHref: string;
}) {
  const [estado, enviar, pendiente] = useActionState(accion, ESTADO_INICIAL);
  const [pais, setPais] = useState<PaisPagina>(inicial.country_code);
  const [tipo, setTipo] = useState<TipoPagina>(inicial.kind);
  const [titulo, setTitulo] = useState(inicial.title);
  const [slug, setSlug] = useState(inicial.slug);
  const [slugTocado, setSlugTocado] = useState(Boolean(inicial.slug));
  const [html, setHtml] = useState(inicial.content_html);
  const [publicar, setPublicar] = useState<EstadoPagina>(inicial.status);
  const [verPrevia, setVerPrevia] = useState(false);
  const errores = estado.ok ? {} : (estado.errores ?? {});

  const previa = useMemo(() => (verPrevia ? depurarHtml(html) : ''), [verPrevia, html]);
  const pendientes = useMemo(() => marcadoresPendientes(html), [html]);
  const reemplaza =
    publicar === 'published' && esTipoUnico(tipo)
      ? publicadas.find((p) => p.pais === pais && p.tipo === tipo && p.id !== inicial.id)
      : undefined;

  return (
    <form action={enviar} className="adm-form adm-form-ancho" noValidate>
      {inicial.id ? <input type="hidden" name="id" value={inicial.id} /> : null}
      {!estado.ok && estado.mensaje ? (
        <p className="adm-alerta" role="alert">
          {estado.mensaje}
        </p>
      ) : null}
      {inicial.version !== null ? (
        <p className="adm-suave adm-chico">
          Versión {inicial.version}
          {inicial.actualizada
            ? ` · actualizada ${new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Bogota' }).format(new Date(inicial.actualizada))}`
            : ''}
          . La versión sube sola al publicar o al cambiar el texto de una página publicada.
        </p>
      ) : null}
      <div className="adm-fila">
        <CampoSelect
          id="country_code"
          name="country_code"
          etiqueta="País"
          opciones={PAISES_PAGINA.map((p) => ({ valor: p, etiqueta: NOMBRE_PAIS_PAGINA[p] }))}
          value={pais}
          onChange={(e) => setPais(e.target.value as PaisPagina)}
          error={errores.country_code}
        />
        <CampoSelect
          id="kind"
          name="kind"
          etiqueta="Tipo de página"
          opciones={TIPOS_PAGINA.map((t) => ({ valor: t, etiqueta: ETIQUETA_TIPO[t] }))}
          value={tipo}
          onChange={(e) => {
            const t = e.target.value as TipoPagina;
            setTipo(t);
            if (!slugTocado && SLUG_SUGERIDO[t]) setSlug(SLUG_SUGERIDO[t]);
          }}
          ayuda="Las páginas legales tienen una sola versión publicada por país."
          error={errores.kind}
        />
      </div>
      <CampoTexto
        id="title"
        name="title"
        etiqueta="Título"
        value={titulo}
        maxLength={160}
        required
        error={errores.title}
        onChange={(e) => {
          setTitulo(e.target.value);
          if (!slugTocado) setSlug(slugificar(e.target.value));
        }}
      />
      <CampoTexto
        id="slug"
        name="slug"
        etiqueta="Identificador de URL"
        value={slug}
        maxLength={120}
        required
        ayuda="Solo minúsculas, números y guiones. Cambiarlo cambia el enlace público."
        error={errores.slug}
        onChange={(e) => {
          setSlugTocado(true);
          setSlug(e.target.value);
        }}
      />
      <div className="adm-campo">
        <div className="adm-fila">
          <label htmlFor="content_html" className="adm-etiqueta">
            Texto de la página
          </label>
          <button type="button" className="adm-boton adm-boton-secundario" onClick={() => setVerPrevia((v) => !v)}>
            {verPrevia ? 'Ocultar vista previa' : 'Ver vista previa'}
          </button>
        </div>
        <textarea
          id="content_html"
          name="content_html"
          className="adm-input adm-textarea adm-editor-html"
          rows={18}
          value={html}
          onChange={(e) => setHtml(e.target.value)}
          aria-invalid={errores.content_html ? true : undefined}
          aria-describedby="content_html-ayuda"
          spellCheck
        />
        <p id="content_html-ayuda" className="adm-suave adm-chico">
          HTML sencillo: títulos (h2, h3, h4), párrafos (p), listas (ul, ol, li), negrita (strong), cursiva (em), enlaces (a) y
          tablas. Al guardar se quita todo lo demás.
        </p>
        {errores.content_html ? <p className="adm-error-campo">{errores.content_html}</p> : null}
        {pendientes.length > 0 ? (
          <p className="adm-aviso" role="status">
            Hay textos por completar entre corchetes: {pendientes.slice(0, 5).join(', ')}. Mientras queden, la página solo se
            puede guardar como borrador.
          </p>
        ) : null}
        {verPrevia ? (
          <div className="adm-previa" aria-label="Vista previa" dangerouslySetInnerHTML={{ __html: previa }} />
        ) : null}
      </div>
      <fieldset className="adm-fieldset">
        <legend>SEO</legend>
        <CampoTexto
          id="seo_title"
          name="seo_title"
          etiqueta="Título SEO"
          defaultValue={inicial.seo_title}
          maxLength={70}
          ayuda="Hasta 70 caracteres. Si lo dejas vacío se usa el título."
          error={errores.seo_title}
        />
        <CampoAreaTexto
          id="seo_description"
          name="seo_description"
          etiqueta="Descripción SEO"
          defaultValue={inicial.seo_description}
          maxLength={160}
          ayuda="Hasta 160 caracteres."
          error={errores.seo_description}
        />
      </fieldset>
      <CampoSelect
        id="status"
        name="status"
        etiqueta="Estado"
        opciones={ESTADOS_PAGINA.map((e) => ({ valor: e, etiqueta: ETIQUETA_ESTADO[e] }))}
        value={publicar}
        onChange={(e) => setPublicar(e.target.value as EstadoPagina)}
        ayuda="Solo las publicadas se ven en la tienda."
        error={errores.status}
      />
      {reemplaza ? (
        <p className="adm-aviso" role="status">
          Ya hay una página publicada de este tipo en {NOMBRE_PAIS_PAGINA[pais]}: "{reemplaza.titulo}". Al guardar pasará a
          borrador y esta quedará como la vigente.
          {tipo === 'tratamiento_datos'
            ? ' Es la política que aceptan los clientes en el pago: su versión nueva se les pedirá aceptar.'
            : ''}
        </p>
      ) : null}
      {tipo === 'tratamiento_datos' && publicar !== 'published' && inicial.status === 'published' ? (
        <p className="adm-aviso" role="status">
          Sin política de tratamiento de datos publicada, el pago de {NOMBRE_PAIS_PAGINA[pais]} no puede crear pedidos.
        </p>
      ) : null}
      <div className="adm-acciones">
        <button type="submit" className="adm-boton" disabled={pendiente}>
          {pendiente ? 'Guardando…' : 'Guardar'}
        </button>
        <Link href={volverHref} className="adm-enlace-boton adm-boton-secundario">
          Cancelar
        </Link>
      </div>
    </form>
  );
}
