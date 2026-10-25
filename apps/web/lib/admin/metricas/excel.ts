/**
 * Hojas del Excel del dashboard (§21.3, punto 10): Resumen, Pedidos, Ciudades, Productos, Métodos de pago,
 * Gastos, Garantías e Influencers. Puro: recibe la vista ya calculada y devuelve hojas para `crearLibroXlsx`.
 * Los montos van como números con el formato de la moneda de su país (nunca texto, nunca `float`).
 */
import {
  ESTADOS_GARANTIA,
  METODOS_PAGO,
  cuentaComoIngreso,
  costoEnvioPedido,
  fechaAtribucion,
  ingresoConfirmado,
  type ResumenPais,
} from '@izao/core/metrics';
import type { CurrencyCode } from '@izao/core/money';
import type { Celda, Hoja } from '../excel/libro';
import { ETIQUETA_ESTADO_PEDIDO, ETIQUETA_METODO_PAGO } from '../pedidos/etiquetas';
import { topCiudades, topCodigos, topInfluencers, topProductos } from './dashboard';
import { formatoRoas } from './formato';
import type { VistaDetallada } from './servidor';

const NOMBRE_PAIS = { CO: 'Colombia', EC: 'Ecuador' } as const;
const LIMITE_COMPLETO = 100_000;

const monto = (valor: bigint, moneda: CurrencyCode): Celda => ({ tipo: 'monto', valor, moneda });
const entero = (valor: number | bigint): Celda => ({ tipo: 'entero', valor });
const bp = (valor: bigint | null): Celda => ({ tipo: 'bp', valor });
const si = (v: boolean) => (v ? 'Sí' : 'No');
const legible = (slug: string) => slug.replace(/_/g, ' ');

type Columna = { titulo: string; ancho?: number };

/** Filas del resumen: etiqueta y cómo leer el valor de un `ResumenPais`. */
const FILAS_RESUMEN: readonly [string, (r: ResumenPais) => Celda][] = [
  ['Pedidos creados', (r) => entero(r.pedidosCreados)],
  ['Pedidos pagados', (r) => entero(r.pedidosPagados)],
  ['Ventas brutas', (r) => monto(r.ventasBrutas, r.moneda)],
  ['Descuentos', (r) => monto(r.descuentos, r.moneda)],
  ['Recargos por financiación', (r) => monto(r.recargos, r.moneda)],
  ['Ingresos totales (confirmados)', (r) => monto(r.ingresosConfirmados, r.moneda)],
  ['Por cobrar en tránsito', (r) => monto(r.porCobrarEnTransito, r.moneda)],
  ['Comisión Wompi', (r) => monto(r.comisiones.wompi, r.moneda)],
  ['Comisión Addi', (r) => monto(r.comisiones.addi, r.moneda)],
  ['Comisión Sistecrédito', (r) => monto(r.comisiones.sistecredito, r.moneda)],
  ['Comisión de plataforma (MasterShop)', (r) => monto(r.comisiones.mastershop, r.moneda)],
  ['Comisiones totales', (r) => monto(r.comisiones.total, r.moneda)],
  ['Costo de producto', (r) => monto(r.costoProducto, r.moneda)],
  ['Costo de envíos', (r) => monto(r.costoEnvios, r.moneda)],
  ['Pedidos con envío estimado', (r) => entero(r.enviosEstimados)],
  ['Garantías: casos', (r) => entero(r.garantias.casos)],
  ['Garantías: costo asumido', (r) => monto(r.garantias.costo, r.moneda)],
  ['Garantías: tasa sobre entregados', (r) => bp(r.garantias.tasaBp)],
  ['Gastos totales', (r) => monto(r.gastos.total, r.moneda)],
  ['Gasto en pauta', (r) => monto(r.gastoPauta, r.moneda)],
  ['Utilidad neta', (r) => monto(r.utilidadNeta, r.moneda)],
  ['Margen neto', (r) => bp(r.margenNetoBp)],
  ['Ticket promedio', (r) => (r.ticketPromedio === null ? null : monto(r.ticketPromedio, r.moneda))],
  ['Conversión', (r) => bp(r.conversionBp)],
  ['% abonos pagados', (r) => bp(r.abonosPagadosBp)],
  ['% rechazo contra entrega', (r) => bp(r.rechazoContraEntregaBp)],
  ['ROAS', (r) => (r.roasBp === null ? null : formatoRoas(r.roasBp))],
];

