import type { CurrencyCode } from '@izao/core/money';
import type { PuntoDiario } from '@izao/core/metrics';
import { dineroBig } from '@/lib/admin/formato';

const ANCHO = 640;
const ALTO = 200;
const MARGEN_SUP = 8;
const MARGEN_INF = 22;

/**
 * Ventas brutas (barras) e ingresos confirmados (línea) por día. SVG propio, sin librería: la escala usa números
 * solo para dibujar; los valores que se leen salen de los `bigint` (tabla de datos plegable y `aria-label`).
 */
export function GraficaDiaria({ serie, moneda, titulo }: { serie: readonly PuntoDiario[]; moneda: CurrencyCode; titulo: string }) {
  if (serie.length === 0) return null;
  let maximo = 0n;
  for (const p of serie) {
    if (p.ventasBrutas > maximo) maximo = p.ventasBrutas;
    if (p.ingresosConfirmados > maximo) maximo = p.ingresosConfirmados;
  }
  const util = ALTO - MARGEN_SUP - MARGEN_INF;
  const alturaDe = (v: bigint) => (maximo === 0n || v <= 0n ? 0 : (Number((v * 10_000n) / maximo) / 10_000) * util);
  const paso = ANCHO / serie.length;
  const grosor = Math.max(paso * 0.7, 1);
  const puntos = serie
    .map((p, i) => `${(i * paso + paso / 2).toFixed(1)},${(MARGEN_SUP + util - alturaDe(p.ingresosConfirmados)).toFixed(1)}`)
    .join(' ');
  const totalVentas = serie.reduce((a, p) => a + p.ventasBrutas, 0n);
  const totalIngresos = serie.reduce((a, p) => a + p.ingresosConfirmados, 0n);
  const resumen = `${titulo}: ventas brutas ${dineroBig(totalVentas, moneda)} e ingresos confirmados ${dineroBig(totalIngresos, moneda)} en ${serie.length} días.`;
  const etiquetas = [0, Math.floor((serie.length - 1) / 2), serie.length - 1].filter((v, i, a) => a.indexOf(v) === i);

  return (
    <figure className="met-grafica">
      <figcaption className="adm-suave">{titulo}</figcaption>
      <svg viewBox={`0 0 ${ANCHO} ${ALTO}`} role="img" aria-label={resumen} preserveAspectRatio="none" className="met-svg">
        <line x1="0" x2={ANCHO} y1={MARGEN_SUP + util} y2={MARGEN_SUP + util} className="met-eje" />
        {serie.map((p, i) => {
          const h = alturaDe(p.ventasBrutas);
          return (
            <rect
              key={p.fecha}
              x={(i * paso + (paso - grosor) / 2).toFixed(1)}
              y={(MARGEN_SUP + util - h).toFixed(1)}
              width={grosor.toFixed(1)}
              height={h.toFixed(1)}
              className="met-barra"
            />
          );
        })}
        <polyline points={puntos} fill="none" className="met-linea" />
        {etiquetas.map((i) => (
          <text
            key={i}
            x={Math.min(Math.max(i * paso + paso / 2, 28), ANCHO - 28).toFixed(1)}
            y={ALTO - 6}
            textAnchor="middle"
            className="met-texto-eje"
          >
            {serie[i]!.fecha.slice(5)}
          </text>
        ))}
      </svg>
      <p className="met-leyenda adm-chico">
        <span className="met-clave met-clave-barra" aria-hidden="true" /> Ventas brutas · <span className="met-clave met-clave-linea" aria-hidden="true" /> Ingresos confirmados
      </p>
      <details>
        <summary>Ver los datos por día</summary>
        <div className="adm-tabla-caja">
          <table className="adm-tabla adm-tabla-apilada">
            <caption className="adm-suave">{titulo}</caption>
            <thead>
              <tr>
                <th scope="col">Día</th>
                <th scope="col">Pedidos pagados</th>
                <th scope="col">Ventas brutas</th>
                <th scope="col">Ingresos confirmados</th>
              </tr>
            </thead>
            <tbody>
              {serie.map((p) => (
                <tr key={p.fecha}>
                  <th scope="row">{p.fecha}</th>
                  <td data-etiqueta="Pedidos pagados">{p.pedidosPagados}</td>
                  <td data-etiqueta="Ventas brutas">{dineroBig(p.ventasBrutas, moneda)}</td>
                  <td data-etiqueta="Ingresos confirmados">{dineroBig(p.ingresosConfirmados, moneda)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
