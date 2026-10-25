'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { NOMBRE_PAIS, PAISES_CATALOGO } from '@/lib/admin/catalogo/categorias';
import { ESTADO_INICIAL, type ResultadoAccion } from '@/lib/admin/crud/comun';
import { CampoAreaTexto } from './CampoAreaTexto';
import { CampoSelect } from './CampoSelect';
import { CampoTexto } from './CampoTexto';

export type ValoresInfluencer = {
  id?: string;
  name: string;
  handle: string;
  country_code: 'CO' | 'EC';
  phone: string;
  email: string;
  commission_pct: string;
  notes: string;
  is_active: boolean;
};

export function FormularioInfluencer({
  inicial,
  accion,
  volverHref,
  paisBloqueado = false,
}: {
  inicial: ValoresInfluencer;
  accion: (previo: ResultadoAccion, datos: FormData) => Promise<ResultadoAccion>;
  volverHref: string;
  /** Con códigos asociados el país no se puede cambiar. */
  paisBloqueado?: boolean;
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
      <CampoTexto id="name" name="name" etiqueta="Nombre" defaultValue={inicial.name} maxLength={80} required error={errores.name} />
      <CampoTexto
        id="handle"
        name="handle"
        etiqueta="Usuario en redes (opcional)"
        defaultValue={inicial.handle}
        maxLength={60}
        autoComplete="off"
        ayuda="Sin la arroba."
        error={errores.handle}
      />
      <CampoSelect
        id="country_code"
        name="country_code"
        etiqueta="País"
        opciones={PAISES_CATALOGO.map((p) => ({ valor: p, etiqueta: NOMBRE_PAIS[p] }))}
        defaultValue={inicial.country_code}
        disabled={paisBloqueado}
        ayuda={paisBloqueado ? 'Tiene códigos asociados; no se puede cambiar de país.' : 'Sus códigos y reportes son de este país.'}
        error={errores.country_code}
      />
      {paisBloqueado ? <input type="hidden" name="country_code" value={inicial.country_code} /> : null}
      <CampoTexto id="phone" name="phone" etiqueta="Celular (opcional)" type="tel" defaultValue={inicial.phone} maxLength={30} error={errores.phone} />
      <CampoTexto id="email" name="email" etiqueta="Correo (opcional)" type="email" defaultValue={inicial.email} maxLength={120} error={errores.email} />
      <CampoTexto
        id="commission_pct"
        name="commission_pct"
        etiqueta="Comisión % (opcional)"
        inputMode="decimal"
        defaultValue={inicial.commission_pct}
        ayuda="Se calcula sobre los ingresos confirmados de sus pedidos. Vacío = sin comisión."
        error={errores.commission_pct}
      />
      <CampoAreaTexto id="notes" name="notes" etiqueta="Notas internas (opcional)" rows={3} defaultValue={inicial.notes} maxLength={500} error={errores.notes} />
      <label className="adm-check">
        <input type="checkbox" name="is_active" defaultChecked={inicial.is_active} />
        Activo
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
