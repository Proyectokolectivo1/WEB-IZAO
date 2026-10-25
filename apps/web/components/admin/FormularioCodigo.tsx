'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { NOMBRE_PAIS, PAISES_CATALOGO } from '@/lib/admin/catalogo/categorias';
import { ESTADO_INICIAL, type ResultadoAccion } from '@/lib/admin/crud/comun';
import {
  ALCANCES,
  ETIQUETA_ALCANCE,
  ETIQUETA_TIPO,
  TIPOS_DESCUENTO,
  type Alcance,
  type TipoDescuento,
  type ValoresCodigo,
} from '@/lib/admin/descuentos/codigos';
import { MONEDA_PAIS } from '@/lib/admin/pagos/ajustes';
import { CampoAreaTexto } from './CampoAreaTexto';
import { CampoSelect } from './CampoSelect';
import { CampoTexto } from './CampoTexto';

export type OpcionCategoriaForm = { id: string; etiqueta: string };
export type OpcionInfluencerForm = { id: string; etiqueta: string; pais: 'CO' | 'EC' };

/** Lista de categorías con casillas; envía una clave repetida por categoría marcada. */
function ListaCategorias({
  nombre,
  titulo,
  categorias,
  marcadas,
  error,
}: {
  nombre: string;
  titulo: string;
  categorias: readonly OpcionCategoriaForm[];
  marcadas: readonly string[];
  error?: string | undefined;
}) {
  return (
    <fieldset className="adm-fieldset" aria-describedby={error ? `${nombre}-error` : undefined}>
      <legend>{titulo}</legend>
      {categorias.length === 0 ? (
        <p className="adm-suave">Aún no hay categorías.</p>
      ) : (
        <div className="adm-lista-checks">
          {categorias.map((c) => (
            <label key={c.id} className="adm-check">
              <input type="checkbox" name={nombre} value={c.id} defaultChecked={marcadas.includes(c.id)} />
              {c.etiqueta}
            </label>
          ))}
        </div>
      )}
      {error ? (
        <p id={`${nombre}-error`} className="adm-error-campo">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

export function FormularioCodigo({
  modo,
  inicial,
  categorias,
  influencers,
  accion,
  volverHref,
}: {
  modo: 'codigo' | 'lote';
  inicial: ValoresCodigo;
  categorias: readonly OpcionCategoriaForm[];
  influencers: readonly OpcionInfluencerForm[];
  accion: (previo: ResultadoAccion, datos: FormData) => Promise<ResultadoAccion>;
  volverHref: string;
}) {
  const [estado, enviar, pendiente] = useActionState(accion, ESTADO_INICIAL);
  const [pais, setPais] = useState(inicial.country_code);
  const [tipo, setTipo] = useState<TipoDescuento>(inicial.type);
  const [alcance, setAlcance] = useState<Alcance>(inicial.applies_to);
  const errores = estado.ok ? {} : (estado.errores ?? {});
  const moneda = MONEDA_PAIS[pais];
  const deEstePais = influencers.filter((i) => i.pais === pais);

  return (
    <form action={enviar} className="adm-form adm-form-ancho" noValidate>
      {inicial.id ? <input type="hidden" name="id" value={inicial.id} /> : null}
      {!estado.ok && estado.mensaje ? (
        <p className="adm-alerta" role="alert">
          {estado.mensaje}
        </p>
      ) : null}

      {modo === 'codigo' ? (
        <CampoTexto
          id="code"
          name="code"
          etiqueta="Código"
          defaultValue={inicial.code}
          maxLength={30}
          required
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          ayuda="Letras, números, guion o guion bajo. Se guarda en mayúsculas y es único entre los dos países."
          error={errores.code}
        />
      ) : (
        <>
          <CampoTexto
            id="prefix"
            name="prefix"
            etiqueta="Prefijo del lote"
            maxLength={12}
            required
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            ayuda="Cada código queda como PREFIJO-XXXXXX (por ejemplo, VERANO-K7M2QX)."
            error={errores.prefix}
          />
          <CampoTexto
            id="quantity"
            name="quantity"
            etiqueta="Cantidad de códigos"
            type="number"
            inputMode="numeric"
            min={1}
            max={500}
            required
            ayuda="Entre 1 y 500 por lote."
            error={errores.quantity}
          />
        </>
      )}

      <CampoSelect
        id="country_code"
        name="country_code"
        etiqueta="País"
        opciones={PAISES_CATALOGO.map((p) => ({ valor: p, etiqueta: NOMBRE_PAIS[p] }))}
        value={pais}
        onChange={(e) => setPais(e.target.value as 'CO' | 'EC')}
        error={errores.country_code}
        ayuda="El código solo se puede usar en las compras de este país."
      />

      <fieldset className="adm-fieldset">
        <legend>Descuento</legend>
        <CampoSelect
          id="type"
          name="type"
          etiqueta="Tipo"
          opciones={TIPOS_DESCUENTO.map((t) => ({ valor: t, etiqueta: ETIQUETA_TIPO[t] }))}
          value={tipo}
          onChange={(e) => setTipo(e.target.value as TipoDescuento)}
          error={errores.type}
        />
        <CampoTexto
          id="value"
          name="value"
          etiqueta={tipo === 'percent' ? 'Porcentaje (1 a 100)' : `Valor del descuento (${moneda})`}
          defaultValue={inicial.value}
          inputMode={tipo === 'percent' || moneda === 'COP' ? 'numeric' : 'decimal'}
          required
          error={errores.value}
        />
        {tipo === 'percent' ? (
          <CampoTexto
            id="max_discount_amount"
            name="max_discount_amount"
            etiqueta={`Tope del descuento (${moneda}, opcional)`}
            defaultValue={inicial.max_discount_amount}
            inputMode={moneda === 'COP' ? 'numeric' : 'decimal'}
            ayuda="Lo máximo que descuenta el porcentaje en un pedido. Vacío = sin tope."
            error={errores.max_discount_amount}
          />
        ) : null}
        <CampoTexto
          id="min_subtotal"
          name="min_subtotal"
          etiqueta={`Compra mínima (${moneda}, opcional)`}
          defaultValue={inicial.min_subtotal}
          inputMode={moneda === 'COP' ? 'numeric' : 'decimal'}
          ayuda="Subtotal de los productos para poder usar el código. Vacío = sin mínimo."
          error={errores.min_subtotal}
        />
      </fieldset>

      <fieldset className="adm-fieldset">
        <legend>Vigencia y usos</legend>
        <CampoTexto
          id="starts_on"
          name="starts_on"
          etiqueta="Desde (opcional)"
          type="date"
          defaultValue={inicial.starts_on}
          ayuda="Hora de Colombia, desde el inicio del día."
          error={errores.starts_on}
        />
        <CampoTexto
          id="ends_on"
          name="ends_on"
          etiqueta="Hasta (opcional)"
          type="date"
          defaultValue={inicial.ends_on}
          ayuda="Incluye todo el día elegido."
          error={errores.ends_on}
        />
        <CampoTexto
          id="usage_limit_total"
          name="usage_limit_total"
          etiqueta="Usos totales (opcional)"
          inputMode="numeric"
          defaultValue={inicial.usage_limit_total}
          ayuda="Vacío = ilimitado."
          error={errores.usage_limit_total}
        />
        <CampoTexto
          id="usage_limit_per_customer"
          name="usage_limit_per_customer"
          etiqueta="Usos por cliente (opcional)"
          inputMode="numeric"
          defaultValue={inicial.usage_limit_per_customer}
          ayuda="Se cuenta por celular o correo del pedido."
          error={errores.usage_limit_per_customer}
        />
      </fieldset>

      <fieldset className="adm-fieldset">
        <legend>A qué aplica</legend>
        <CampoSelect
          id="applies_to"
          name="applies_to"
          etiqueta="Alcance"
          opciones={ALCANCES.map((a) => ({ valor: a, etiqueta: ETIQUETA_ALCANCE[a] }))}
          value={alcance}
          onChange={(e) => setAlcance(e.target.value as Alcance)}
          error={errores.applies_to}
        />
        {alcance === 'categories' ? (
          <ListaCategorias
            nombre="target_categories"
            titulo="Categorías incluidas"
            categorias={categorias}
            marcadas={inicial.target_categories}
            error={errores.target_categories}
          />
        ) : null}
        {alcance === 'products' ? (
          <CampoAreaTexto
            id="target_products"
            name="target_products"
            etiqueta="Productos incluidos"
            rows={4}
            defaultValue={inicial.target_products}
            ayuda="La URL del producto (la última parte de su dirección, por ejemplo mi-perfume), una por línea."
            error={errores.target_products}
          />
        ) : null}
        <details>
          <summary>Exclusiones (opcional)</summary>
          <ListaCategorias
            nombre="exclude_categories"
            titulo="Categorías excluidas"
            categorias={categorias}
            marcadas={inicial.exclude_categories}
            error={errores.exclude_categories}
          />
          <CampoAreaTexto
            id="exclude_products"
            name="exclude_products"
            etiqueta="Productos excluidos"
            rows={3}
            defaultValue={inicial.exclude_products}
            ayuda="La URL de cada producto, una por línea."
            error={errores.exclude_products}
          />
        </details>
        <label className="adm-check">
          <input type="checkbox" name="applies_to_sale_items" defaultChecked={inicial.applies_to_sale_items} />
          También aplica a productos que ya están rebajados
        </label>
      </fieldset>

      <fieldset className="adm-fieldset">
        <legend>Marketing</legend>
        <CampoSelect
          id="influencer_id"
          name="influencer_id"
          etiqueta="Influencer (opcional)"
          vacio="Sin influencer"
          opciones={deEstePais.map((i) => ({ valor: i.id, etiqueta: i.etiqueta }))}
          defaultValue={inicial.influencer_id}
          key={pais}
          ayuda="Las ventas con este código se atribuyen al influencer y alimentan su reporte."
          error={errores.influencer_id}
        />
        <label className="adm-check">
          <input type="checkbox" name="iza_can_offer" defaultChecked={inicial.iza_can_offer} />
          Iza puede ofrecerlo (el chatbot solo menciona los códigos marcados)
        </label>
      </fieldset>

      <p className="adm-suave adm-chico">
        Un solo código por pedido, no acumulable. Nunca se aplica con Addi ni Sistecrédito.
      </p>
      <label className="adm-check">
        <input type="checkbox" name="is_active" defaultChecked={inicial.is_active} />
        {modo === 'lote' ? 'Códigos activos desde que se generan' : 'Activo'}
      </label>
      <div className="adm-acciones">
        <button type="submit" className="adm-boton" disabled={pendiente}>
          {pendiente ? 'Guardando…' : modo === 'lote' ? 'Generar lote' : 'Guardar'}
        </button>
        <Link href={volverHref} className="adm-enlace-boton adm-boton-secundario">
          Cancelar
        </Link>
      </div>
    </form>
  );
}
