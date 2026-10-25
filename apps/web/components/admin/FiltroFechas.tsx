import Link from 'next/link';
import { PRESETS_FECHA } from '@izao/core/metrics';
import { ETIQUETA_PRESET, type FiltroFechas as Filtro } from '@/lib/admin/metricas/filtros';

/**
 * Filtro de fecha por enlaces y un rango personalizado por GET (la URL es la fuente de verdad; funciona sin
 * JavaScript). `ocultos` conserva los demás filtros (país, etc.).
 */
export function FiltroFechas({
  base,
  filtro,
  ocultos = {},
  hoy,
}: {
  base: string;
  filtro: Filtro;
  ocultos?: Record<string, string>;
  hoy: string;
}) {
  const href = (extra: Record<string, string>) => `${base}?${new URLSearchParams({ ...ocultos, ...extra }).toString()}`;
  return (
    <div className="adm-filtro-fechas">
      <ul className="adm-pestanas" aria-label="Periodo">
        {PRESETS_FECHA.map((p) => (
          <li key={p}>
            <Link href={href({ rango: p })} aria-current={filtro.preset === p ? 'page' : undefined}>
              {ETIQUETA_PRESET[p]}
            </Link>
          </li>
        ))}
      </ul>
      <form className="adm-filtros" method="get" aria-label="Rango personalizado">
        {Object.entries(ocultos).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <div className="adm-campo">
          <label htmlFor="f-desde" className="adm-etiqueta">
            Desde
          </label>
          <input id="f-desde" name="desde" type="date" className="adm-input" defaultValue={filtro.rango.desde} max={hoy} required />
        </div>
        <div className="adm-campo">
          <label htmlFor="f-hasta" className="adm-etiqueta">
            Hasta
          </label>
          <input id="f-hasta" name="hasta" type="date" className="adm-input" defaultValue={filtro.rango.hasta} max={hoy} required />
        </div>
        <button type="submit" className="adm-boton adm-boton-secundario">
          Aplicar rango
        </button>
      </form>
      {filtro.corregido ? (
        <p className="adm-alerta" role="alert">
          El rango no es válido (fechas reales y máximo 12 meses). Mostramos el periodo por defecto.
        </p>
      ) : null}
    </div>
  );
}