function hojaResumen(v: VistaDetallada): Hoja {
  const bloques: { nombre: string; actual: ResumenPais; anterior: ResumenPais }[] = [];
  if (v.consolidado && !('error' in v.consolidado)) {
    bloques.push({ nombre: 'Consolidado en COP', actual: v.consolidado.actual, anterior: v.consolidado.anterior });
  }
  for (const p of v.paises) {
    bloques.push({ nombre: `${NOMBRE_PAIS[p.actual.pais]} (${p.actual.moneda})`, actual: p.actual.resumen, anterior: p.anterior.resumen });
  }
  const columnas: Columna[] = [{ titulo: `Indicador (${v.rango.desde} a ${v.rango.hasta})`, ancho: 38 }];
  for (const b of bloques) {
    columnas.push({ titulo: `${b.nombre}: periodo`, ancho: 24 }, { titulo: `${b.nombre}: periodo anterior`, ancho: 28 });
  }
  return {
    nombre: 'Resumen',
    columnas,
    filas: FILAS_RESUMEN.map(([etiqueta, leer]) => [etiqueta, ...bloques.flatMap((b) => [leer(b.actual), leer(b.anterior)])]),
  };
}

function hojaPedidos(v: VistaDetallada): Hoja {
  const filas: Celda[][] = [];
  for (const p of v.paises) {
    for (const d of p.detalles) {
      const x = d.pedido;
      const envio = costoEnvioPedido(x);
      filas.push([
        NOMBRE_PAIS[x.pais],
        d.numero,
        fechaAtribucion(x),
        ETIQUETA_ESTADO_PEDIDO[x.estado] ?? x.estado,
        ETIQUETA_METODO_PAGO[x.metodo] ?? x.metodo,
        d.ciudad ?? '',
        d.departamento ?? '',
        monto(x.total, x.moneda),
        monto(x.descuento, x.moneda),
        monto(x.recargo, x.moneda),
        monto(x.abono, x.moneda),
        monto(x.recaudo, x.moneda),
        monto(ingresoConfirmado(x), x.moneda),
        si(cuentaComoIngreso(x)),
        monto(x.comisionPasarela, x.moneda),
        monto(x.costoProducto, x.moneda),
        monto(envio.valor, x.moneda),
        si(envio.estimado),
        d.codigoId ? (v.nombres.codigos[d.codigoId] ?? '') : '',
        d.influencerId ? (v.nombres.influencers[d.influencerId] ?? '') : '',
        d.fuente,
        d.guia?.estado ?? '',
        d.guia ? si(d.guia.novedad) : '',
      ]);
    }
  }
  return {
    nombre: 'Pedidos',
    columnas: [
      { titulo: 'País' },
      { titulo: 'Pedido', ancho: 16 },
      { titulo: 'Fecha de atribución', ancho: 18 },
      { titulo: 'Estado', ancho: 22 },
      { titulo: 'Método de pago', ancho: 22 },
      { titulo: 'Ciudad', ancho: 20 },
      { titulo: 'Departamento', ancho: 20 },
      { titulo: 'Total del cliente', ancho: 18 },
      { titulo: 'Descuento', ancho: 14 },
      { titulo: 'Recargo', ancho: 14 },
      { titulo: 'Abono', ancho: 14 },
      { titulo: 'Recaudo', ancho: 14 },
      { titulo: 'Ingreso confirmado', ancho: 20 },
      { titulo: 'Cuenta como ingreso' },
      { titulo: 'Comisión de pasarela', ancho: 20 },
      { titulo: 'Costo de producto', ancho: 18 },
      { titulo: 'Costo de envío', ancho: 16 },
      { titulo: 'Envío estimado' },
      { titulo: 'Código de descuento', ancho: 20 },
      { titulo: 'Influencer', ancho: 22 },
      { titulo: 'Fuente', ancho: 24 },
      { titulo: 'Estado de la guía', ancho: 24 },
      { titulo: 'Con novedad' },
    ],
    filas,
  };
}

function hojaCiudades(v: VistaDetallada): Hoja {
  const filas: Celda[][] = [];
  for (const p of v.paises) {
    for (const c of topCiudades(p.detalles, LIMITE_COMPLETO)) {
      filas.push([NOMBRE_PAIS[p.actual.pais], c.ciudad, c.departamento, entero(c.pedidos), monto(c.ventasBrutas, p.actual.moneda), entero(c.entregados), entero(c.devueltos), bp(c.devolucionBp)]);
    }
  }
  return {
    nombre: 'Ciudades',
    columnas: [{ titulo: 'País' }, { titulo: 'Ciudad', ancho: 24 }, { titulo: 'Departamento', ancho: 24 }, { titulo: 'Pedidos pagados' }, { titulo: 'Ventas brutas', ancho: 18 }, { titulo: 'Entregados' }, { titulo: 'Devueltos' }, { titulo: '% devolución' }],
    filas,
  };
}

