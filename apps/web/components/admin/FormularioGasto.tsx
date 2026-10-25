'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { NOMBRE_PAIS, PAISES_CATALOGO } from '@/lib/admin/catalogo/categorias';
import { ESTADO_INICIAL, type ResultadoAccion } from '@/lib/admin/crud/comun';
import { CampoAreaTexto } from './CampoAreaTexto';
import { CampoSelect } from './CampoSelect';
import { CampoTexto } from './CampoTexto';

export type ValoresGasto = {
  id?: string;
  country_code: 'CO' | 'EC';
  category_id: string;
  date: string;
  /** Unidad mayor, como texto. */
  amount: string;
  description: string;
};

export function FormularioGasto({
  inicial,
  categorias,
  accion,
  volverHref,
  hoy,
}: {
  inicial: ValoresGasto;
  categorias: readonly { id: string; name: string }[];
  accion: (previo: ResultadoAccion, datos: FormData) => Promise<ResultadoAccion>;
  volverHref: string;
  /** Hoy en Bogotá: tope del selector de fecha. */
  hoy: string;
}) {
  const [estado, enviar, pendiente] = useActionState(accion, ESTADO_INICIAL);
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
        opciones={PAISES_CATALOGO.map((p) => ({ valor: p, etiqueta: `${NOMBRE_PAIS[p]} (${p === 'CO' ? 'COP' : 'USD'})` }))}
        defaultValue={inicial.country_code}
        ayuda="La moneda del gasto es la del país."
        error={errores.country_code}
      />
      <CampoSelect
        id="category_id"
        name="category_id"
        etiqueta="Categoría"
        vacio="Elige una categoría"
        opciones={categorias.map((c) => ({ valor: c.id, etiqueta: c.name }))}
        defaultValue={inicial.category_id}
        error={errores.category_id}
      />
      <div className="adm-fila">
        <CampoTexto id="date" name="date" etiqueta="Fecha" type="date" max={hoy} defaultValue={inicial.date} required error={errores.date} />
        <CampoTexto
          id="amount"
          name="amount"
          etiqueta="Valor"
          inputMode="decimal"
          defaultValue={inicial.amount}
          required
          ayuda="Pesos sin decimales (45000) o dólares con hasta 2 decimales (12.50)."
          error={errores.amount}
        />
      </div>
      <CampoAreaTexto id="description" name="description" etiqueta="Descripción (opcional)" rows={3} defaultValue={inicial.description} maxLength={300} error={errores.description} />
      <div className="adm-acciones">
        <button type="submit" className="adm-boton" disabled={pendiente}>
          {pendiente ? 'Guardando…' : 'Guardar gasto'}
        </button>
        <Link href={volverHref} className="adm-enlace-boton adm-boton-secundario">
          Cancelar
        </Link>
      </div>
    </form>
  );
}
