'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { ESTADO_INICIAL, slugificar, type ResultadoAccion } from '@/lib/admin/crud/comun';
import { NOMBRE_PAIS, PAISES_CATALOGO, type PaisCatalogo } from '@/lib/admin/catalogo/categorias';
import { CampoAreaTexto } from './CampoAreaTexto';
import { CampoSelect, type OpcionSelect } from './CampoSelect';
import { CampoTexto } from './CampoTexto';
import { SelectorImagen, type ImagenInicial } from './SelectorImagen';

export type ValoresCategoria = {
  id?: string;
  name: string;
  slug: string;
  parent_id: string;
  description: string;
  seo_title: string;
  seo_description: string;
  sort_order: number;
  show_in_menu: boolean;
  paises: Record<PaisCatalogo, { is_visible: boolean; sort_order: number }>;
  imagen: ImagenInicial;
  banner: ImagenInicial;
  tieneHijos: boolean;
};

export function FormularioCategoria({
  inicial,
  padres,
  accion,
  volverHref,
}: {
  inicial: ValoresCategoria;
  /** Categorías principales elegibles como padre (sin la actual). */
  padres: readonly OpcionSelect[];
  accion: (previo: ResultadoAccion, datos: FormData) => Promise<ResultadoAccion>;
  volverHref: string;
}) {
  const [estado, enviar, pendiente] = useActionState(accion, ESTADO_INICIAL);
  const [nombre, setNombre] = useState(inicial.name);
  const [slug, setSlug] = useState(inicial.slug);
  const [slugTocado, setSlugTocado] = useState(Boolean(inicial.slug));
  const errores = estado.ok ? {} : (estado.errores ?? {});

  return (
    <form action={enviar} className="adm-form adm-form-ancho" noValidate>
      {inicial.id ? <input type="hidden" name="id" value={inicial.id} /> : null}
      {!estado.ok && estado.mensaje ? (
        <p className="adm-alerta" role="alert">
          {estado.mensaje}
        </p>
      ) : null}
      <CampoTexto
        id="name"
        name="name"
        etiqueta="Nombre"
        value={nombre}
        maxLength={80}
        required
        error={errores.name}
        onChange={(e) => {
          setNombre(e.target.value);
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
      <CampoSelect
        id="parent_id"
        name="parent_id"
        etiqueta="Categoría padre"
        vacio="Ninguna (categoría principal)"
        opciones={padres}
        defaultValue={inicial.parent_id}
        disabled={inicial.tieneHijos}
        ayuda={
          inicial.tieneHijos
            ? 'Tiene subcategorías, por eso no puede tener padre (máximo 2 niveles).'
            : 'Solo se admiten 2 niveles.'
        }
        error={errores.parent_id}
      />
      <CampoAreaTexto
        id="description"
        name="description"
        etiqueta="Descripción"
        defaultValue={inicial.description}
        maxLength={2000}
        error={errores.description}
      />
      <fieldset className="adm-fieldset">
        <legend>Visibilidad por país</legend>
        <div className="adm-fila">
          {PAISES_CATALOGO.map((p) => (
            <div key={p} className="adm-pila">
              <label className="adm-check">
                <input type="checkbox" name={`visible_${p}`} defaultChecked={inicial.paises[p].is_visible} />
                Visible en {NOMBRE_PAIS[p]}
              </label>
              <CampoTexto
                id={`orden_${p}`}
                name={`orden_${p}`}
                etiqueta={`Orden en ${NOMBRE_PAIS[p]}`}
                type="number"
                inputMode="numeric"
                min={0}
                defaultValue={inicial.paises[p].sort_order}
                error={errores[`orden_${p}`]}
              />
            </div>
          ))}
        </div>
        <label className="adm-check">
          <input type="checkbox" name="show_in_menu" defaultChecked={inicial.show_in_menu} />
          Mostrar en el menú de la tienda
        </label>
        <CampoTexto
          id="sort_order"
          name="sort_order"
          etiqueta="Orden general"
          type="number"
          inputMode="numeric"
          min={0}
          defaultValue={inicial.sort_order}
          ayuda="Ordena las categorías hermanas; los menores van primero."
          error={errores.sort_order}
        />
      </fieldset>
      <SelectorImagen nombre="image_id" etiqueta="Imagen de la categoría" kind="category" inicial={inicial.imagen} error={errores.image_id} />
      <SelectorImagen
        nombre="banner_image_id"
        etiqueta="Banner de la categoría"
        kind="category"
        inicial={inicial.banner}
        error={errores.banner_image_id}
      />
      <fieldset className="adm-fieldset">
        <legend>SEO</legend>
        <CampoTexto
          id="seo_title"
          name="seo_title"
          etiqueta="Título SEO"
          defaultValue={inicial.seo_title}
          maxLength={70}
          ayuda="Hasta 70 caracteres. Si lo dejas vacío se usa el nombre."
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
