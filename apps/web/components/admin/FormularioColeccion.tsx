'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { ETIQUETA_REGLA, REGLAS, type TipoRegla } from '@/lib/admin/catalogo/colecciones';
import { NOMBRE_PAIS, PAISES_CATALOGO } from '@/lib/admin/catalogo/categorias';
import { ESTADO_INICIAL, slugificar, type ResultadoAccion } from '@/lib/admin/crud/comun';
import { CampoSelect, type OpcionSelect } from './CampoSelect';
import { CampoTexto } from './CampoTexto';

export type ValoresColeccion = {
  id?: string;
  country_code: 'CO' | 'EC';
  name: string;
  slug: string;
  type: 'manual' | 'rule';
  regla_tipo: TipoRegla | '';
  regla_valor: string;
  sort_order: number;
  show_in_home_tabs: boolean;
  is_active: boolean;
};

export function FormularioColeccion({
  inicial,
  categorias,
  accion,
  volverHref,
}: {
  inicial: ValoresColeccion;
  categorias: readonly OpcionSelect[];
  accion: (previo: ResultadoAccion, datos: FormData) => Promise<ResultadoAccion>;
  volverHref: string;
}) {
  const [estado, enviar, pendiente] = useActionState(accion, ESTADO_INICIAL);
  const [nombre, setNombre] = useState(inicial.name);
  const [slug, setSlug] = useState(inicial.slug);
  const [slugTocado, setSlugTocado] = useState(Boolean(inicial.slug));
  const [tipo, setTipo] = useState(inicial.type);
  const [regla, setRegla] = useState<TipoRegla | ''>(inicial.regla_tipo);
  const errores = estado.ok ? {} : (estado.errores ?? {});

  return (
    <form action={enviar} className="adm-form adm-form-ancho" noValidate>
      {inicial.id ? <input type="hidden" name="id" value={inicial.id} /> : null}
      {!estado.ok && estado.mensaje ? (
        <p className="adm-alerta" role="alert">
          {estado.mensaje}
        </p>
      ) : null}
      <CampoSelect
        id="country_code"
        name="country_code"
        etiqueta="País"
        opciones={PAISES_CATALOGO.map((p) => ({ valor: p, etiqueta: NOMBRE_PAIS[p] }))}
        defaultValue={inicial.country_code}
        error={errores.country_code}
        ayuda="Cada colección pertenece a un país."
      />
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
        error={errores.slug}
        onChange={(e) => {
          setSlugTocado(true);
          setSlug(e.target.value);
        }}
      />
      <CampoSelect
        id="type"
        name="type"
        etiqueta="Tipo"
        opciones={[
          { valor: 'manual', etiqueta: 'Manual (eliges los productos y su orden)' },
          { valor: 'rule', etiqueta: 'Por regla (se arma sola)' },
        ]}
        value={tipo}
        onChange={(e) => setTipo(e.target.value as 'manual' | 'rule')}
        error={errores.type}
      />
      {tipo === 'rule' ? (
        <fieldset className="adm-fieldset">
          <legend>Regla</legend>
          <CampoSelect
            id="regla_tipo"
            name="regla_tipo"
            etiqueta="Qué productos incluye"
            vacio="Elige una regla"
            opciones={REGLAS.map((r) => ({ valor: r, etiqueta: ETIQUETA_REGLA[r] }))}
            value={regla}
            onChange={(e) => setRegla(e.target.value as TipoRegla | '')}
            error={errores.regla_tipo}
          />
          {regla === 'category_id' ? (
            <CampoSelect
              id="regla_valor"
              name="regla_valor"
              etiqueta="Categoría"
              vacio="Elige una categoría"
              opciones={categorias}
              defaultValue={inicial.regla_valor}
              error={errores.regla_valor}
            />
          ) : regla ? (
            <CampoTexto
              id="regla_valor"
              name="regla_valor"
              etiqueta={regla === 'badge' ? 'Insignia' : 'Días'}
              defaultValue={inicial.regla_valor}
              inputMode={regla === 'badge' ? 'text' : 'numeric'}
              ayuda={regla === 'badge' ? 'Ej. hot_sale' : 'Entre 1 y 365.'}
              error={errores.regla_valor}
            />
          ) : null}
        </fieldset>
      ) : null}
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
      <label className="adm-check">
        <input type="checkbox" name="show_in_home_tabs" defaultChecked={inicial.show_in_home_tabs} />
        Mostrar como pestaña en el inicio de la tienda
      </label>
      <label className="adm-check">
        <input type="checkbox" name="is_active" defaultChecked={inicial.is_active} />
        Activa
      </label>
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
