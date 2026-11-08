'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { NOMBRE_PAIS } from '@/lib/admin/catalogo/categorias';
import {
  ESTADOS_PRODUCTO,
  ETIQUETA_ESTADO,
  ETIQUETA_NIVEL,
  NIVELES,
  type PaisProductoForm,
  type ProductoForm,
} from '@/lib/admin/catalogo/productos';
import { ESTADO_INICIAL, slugificar, type ResultadoAccion } from '@/lib/admin/crud/comun';
import { CampoAreaTexto } from './CampoAreaTexto';
import { CampoSelect, type OpcionSelect } from './CampoSelect';
import { CampoTexto } from './CampoTexto';
import { ProductoImagenes } from './ProductoImagenes';
import { ProductoVariantes } from './ProductoVariantes';

export type OpcionesProducto = {
  marcas: readonly OpcionSelect[];
  generos: readonly OpcionSelect[];
  familias: readonly OpcionSelect[];
  concentraciones: readonly OpcionSelect[];
  categorias: readonly (OpcionSelect & { nivel: 0 | 1 })[];
  /** Países con MasterShop como transportadora (vínculo del país obligatorio para publicar). */
  paisesMastershop?: readonly ('CO' | 'EC')[];
};

/** Editor completo del producto. Todo el estado vive aquí y viaja al servidor como un solo campo `payload` (JSON). */
export function FormularioProducto({
  inicial,
  opciones,
  accion,
  volverHref,
}: {
  inicial: ProductoForm;
  opciones: OpcionesProducto;
  accion: (previo: ResultadoAccion, datos: FormData) => Promise<ResultadoAccion>;
  volverHref: string;
}) {
  const [estado, enviar, pendiente] = useActionState(accion, ESTADO_INICIAL);
  const [f, setF] = useState<ProductoForm>(inicial);
  const [slugTocado, setSlugTocado] = useState(Boolean(inicial.slug));
  const errores = estado.ok ? {} : (estado.errores ?? {});
  const mensajes = [...new Set(Object.values(errores))];
  const nuevoId = () => crypto.randomUUID();

  const poner = <K extends keyof ProductoForm>(clave: K, valor: ProductoForm[K]) => setF((p) => ({ ...p, [clave]: valor }));
  const ponerPais = (code: string, parcial: Partial<PaisProductoForm>) =>
    setF((p) => ({ ...p, countries: p.countries.map((c) => (c.country_code === code ? { ...c, ...parcial } : c)) }));

  return (
    <form action={enviar} className="adm-form adm-ancho-total" noValidate>
      <input type="hidden" name="payload" value={JSON.stringify(f)} />
      {!estado.ok && estado.mensaje ? (
        <div className="adm-resumen-errores" role="alert">
          <strong>{estado.mensaje}</strong>
          {mensajes.length > 0 ? (
            <ul>
              {mensajes.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <fieldset className="adm-fieldset">
        <legend>Datos del producto</legend>
        <CampoTexto
          id="name"
          etiqueta="Nombre"
          value={f.name}
          maxLength={200}
          required
          error={errores.name}
          onChange={(e) => {
            poner('name', e.target.value);
            if (!slugTocado) poner('slug', slugificar(e.target.value));
          }}
        />
        <CampoTexto
          id="slug"
          etiqueta="Identificador de URL"
          value={f.slug}
          maxLength={120}
          required
          ayuda="Solo minúsculas, números y guiones. Cambiarlo cambia el enlace público."
          error={errores.slug}
          onChange={(e) => {
            setSlugTocado(true);
            poner('slug', e.target.value);
          }}
        />
        <CampoSelect
          id="status"
          etiqueta="Estado"
          value={f.status}
          opciones={ESTADOS_PRODUCTO.map((s) => ({ valor: s, etiqueta: ETIQUETA_ESTADO[s] }))}
          ayuda="Solo los productos activos se muestran en la tienda. El borrador y el archivado quedan ocultos."
          onChange={(e) => poner('status', e.target.value as ProductoForm['status'])}
        />
        <CampoAreaTexto
          id="short_description"
          etiqueta="Descripción corta"
          value={f.short_description}
          maxLength={500}
          error={errores.short_description}
          onChange={(e) => poner('short_description', e.target.value)}
        />
        <CampoAreaTexto
          id="description_html"
          etiqueta="Descripción"
          value={f.description_html}
          maxLength={20000}
          ayuda="La descripción es común a todos los países. No afirmes originalidad ni afiliación con marcas."
          error={errores.description_html}
          onChange={(e) => poner('description_html', e.target.value)}
        />
      </fieldset>

      <fieldset className="adm-fieldset">
        <legend>Clasificación</legend>
        <div className="adm-fila">
          <CampoSelect id="brand_id" etiqueta="Marca" vacio="Sin marca" opciones={opciones.marcas} value={f.brand_id} onChange={(e) => poner('brand_id', e.target.value)} />
          <CampoSelect id="gender_id" etiqueta="Género" vacio="Sin género" opciones={opciones.generos} value={f.gender_id} onChange={(e) => poner('gender_id', e.target.value)} />
          <CampoSelect id="family_id" etiqueta="Familia olfativa" vacio="Sin familia" opciones={opciones.familias} value={f.family_id} onChange={(e) => poner('family_id', e.target.value)} />
          <CampoSelect id="concentration_id" etiqueta="Concentración" vacio="Sin concentración" opciones={opciones.concentraciones} value={f.concentration_id} onChange={(e) => poner('concentration_id', e.target.value)} />
        </div>
        <div role="group" aria-labelledby="categorias-titulo" className="adm-campo">
          <p id="categorias-titulo" className="adm-etiqueta">
            Categorías
          </p>
          {opciones.categorias.length === 0 ? (
            <p className="adm-suave adm-chico">
              Aún no hay categorías. <Link href="/admin/categorias/nueva">Crear la primera</Link>
            </p>
          ) : (
            <div className="adm-categorias">
              {opciones.categorias.map((c) => (
                <label key={c.valor} className={`adm-check ${c.nivel ? 'adm-sub' : ''}`.trim()}>
                  <input
                    type="checkbox"
                    checked={f.category_ids.includes(c.valor)}
                    onChange={(e) =>
                      poner('category_ids', e.target.checked ? [...f.category_ids, c.valor] : f.category_ids.filter((x) => x !== c.valor))
                    }
                  />
                  {c.etiqueta}
                </label>
              ))}
            </div>
          )}
        </div>
      </fieldset>

      <fieldset className="adm-fieldset">
        <legend>Notas y perfil</legend>
        <p className="adm-suave adm-chico">Separa los elementos con comas.</p>
        <div className="adm-fila">
          <CampoTexto id="notes_top" etiqueta="Notas de salida" value={f.notes_top} onChange={(e) => poner('notes_top', e.target.value)} />
          <CampoTexto id="notes_heart" etiqueta="Notas de corazón" value={f.notes_heart} onChange={(e) => poner('notes_heart', e.target.value)} />
          <CampoTexto id="notes_base" etiqueta="Notas de fondo" value={f.notes_base} onChange={(e) => poner('notes_base', e.target.value)} />
        </div>
        <div className="adm-fila">
          <CampoTexto id="occasion" etiqueta="Ocasiones" value={f.occasion} onChange={(e) => poner('occasion', e.target.value)} />
          <CampoTexto id="season" etiqueta="Estaciones" value={f.season} onChange={(e) => poner('season', e.target.value)} />
          <CampoSelect id="longevity" etiqueta="Duración" vacio="Sin indicar" opciones={NIVELES.map((n) => ({ valor: n, etiqueta: ETIQUETA_NIVEL[n] }))} value={f.longevity} onChange={(e) => poner('longevity', e.target.value as ProductoForm['longevity'])} />
          <CampoSelect id="sillage" etiqueta="Estela" vacio="Sin indicar" opciones={NIVELES.map((n) => ({ valor: n, etiqueta: ETIQUETA_NIVEL[n] }))} value={f.sillage} onChange={(e) => poner('sillage', e.target.value as ProductoForm['sillage'])} />
        </div>
      </fieldset>

      <fieldset className="adm-fieldset">
        <legend>Visibilidad por país</legend>
        <div className="adm-fila">
          {f.countries.map((c) => (
            <div key={c.country_code} className="adm-bloque-pais">
              <h4>{NOMBRE_PAIS[c.country_code]}</h4>
              <label className="adm-check">
                <input type="checkbox" checked={c.is_visible} onChange={(e) => ponerPais(c.country_code, { is_visible: e.target.checked })} />
                Visible en {NOMBRE_PAIS[c.country_code]}
              </label>
              {errores[`countries.${c.country_code}.is_visible`] ? (
                <p className="adm-error-campo" role="alert">
                  {errores[`countries.${c.country_code}.is_visible`]}
                </p>
              ) : null}
              <label className="adm-check">
                <input type="checkbox" checked={c.is_featured} onChange={(e) => ponerPais(c.country_code, { is_featured: e.target.checked })} />
                Destacado
              </label>
              <CampoTexto
                id={`rango-${c.country_code}`}
                etiqueta="Posición entre destacados"
                inputMode="numeric"
                value={c.featured_rank}
                error={errores[`countries.${c.country_code}.featured_rank`]}
                onChange={(e) => ponerPais(c.country_code, { featured_rank: e.target.value })}
              />
              <CampoTexto id={`insignias-${c.country_code}`} etiqueta="Insignias" value={c.badges} ayuda="Por ejemplo: Nuevo, Más vendido." onChange={(e) => ponerPais(c.country_code, { badges: e.target.value })} />
            </div>
          ))}
        </div>
      </fieldset>

      <ProductoVariantes
        form={f}
        cambiar={(actualizar) => setF(actualizar)}
        errores={errores}
        nuevoId={nuevoId}
        paisesMastershop={opciones.paisesMastershop ?? ['CO']}
      />

      <ProductoImagenes imagenes={f.images} alCambiar={(imgs) => poner('images', imgs)} altSugerido={f.name} error={errores.images} />

      <fieldset className="adm-fieldset">
        <legend>SEO</legend>
        <CampoTexto id="seo_title" etiqueta="Título SEO" value={f.seo_title} maxLength={70} ayuda="Hasta 70 caracteres. Si lo dejas vacío se usa el nombre." onChange={(e) => poner('seo_title', e.target.value)} />
        <CampoAreaTexto id="seo_description" etiqueta="Descripción SEO" value={f.seo_description} maxLength={160} ayuda="Hasta 160 caracteres." onChange={(e) => poner('seo_description', e.target.value)} />
      </fieldset>

      <div className="adm-acciones adm-pie-fijo">
        <button type="submit" className="adm-boton" disabled={pendiente}>
          {pendiente ? 'Guardando…' : 'Guardar producto'}
        </button>
        <Link href={volverHref} className="adm-enlace-boton adm-boton-secundario">
          Cancelar
        </Link>
      </div>
    </form>
  );
}
