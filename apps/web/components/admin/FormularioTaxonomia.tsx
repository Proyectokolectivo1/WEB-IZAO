'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { ESTADO_INICIAL, slugificar, type ResultadoAccion } from '@/lib/admin/crud/comun';
import { CampoAreaTexto } from './CampoAreaTexto';
import { CampoTexto } from './CampoTexto';
import { SelectorImagen, type ImagenInicial } from './SelectorImagen';

export type CamposTaxonomia = {
  tieneDescripcion: boolean;
  tieneImagen: boolean;
  tieneOrden: boolean;
  ayudaImagen?: string | undefined;
};

export type ValoresTaxonomia = {
  id?: string;
  name: string;
  slug: string;
  description: string;
  sort_order: number;
  imagen: ImagenInicial;
};

/** Formulario único de marcas, familias, géneros y concentraciones. */
export function FormularioTaxonomia({
  campos,
  inicial,
  accion,
  volverHref,
}: {
  campos: CamposTaxonomia;
  inicial: ValoresTaxonomia;
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
      {campos.tieneDescripcion ? (
        <CampoAreaTexto
          id="description"
          name="description"
          etiqueta="Descripción"
          defaultValue={inicial.description}
          maxLength={2000}
          error={errores.description}
        />
      ) : null}
      {campos.tieneOrden ? (
        <CampoTexto
          id="sort_order"
          name="sort_order"
          etiqueta="Orden"
          type="number"
          inputMode="numeric"
          min={0}
          defaultValue={inicial.sort_order}
          ayuda="Los números menores aparecen primero."
          error={errores.sort_order}
        />
      ) : null}
      {campos.tieneImagen ? (
        <SelectorImagen
          nombre="image_id"
          etiqueta="Imagen"
          kind="site"
          inicial={inicial.imagen}
          ayuda={campos.ayudaImagen}
          error={errores.image_id}
        />
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
