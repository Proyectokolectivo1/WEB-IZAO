'use client';

import { useActionState } from 'react';
import {
  CALIDAD_MAX,
  CALIDAD_MIN,
  MAX_MB_MAX,
  MAX_MB_MIN,
  type AjustesMedia,
} from '@/lib/admin/media/ajustes';
import { ESTADO_INICIAL, type ResultadoAccion } from '@/lib/admin/crud/comun';
import { CampoTexto } from './CampoTexto';

/** Calidad WebP y peso máximo de las imágenes subidas al panel. Toda imagen se convierte a WebP en el servidor. */
export function FormularioAjustesMedia({
  inicial,
  disponible,
  accion,
}: {
  inicial: AjustesMedia;
  /** `false` si la base aún no tiene la columna: se muestra el aviso y no se puede guardar. */
  disponible: boolean;
  accion: (previo: ResultadoAccion, datos: FormData) => Promise<ResultadoAccion>;
}) {
  const [estado, enviar, pendiente] = useActionState(accion, ESTADO_INICIAL);
  const errores = estado.ok ? {} : (estado.errores ?? {});
  return (
    <form action={enviar} className="adm-form" noValidate>
      <p className="adm-suave">
        Todas las imágenes que subes (productos, banners, categorías, sitio) se convierten a WebP en el servidor antes de
        guardarse; el formato original no se conserva. Se aceptan JPG, PNG, WebP y AVIF.
      </p>
      {!disponible ? <p className="adm-aviso">Estos ajustes aún no están disponibles en la base de datos; por ahora se usan los valores de fábrica.</p> : null}
      {estado.mensaje ? (
        <p className={estado.ok ? 'adm-ok' : 'adm-alerta'} role={estado.ok ? 'status' : 'alert'}>
          {estado.mensaje}
        </p>
      ) : null}
      <div className="fte-dos">
        <CampoTexto
          id="calidad"
          name="calidad"
          etiqueta={`Calidad WebP (${CALIDAD_MIN} a ${CALIDAD_MAX})`}
          inputMode="numeric"
          defaultValue={String(inicial.calidad)}
          ayuda="80 equilibra peso y nitidez. Más alto pesa más."
          error={errores.calidad}
          disabled={!disponible}
        />
        <CampoTexto
          id="maxMb"
          name="maxMb"
          etiqueta={`Peso máximo por imagen en MB (${MAX_MB_MIN} a ${MAX_MB_MAX})`}
          inputMode="numeric"
          defaultValue={String(inicial.maxMb)}
          error={errores.maxMb}
          disabled={!disponible}
        />
      </div>
      <div className="adm-acciones">
        <button type="submit" className="adm-boton" disabled={pendiente || !disponible}>
          {pendiente ? 'Guardando…' : 'Guardar ajustes de imagen'}
        </button>
      </div>
    </form>
  );
}
