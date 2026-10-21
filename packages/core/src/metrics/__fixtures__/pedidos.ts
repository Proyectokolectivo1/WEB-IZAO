/**
 * Set de pedidos de prueba calculado a mano (skill izao-metricas). Todos atribuidos al 2026-10-20 en
 * America/Bogota. Los valores esperados están en `metrics.test.ts` con la cuenta escrita.
 *
 * Colombia (COP, exponente 0):
 * | id | método | estado          | total   | abono  | recaudo | costo   | pasarela | plataforma | envío              |
 * |----|--------|-----------------|---------|--------|---------|---------|----------|------------|--------------------|
 * | A  | wompi  | entregado       | 200 000 |        |         |  80 000 |    6 000 |            | real 12 000        |
 * | B  | wompi  | pagado          | 150 000 |        |         |  60 000 |    4 500 |            | — (no enviado)     |
 * | C  | addi   | en_transito     | 330 000 |        |         | 120 000 |   33 000 |            | tarifa 11 000 (est)|
 * | D  | cod    | entregado       | 180 000 | 20 000 | 160 000 |  70 000 |    1 200 |      4 800 | real 13 000        |
 * | E  | cod    | devuelto        | 120 000 | 20 000 | 100 000 |  50 000 |    1 200 |      3 000 | real 25 000        |
 * | F  | cod    | en_transito     | 140 000 | 20 000 | 120 000 |  55 000 |    1 200 |            | —                  |
 * | G  | cod    | abandonado      | 100 000 | 20 000 |  80 000 |         |          |            |                    |
 * | H  | wompi  | pendiente_pago  |  90 000 |        |         |         |          |            |                    |
 * | I  | cod    | esperando_abono |  95 000 | 20 000 |  75 000 |         |          |            |                    |
 * A tiene descuento 20 000; C tiene recargo de financiación 30 000.
 *
 * Ecuador (USD, exponente 2, centavos):
 * | J  | manual | entregado        | 4 599 | costo 2 000 | sin envío real ni tarifa → estimado del país 500 |
 * | K  | manual | pendiente_manual | 3 000 |
 */
import type { PedidoMetrica } from '../pedido';

const PAGADO = new Date('2026-10-20T15:00:00Z'); // 10:00 en Bogotá
const CREADO = new Date('2026-10-20T14:30:00Z');

function pedido(p: Partial<PedidoMetrica> & Pick<PedidoMetrica, 'id' | 'metodo' | 'estado' | 'total'>): PedidoMetrica {
  return {
    pais: 'CO',
    moneda: 'COP',
    creadoEn: CREADO,
    pagadoEn: null,
    descuento: 0n,
    recargo: 0n,
    abono: 0n,
    recaudo: 0n,
    costoProducto: 0n,
    comisionPasarela: 0n,
    comisionPlataforma: 0n,
    envioReal: null,
    tarifaEnvio: null,
    envioEstimadoPais: 9_000n,
    ...p,
  };
}

export const PEDIDOS_CO: readonly PedidoMetrica[] = [
  pedido({ id: 'A', metodo: 'wompi', estado: 'entregado', total: 200_000n, descuento: 20_000n, costoProducto: 80_000n, comisionPasarela: 6_000n, envioReal: 12_000n, pagadoEn: PAGADO }),
  pedido({ id: 'B', metodo: 'wompi', estado: 'pagado', total: 150_000n, costoProducto: 60_000n, comisionPasarela: 4_500n, pagadoEn: PAGADO }),
  pedido({ id: 'C', metodo: 'addi', estado: 'en_transito', total: 330_000n, recargo: 30_000n, costoProducto: 120_000n, comisionPasarela: 33_000n, tarifaEnvio: 11_000n, pagadoEn: PAGADO }),
  pedido({ id: 'D', metodo: 'cod', estado: 'entregado', total: 180_000n, abono: 20_000n, recaudo: 160_000n, costoProducto: 70_000n, comisionPasarela: 1_200n, comisionPlataforma: 4_800n, envioReal: 13_000n, pagadoEn: PAGADO }),
  pedido({ id: 'E', metodo: 'cod', estado: 'devuelto', total: 120_000n, abono: 20_000n, recaudo: 100_000n, costoProducto: 50_000n, comisionPasarela: 1_200n, comisionPlataforma: 3_000n, envioReal: 25_000n, pagadoEn: PAGADO }),
  pedido({ id: 'F', metodo: 'cod', estado: 'en_transito', total: 140_000n, abono: 20_000n, recaudo: 120_000n, costoProducto: 55_000n, comisionPasarela: 1_200n, pagadoEn: PAGADO }),
  pedido({ id: 'G', metodo: 'cod', estado: 'abandonado', total: 100_000n, abono: 20_000n, recaudo: 80_000n }),
  pedido({ id: 'H', metodo: 'wompi', estado: 'pendiente_pago', total: 90_000n }),
  pedido({ id: 'I', metodo: 'cod', estado: 'esperando_abono', total: 95_000n, abono: 20_000n, recaudo: 75_000n }),
];

export const PEDIDOS_EC: readonly PedidoMetrica[] = [
  pedido({ id: 'J', pais: 'EC', moneda: 'USD', metodo: 'manual', estado: 'entregado', total: 4_599n, costoProducto: 2_000n, envioEstimadoPais: 500n, pagadoEn: PAGADO }),
  pedido({ id: 'K', pais: 'EC', moneda: 'USD', metodo: 'manual', estado: 'pendiente_manual', total: 3_000n, envioEstimadoPais: 500n }),
];