function hojaProductos(v: VistaDetallada): Hoja {
  const filas: Celda[][] = [];
  for (const p of v.paises) {
    for (const x of topProductos(p.detalles, LIMITE_COMPLETO)) {
      filas.push([NOMBRE_PAIS[p.actual.pais], x.nombre, entero(x.unidades), monto(x.ventas, p.actual.moneda), monto(x.costo, p.actual.moneda), monto(x.utilidad, p.actual.moneda), entero(x.unidadesSinCosto)]);
    }
  }
  return {
    nombre: 'Productos',
    columnas: [{ titulo: 'País' }, { titulo: 'Producto', ancho: 40 }, { titulo: 'Unidades' }, { titulo: 'Ventas', ancho: 18 }, { titulo: 'Costo', ancho: 18 }, { titulo: 'Utilidad', ancho: 18 }, { titulo: 'Unidades sin costo cargado', ancho: 24 }],
    filas,
  };
}

function hojaMetodos(v: VistaDetallada): Hoja {
  const filas: Celda[][] = [];
  for (const p of v.paises) {
    const r = p.actual.resumen;
    for (const m of METODOS_PAGO) {
      const x = r.porMetodo[m];
      if (x.pedidosPagados === 0) continue;
      filas.push([NOMBRE_PAIS[p.actual.pais], ETIQUETA_METODO_PAGO[m] ?? m, entero(x.pedidosPagados), monto(x.ventasBrutas, r.moneda), monto(x.recargos, r.moneda)]);
    }
  }
  return {
    nombre: 'Métodos de pago',
    columnas: [{ titulo: 'País' }, { titulo: 'Método', ancho: 26 }, { titulo: 'Pedidos pagados' }, { titulo: 'Ventas brutas', ancho: 18 }, { titulo: 'Recargos cobrados', ancho: 20 }],
    filas,
  };
}

function hojaGastos(v: VistaDetallada): Hoja {
  const filas: Celda[][] = [];
  for (const p of v.paises) {
    const r = p.actual.resumen;
    for (const [cat, total] of Object.entries(r.gastos.porCategoria).sort(([a], [b]) => a.localeCompare(b))) {
      filas.push([NOMBRE_PAIS[p.actual.pais], legible(cat), monto(total, r.moneda)]);
    }
  }
  return { nombre: 'Gastos', columnas: [{ titulo: 'País' }, { titulo: 'Categoría', ancho: 28 }, { titulo: 'Total del periodo', ancho: 20 }], filas };
}

function hojaGarantias(v: VistaDetallada): Hoja {
  const filas: Celda[][] = [];
  for (const p of v.paises) {
    const g = p.actual.resumen.garantias;
    for (const e of ESTADOS_GARANTIA) filas.push([NOMBRE_PAIS[p.actual.pais], e.replace('_', ' '), entero(g.porEstado[e] ?? 0), null]);
    filas.push([NOMBRE_PAIS[p.actual.pais], 'Total (costo asumido, sin rechazadas)', entero(g.casos), monto(g.costo, p.actual.moneda)]);
  }
  return { nombre: 'Garantías', columnas: [{ titulo: 'País' }, { titulo: 'Estado', ancho: 36 }, { titulo: 'Casos' }, { titulo: 'Costo asumido', ancho: 18 }], filas };
}

function hojaInfluencers(v: VistaDetallada): Hoja {
  const filas: Celda[][] = [];
  for (const p of v.paises) {
    for (const x of topInfluencers(p.detalles, LIMITE_COMPLETO)) {
      filas.push([NOMBRE_PAIS[p.actual.pais], v.nombres.influencers[x.clave] ?? '(eliminado)', entero(x.pedidos), entero(x.pagados), monto(x.ventasBrutas, p.actual.moneda), monto(x.ingresosConfirmados, p.actual.moneda)]);
    }
    for (const x of topCodigos(p.detalles, LIMITE_COMPLETO)) {
      filas.push([NOMBRE_PAIS[p.actual.pais], `Código ${v.nombres.codigos[x.clave] ?? '(eliminado)'}`, entero(x.pedidos), entero(x.pagados), monto(x.ventasBrutas, p.actual.moneda), monto(x.ingresosConfirmados, p.actual.moneda)]);
    }
  }
  return {
    nombre: 'Influencers',
    columnas: [{ titulo: 'País' }, { titulo: 'Influencer o código', ancho: 30 }, { titulo: 'Pedidos' }, { titulo: 'Pedidos pagados' }, { titulo: 'Ventas brutas', ancho: 18 }, { titulo: 'Ingresos confirmados', ancho: 22 }],
    filas,
  };
}

/** Las 8 hojas de §21.3. */
export function hojasDelDashboard(v: VistaDetallada): Hoja[] {
  return [hojaResumen(v), hojaPedidos(v), hojaCiudades(v), hojaProductos(v), hojaMetodos(v), hojaGastos(v), hojaGarantias(v), hojaInfluencers(v)];
}
