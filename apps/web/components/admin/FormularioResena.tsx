'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { NOMBRE_PAIS, PAISES_CATALOGO } from '@/lib/admin/catalogo/categorias';
import { ESTADO_INICIAL, type ResultadoAccion } from '@/lib/admin/crud/comun';
import { ESTADOS_RESENA, ETIQUETA_ESTADO_RESENA } from '@/lib/admin/resenas/resenas';
import { CampoAreaTexto } from './CampoAreaTexto';
import { CampoSelect } from './CampoSelect';
import { CampoTexto } from './CampoTexto';

export type ValoresResena = {
  id?: string;
  country_code: 'CO' | 'EC';
  product_slug: string;
  author_name: string;
  city: string;
  rating: string;
  body: string;
  status: string;
  featured_home: boolean;
};

/** Reseña escrita por Izao (testimonios reales que el negocio quiere mostrar; nada de afirmar originalidad). */
export function FormularioResena({
  inicial,
  accion,
}: {
  inicial: ValoresResena;
  accion: (previo: ResultadoAccion, datos: FormData) => Promise<ResultadoAccion>;
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
        opciones={PAISES_CATALOGO.map((p) => ({ valor: p, etiqueta: NOMBRE_PAIS[p] }))}
        defaultValue={inicial.country_code}
        error={errores.country_code}
      />
      <CampoTexto
        id="product_slug"
        name="product_slug"
        etiqueta="Producto (opcional)"
        defaultValue={inicial.product_slug}
        autoComplete="off"
        ayuda="La URL del producto, por ejemplo «sauvage-edp-100ml». Vacío = reseña de la tienda."
        error={errores.product_slug}
      />
      <div className="adm-fila">
        <CampoTexto id="author_name" name="author_name" etiqueta="Nombre de quien opina" defaultValue={inicial.author_name} maxLength={60} required error={errores.author_name} />
        <CampoTexto id="city" name="city" etiqueta="Ciudad (opcional)" defaultValue={inicial.city} maxLength={60} error={errores.city} />
      </div>
      <CampoSelect
        id="rating"
        name="rating"
        etiqueta="Calificación"
        opciones={[5, 4, 3, 2, 1].map((n) => ({ valor: String(n), etiqueta: `${n} ${n === 1 ? 'estrella' : 'estrellas'}` }))}
        defaultValue={inicial.rating}
        error={errores.rating}
      />
      <CampoAreaTexto id="body" name="body" etiqueta="Texto" rows={5} defaultValue={inicial.body} maxLength={1000} required error={errores.body} />
      <CampoSelect
        id="status"
        name="status"
        etiqueta="Estado"
        opciones={ESTADOS_RESENA.map((e) => ({ valor: e, etiqueta: ETIQUETA_ESTADO_RESENA[e] }))}
        defaultValue={inicial.status}
        error={errores.status}
      />
      <label className="adm-check">
        <input type="checkbox" name="featured_home" defaultChecked={inicial.featured_home} />
        Destacar en el home (solo si está aprobada)
      </label>
      {errores.featured_home ? <p className="adm-error-campo">{errores.featured_home}</p> : null}
      <div className="adm-acciones">
        <button type="submit" className="adm-boton" disabled={pendiente}>
          {pendiente ? 'Guardando…' : 'Guardar reseña'}
        </button>
        <Link href="/admin/resenas?estado=todas&fuente=admin" className="adm-enlace-boton adm-boton-secundario">
          Cancelar
        </Link>
      </div>
    </form>
  );
}
