'use client';

import { COUNTRY_CURRENCY } from '@izao/core/money';
import {
  agregarOpcion,
  agregarValor,
  combinacionesFaltantes,
  etiquetaVariante,
  generarVariantes,
  marcarPorDefecto,
  quitarOpcion,
  quitarValor,
  quitarVariante,
  varianteNueva,
  type GeneradorId,
  type ProductoForm,
  type VarianteDelPaisForm,
  type VarianteForm,
} from '@/lib/admin/catalogo/productos';
import { NOMBRE_PAIS } from '@/lib/admin/catalogo/categorias';
import type { ErroresCampo } from '@/lib/admin/crud/comun';
import { CampoTexto } from './CampoTexto';

type Cambiar = (actualizar: (anterior: ProductoForm) => ProductoForm) => void;

/** Opciones (Tamaño, Presentación...) y variantes con precio, tachado, costo y stock por país, y vínculo MasterShop por país. */
export function ProductoVariantes({
  form,
  cambiar,
  errores,
  nuevoId,
  paisesMastershop = ['CO'],
}: {
  form: ProductoForm;
  cambiar: Cambiar;
  errores: ErroresCampo;
  nuevoId: GeneradorId;
  /** Países que despachan con MasterShop (ahí el vínculo del país es obligatorio para publicar). */
  paisesMastershop?: readonly string[];
}) {
  const faltantes = combinacionesFaltantes(form).length;

  function editarVariante(id: string, parcial: Partial<VarianteForm>) {
    cambiar((f) => ({ ...f, variants: f.variants.map((v) => (v.id === id ? { ...v, ...parcial } : v)) }));
  }
  function editarPais(id: string, pais: string, parcial: Partial<VarianteDelPaisForm>) {
    cambiar((f) => ({
      ...f,
      variants: f.variants.map((v) =>
        v.id === id ? { ...v, countries: v.countries.map((c) => (c.country_code === pais ? { ...c, ...parcial } : c)) } : v,
      ),
    }));
  }

  return (
    <>
      <fieldset className="adm-fieldset">
        <legend>Opciones</legend>
        <p className="adm-suave adm-chico">
          Las opciones (por ejemplo Tamaño: 50 ml, 100 ml) definen las variantes. Un producto sin opciones tiene una sola variante.
        </p>
        {form.options.map((o, i) => (
          <div key={o.id} className="adm-bloque-pais">
            <div className="adm-fila">
              <CampoTexto
                id={`opcion-${i}`}
                etiqueta="Nombre de la opción"
                value={o.name}
                maxLength={80}
                error={errores[`options.${i}.name`] ?? errores[`options.${i}.values`]}
                onChange={(e) =>
                  cambiar((f) => ({ ...f, options: f.options.map((x) => (x.id === o.id ? { ...x, name: e.target.value } : x)) }))
                }
              />
              <div className="adm-acciones" style={{ alignSelf: 'end' }}>
                <button type="button" className="adm-boton adm-boton-secundario adm-boton-chico" onClick={() => cambiar((f) => quitarOpcion(f, o.id))}>
                  Quitar opción
                </button>
              </div>
            </div>
            {o.values.map((v, j) => (
              <div key={v.id} className="adm-acciones">
                <CampoTexto
                  id={`opcion-${i}-valor-${j}`}
                  etiqueta={`Valor ${j + 1}`}
                  value={v.value}
                  maxLength={80}
                  error={errores[`options.${i}.values.${j}`]}
                  onChange={(e) =>
                    cambiar((f) => ({
                      ...f,
                      options: f.options.map((x) =>
                        x.id === o.id ? { ...x, values: x.values.map((y) => (y.id === v.id ? { ...y, value: e.target.value } : y)) } : x,
                      ),
                    }))
                  }
                />
                <button type="button" className="adm-boton adm-boton-secundario adm-boton-chico" style={{ alignSelf: 'end' }} onClick={() => cambiar((f) => quitarValor(f, o.id, v.id))}>
                  Quitar
                </button>
              </div>
            ))}
            <div>
              <button type="button" className="adm-boton adm-boton-secundario adm-boton-chico" onClick={() => cambiar((f) => agregarValor(f, o.id, nuevoId()))}>
                Agregar valor
              </button>
            </div>
          </div>
        ))}
        <div className="adm-acciones">
          {form.options.length < 3 ? (
            <button type="button" className="adm-boton adm-boton-secundario" onClick={() => cambiar((f) => agregarOpcion(f, nuevoId))}>
              Agregar opción
            </button>
          ) : null}
          {faltantes > 0 ? (
            <button type="button" className="adm-boton" onClick={() => cambiar((f) => generarVariantes(f, nuevoId))}>
              Crear {faltantes} variante{faltantes === 1 ? '' : 's'} faltante{faltantes === 1 ? '' : 's'}
            </button>
          ) : null}
        </div>
      </fieldset>

      <fieldset className="adm-fieldset">
        <legend>Variantes, precios y stock</legend>
        {errores.variants ? (
          <p className="adm-error-campo" role="alert">
            {errores.variants}
          </p>
        ) : null}
        {form.variants.map((v, i) => (
          <div key={v.id} className="adm-variante">
            <div className="adm-variante-cabecera">
              <strong>
                Variante {i + 1}: {etiquetaVariante(form.options, v)}
              </strong>
              <div className="adm-acciones">
                <label className="adm-check">
                  <input type="radio" name="variante-por-defecto" checked={v.is_default} onChange={() => cambiar((f) => marcarPorDefecto(f, v.id))} />
                  Variante por defecto
                </label>
                {form.variants.length > 1 ? (
                  <button type="button" className="adm-boton adm-boton-secundario adm-boton-chico" onClick={() => cambiar((f) => quitarVariante(f, v.id))}>
                    Quitar variante
                  </button>
                ) : null}
              </div>
            </div>

            {form.options.length > 0 ? (
              <div className="adm-fila">
                {form.options.map((o) => {
                  const actual = o.values.find((x) => v.option_value_ids.includes(x.id))?.id ?? '';
                  const ids = new Set(o.values.map((x) => x.id));
                  return (
                    <div key={o.id} className="adm-campo">
                      <label htmlFor={`v-${i}-op-${o.id}`} className="adm-etiqueta">
                        {o.name || 'Opción'}
                      </label>
                      <select
                        id={`v-${i}-op-${o.id}`}
                        className="adm-input"
                        value={actual}
                        onChange={(e) =>
                          editarVariante(v.id, {
                            option_value_ids: [...v.option_value_ids.filter((x) => !ids.has(x)), ...(e.target.value ? [e.target.value] : [])],
                          })
                        }
                      >
                        <option value="">Elegir…</option>
                        {o.values.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.value || '(sin nombre)'}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            ) : null}
            {errores[`variants.${i}.options`] ? (
              <p className="adm-error-campo" role="alert">
                {errores[`variants.${i}.options`]}
              </p>
            ) : null}

            <div className="adm-fila">
              <CampoTexto id={`v-${i}-sku`} etiqueta="SKU" value={v.sku} maxLength={80} error={errores[`variants.${i}.sku`]} onChange={(e) => editarVariante(v.id, { sku: e.target.value })} />
              <CampoTexto id={`v-${i}-peso`} etiqueta="Peso (kg)" inputMode="decimal" value={v.weight_kg} error={errores[`variants.${i}.weight_kg`]} onChange={(e) => editarVariante(v.id, { weight_kg: e.target.value })} />
              <div className="adm-campo">
                <label htmlFor={`v-${i}-imagen`} className="adm-etiqueta">
                  Imagen de la variante
                </label>
                <select id={`v-${i}-imagen`} className="adm-input" value={v.image_id} onChange={(e) => editarVariante(v.id, { image_id: e.target.value })}>
                  <option value="">La del producto</option>
                  {form.images.map((m, k) => (
                    <option key={m.media_id} value={m.media_id}>
                      Imagen {k + 1}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="adm-paises-variante">
              {v.countries.map((c) => {
                const moneda = COUNTRY_CURRENCY[c.country_code];
                const clave = `variants.${i}.${c.country_code}`;
                const idBase = `v-${i}-${c.country_code}`;
                return (
                  <div key={c.country_code} className="adm-bloque-pais">
                    <h4>
                      {NOMBRE_PAIS[c.country_code]} ({moneda})
                    </h4>
                    <label className="adm-check">
                      <input type="checkbox" checked={c.is_active} onChange={(e) => editarPais(v.id, c.country_code, { is_active: e.target.checked })} />
                      Se vende en {NOMBRE_PAIS[c.country_code]}
                    </label>
                    <div className="adm-fila">
                      <CampoTexto id={`${idBase}-precio`} etiqueta={`Precio (${moneda})`} inputMode="decimal" value={c.price} error={errores[`${clave}.price`]} onChange={(e) => editarPais(v.id, c.country_code, { price: e.target.value })} />
                      <CampoTexto id={`${idBase}-tachado`} etiqueta="Precio tachado" inputMode="decimal" value={c.compare_at_price} error={errores[`${clave}.compare_at_price`]} onChange={(e) => editarPais(v.id, c.country_code, { compare_at_price: e.target.value })} />
                      <CampoTexto id={`${idBase}-costo`} etiqueta="Costo" inputMode="decimal" value={c.cost} error={errores[`${clave}.cost`]} onChange={(e) => editarPais(v.id, c.country_code, { cost: e.target.value })} />
                      <CampoTexto id={`${idBase}-stock`} etiqueta="Stock" inputMode="numeric" value={c.stock} error={errores[`${clave}.stock`]} onChange={(e) => editarPais(v.id, c.country_code, { stock: e.target.value })} />
                      <CampoTexto id={`${idBase}-umbral`} etiqueta="Aviso de stock bajo" inputMode="numeric" value={c.low_stock_threshold} error={errores[`${clave}.low_stock_threshold`]} onChange={(e) => editarPais(v.id, c.country_code, { low_stock_threshold: e.target.value })} />
                    </div>
                    <div className="adm-fila">
                      <CampoTexto
                        id={`${idBase}-ms-producto`}
                        etiqueta={`MasterShop ${NOMBRE_PAIS[c.country_code]}: id del producto`}
                        inputMode="numeric"
                        value={c.mastershop_product_id}
                        error={errores[`${clave}.mastershop_product_id`]}
                        ayuda={
                          paisesMastershop.includes(c.country_code)
                            ? `Obligatorio para vender en ${NOMBRE_PAIS[c.country_code]}. Es el id de la cuenta de MasterShop de este país.`
                            : `Id de la cuenta de MasterShop de ${NOMBRE_PAIS[c.country_code]}. Este país aún no despacha con MasterShop.`
                        }
                        onChange={(e) => editarPais(v.id, c.country_code, { mastershop_product_id: e.target.value })}
                      />
                      <CampoTexto
                        id={`${idBase}-ms-variante`}
                        etiqueta={`MasterShop ${NOMBRE_PAIS[c.country_code]}: id de la variante`}
                        inputMode="numeric"
                        value={c.mastershop_variant_id}
                        error={errores[`${clave}.mastershop_variant_id`]}
                        ayuda="Solo si MasterShop la maneja aparte."
                        onChange={(e) => editarPais(v.id, c.country_code, { mastershop_variant_id: e.target.value })}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        {form.options.length > 0 ? (
          <div>
            <button type="button" className="adm-boton adm-boton-secundario" onClick={() => cambiar((f) => ({ ...f, variants: [...f.variants, varianteNueva(nuevoId())] }))}>
              Agregar variante
            </button>
          </div>
        ) : (
          <p className="adm-suave adm-chico">Para tener más de una variante agrega primero una opción.</p>
        )}
      </fieldset>
    </>
  );
}
