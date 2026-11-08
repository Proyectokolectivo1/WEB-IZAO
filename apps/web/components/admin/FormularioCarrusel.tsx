'use client';

import { useActionState } from 'react';
import { CARRUSEL_SEGUNDOS } from '@/lib/admin/banners/banners';
import { ESTADO_INICIAL, type ResultadoAccion } from '@/lib/admin/crud/comun';
import { CampoTexto } from './CampoTexto';

/**
 * Ajustes del carrusel de un país: segundos entre imágenes y si también se muestra arriba del catálogo. La tienda los
 * lee de la base (nada fijo en el código) y los vuelve a acotar a 3–30 s.
 */
export function FormularioCarrusel({
  pais,
  segundos,
  enCatalogo,
  accion,
}: {
  pais: 'CO' | 'EC';
  segundos: number;
  enCatalogo: boolean;
  accion: (previo: ResultadoAccion, datos: FormData) => Promise<ResultadoAccion>;
}) {
  const [estado, enviar, pendiente] = useActionState(accion, ESTADO_INICIAL);
  const errores = estado.ok ? {} : (estado.errores ?? {});
  return (
    <form action={enviar} className="adm-form ban-ajustes" noValidate aria-labelledby="h-ajustes-carrusel">
      <h2 id="h-ajustes-carrusel">Ajustes del carrusel</h2>
      <input type="hidden" name="country_code" value={pais} />
      <CampoTexto
        id="interval_seconds"
        name="interval_seconds"
        etiqueta={`Segundos entre imágenes (${CARRUSEL_SEGUNDOS.minimo} a ${CARRUSEL_SEGUNDOS.maximo})`}
        inputMode="numeric"
        defaultValue={String(segundos)}
        ayuda="Cada imagen se queda este tiempo. Se detiene sola al pasar el cursor por encima, y con una sola imagen no se mueve."
        error={errores.interval_seconds}
      />
      <label className="adm-check">
        <input type="checkbox" name="show_in_catalog" defaultChecked={enCatalogo} />
        Mostrar también arriba del catálogo
      </label>
      {estado.mensaje ? (
        <p className={estado.ok ? 'adm-ok' : 'adm-alerta'} role={estado.ok ? 'status' : 'alert'}>
          {estado.mensaje}
        </p>
      ) : null}
      <div className="adm-acciones">
        <button type="submit" className="adm-boton" disabled={pendiente}>
          {pendiente ? 'Guardando…' : 'Guardar ajustes del carrusel'}
        </button>
      </div>
    </form>
  );
}
