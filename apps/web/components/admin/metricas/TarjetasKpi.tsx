import type { Kpi } from '@/lib/admin/metricas/kpis';
import { sentidoVariacion, textoVariacion } from '@/lib/admin/metricas/formato';

const LECTURA = { sube: 'subió', baja: 'bajó', igual: 'sin cambio', sin_base: 'sin comparación' } as const;
const FLECHA = { sube: '▲', baja: '▼', igual: '■', sin_base: '' } as const;

/** Tarjetas KPI (§21.3). La variación se lee en texto y flecha, nunca solo por color. */
export function TarjetasKpi({ kpis, titulo }: { kpis: readonly Kpi[]; titulo: string }) {
  return (
    <section aria-label={titulo}>
      <ul className="met-kpis">
        {kpis.map((k) => {
          const sentido = k.variacion === undefined ? null : sentidoVariacion(k.variacion);
          return (
            <li key={k.id} className="met-kpi">
              <span className="adm-suave met-kpi-etiqueta">{k.etiqueta}</span>
              <strong className="met-kpi-valor">{k.valor}</strong>
              {sentido ? (
                <span className="met-kpi-var" data-sentido={sentido} data-costo={k.costo ? 'si' : 'no'}>
                  <span aria-hidden="true">{FLECHA[sentido]} </span>
                  <span className="adm-visualmente-oculto">{LECTURA[sentido]}: </span>
                  {textoVariacion(k.variacion ?? null)}
                  <span className="adm-suave"> frente al periodo anterior</span>
                </span>
              ) : (
                <span className="adm-suave adm-chico">Periodo anterior: {k.antes}</span>
              )}
              {k.nota ? <span className="adm-suave adm-chico">{k.nota}</span> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
