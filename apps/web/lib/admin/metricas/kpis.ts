/**
 * Tarjetas KPI de §21.3 (punto 1) a partir del resumen del periodo y del anterior. Puro: las cifras salen de
 * `ResumenPais` (núcleo) y aquí solo se decide el texto, la variación y la nota de cada tarjeta.
 */
import { variacionBp, type Bp, type ResumenPais } from '@izao/core/metrics';
import { dineroBig, porcentajeBp } from '../formato';
import { formatoRoas } from './formato';

export type Kpi = {
  id: string;
  etiqueta: string;
  valor: string;
  /** Variación relativa contra el periodo anterior; `undefined` si la tarjeta es una razón (se muestra "Antes"). */
  variacion?: Bp | null;
  /** Valor del periodo anterior en texto, para las razones. */
  antes?: string;
  nota?: string;
  /** `true` cuando subir es malo (costos): solo cambia el texto de lectura, no el color. */
  costo?: boolean;
};

export function kpisDe(a: ResumenPais, p: ResumenPais): Kpi[] {
  const m = (v: bigint) => dineroBig(v, a.moneda);
  const dinero = (id: string, etiqueta: string, actual: bigint, anterior: bigint, extra: Partial<Kpi> = {}): Kpi => ({
    id,
    etiqueta,
    valor: m(actual),
    variacion: variacionBp(actual, anterior),
    ...extra,
  });
  const razon = (id: string, etiqueta: string, actual: Bp | null, anterior: Bp | null, formato: (v: Bp | null) => string, nota?: string): Kpi => ({
    id,
    etiqueta,
    valor: formato(actual),
    antes: formato(anterior),
    ...(nota ? { nota } : {}),
  });
  return [
    dinero('ingresos', 'Ingresos totales', a.ingresosConfirmados, p.ingresosConfirmados, {
      nota:
        a.porCobrarEnTransito > 0n
          ? `Más ${m(a.porCobrarEnTransito)} por cobrar en tránsito`
          : 'Confirmados: prepagos enviados y contra entrega entregada',
    }),
    dinero('ventas', 'Ventas brutas', a.ventasBrutas, p.ventasBrutas),
    dinero('utilidad', 'Utilidad neta', a.utilidadNeta, p.utilidadNeta, { nota: `Margen ${porcentajeBp(a.margenNetoBp)}` }),
    dinero('comisiones', 'Comisiones', a.comisiones.total, p.comisiones.total, {
      costo: true,
      nota: `Wompi ${m(a.comisiones.wompi)} · Addi ${m(a.comisiones.addi)} · Sistecrédito ${m(a.comisiones.sistecredito)} · MasterShop ${m(a.comisiones.mastershop)}`,
    }),
    dinero('envios', 'Costo de envíos', a.costoEnvios, p.costoEnvios, {
      costo: true,
      ...(a.enviosEstimados > 0 ? { nota: `Estimado en ${a.enviosEstimados} pedido(s): aún no llega el costo real` } : {}),
    }),
    dinero('gastos', 'Gastos', a.gastos.total, p.gastos.total, { costo: true }),
    dinero('garantias', 'Garantías', a.garantias.costo, p.garantias.costo, {
      costo: true,
      nota: `${a.garantias.casos} caso(s) · tasa ${porcentajeBp(a.garantias.tasaBp)}`,
    }),
    {
      id: 'pagados',
      etiqueta: 'Pedidos pagados',
      valor: String(a.pedidosPagados),
      variacion: variacionBp(BigInt(a.pedidosPagados), BigInt(p.pedidosPagados)),
      nota: `${a.pedidosCreados} creados`,
    },
    {
      id: 'ticket',
      etiqueta: 'Ticket promedio',
      valor: a.ticketPromedio === null ? '—' : m(a.ticketPromedio),
      variacion: a.ticketPromedio === null || p.ticketPromedio === null ? null : variacionBp(a.ticketPromedio, p.ticketPromedio),
    },
    razon('conversion', 'Conversión', a.conversionBp, p.conversionBp, porcentajeBp, a.embudo.sesiones === 0n ? 'Sin sesiones registradas en el periodo' : undefined),
    razon('abonos', '% abonos pagados', a.abonosPagadosBp, p.abonosPagadosBp, porcentajeBp, 'Abonos pagados frente a abandonados'),
    razon('rechazo', '% rechazo contra entrega', a.rechazoContraEntregaBp, p.rechazoContraEntregaBp, porcentajeBp, 'Devueltos frente a finalizados'),
    razon('roas', 'ROAS', a.roasBp, p.roasBp, formatoRoas, a.gastoPauta === 0n ? 'Sin gasto de pauta en el periodo' : `Pauta ${m(a.gastoPauta)}`),
  ];
}
