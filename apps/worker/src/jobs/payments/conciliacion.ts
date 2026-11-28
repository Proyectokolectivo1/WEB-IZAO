/**
 * Conciliación de pagos Wompi contra la API (respaldo del webhook, D-059; §12.2). Si Wompi no llama a
 * `POST /api/webhooks/wompi` (URL de eventos sin configurar, secreto distinto, caída), un pago aprobado nunca
 * llegaba al pedido. Aquí, en cada corrida del barrido (`pedidos.barrido`, cada 2 min):
 *   1. Candidatos: pagos `wompi` (`full`/`cod_deposit`) creados en las últimas `VENTANA_CONCILIACION_MS` (48 h)
 *      cuyo pedido sigue en un estado de cobro (`pendiente_pago`, `pago_rechazado`, `expirado`,
 *      `esperando_abono`, `abandonado`), con cualquier estado del pago (un `declined` admite otro intento con la
 *      misma referencia; un `approved` sin aplicar se reintenta).
 *   2. Transacciones: pago completo por `GET /v1/transactions?reference=` (referencia oficial 1.2.0, llave
 *      privada); abono por `GET /v1/transactions?from_date&until_date&page&page_size` filtrando `payment_link_id`
 *      (Wompi no filtra por link). Solo estados finales (APPROVED, DECLINED, VOIDED, ERROR).
 *   3. Cada transacción final se procesa con `procesarTransaccionWompi` (`origen: 'conciliacion'`): el MISMO
 *      camino del webhook — reconsulta por id, compara monto y moneda con `payments`, nunca degrada un aprobado,
 *      transiciona con `transicionar` + `aplicar_transicion_pedido` condicional y repite solo pasos idempotentes
 *      (stock, canje, `carrier.create` con id fijo, CAPI con id fijo). Repetirlo no duplica efectos.
 *   4. Un aprobado que no se pudo aplicar (sin stock, monto distinto, duplicado, estado raro) deja la alerta
 *      `pago_aprobado_sin_aplicar` en `order_events` (panel; deduplicada por transacción en la fuente) y un
 *      `console.error` con prefijo `[alerta-pagos]` para el monitoreo.
 * Ritmo: con hasta `UMBRAL_RITMO` candidatos se consultan todos en cada corrida (lo normal; así el primer barrido
 * tras desplegar ya los cubre). Con más, los de menos de `RECIENTE_MS` (3 h) en cada corrida y los más viejos una vez
 * cada `PERIODO_ANTIGUOS_MS` (30 min) repartidos por hash del id. Tope de `MAX_CONSULTAS` llamadas por corrida (los
 * recientes primero). Si Wompi falla `MAX_FALLAS_SEGUIDAS` veces seguidas se corta la corrida (`wompi_caido`) y el
 * barrido no vence pedidos con pago pendiente sin conciliar. Cada corrida con candidatos deja una línea de resumen.
 * Nunca registra llaves ni cuerpos de respuesta.
 */
import type { OrderStatus } from '@izao/core/order-state';
import { ErrorWompi, type EstadoWompi, type TransaccionWompi, type WompiCredentials } from '@izao/wompi';
import { ErrorReintentable, type AccionPago } from './aprobacion.js';
import type { FuentePagosWorker, PagoFila } from './fuente.js';
import { procesarTransaccionWompi, type DepsJobWompi } from './wompi-transaccion.js';

export const VENTANA_CONCILIACION_MS = 48 * 3600_000;
export const RECIENTE_MS = 3 * 3600_000;
export const PERIODO_ANTIGUOS_MS = 30 * 60_000;
/** Debe coincidir con el cron del barrido (`CRON_BARRIDO_PEDIDOS`). */
export const INTERVALO_CONCILIACION_MS = 2 * 60_000;
export const MAX_FALLAS_SEGUIDAS = 3;
const MAX_CONSULTAS = 120;
/** Hasta cuántos candidatos se consultan todos en cada corrida, sin ritmo por antigüedad. */
export const UMBRAL_RITMO = 40;
const LIMITE_CANDIDATOS = 500;
const DIA_MS = 24 * 3600_000;

/** Estados del pedido en los que un pago aprobado todavía tiene que aplicarse. */
export const ESTADOS_COBRO: readonly OrderStatus[] = [
  'pendiente_pago',
  'pago_rechazado',
  'expirado',
  'esperando_abono',
  'abandonado',
];

const FINALES: ReadonlySet<EstadoWompi> = new Set<EstadoWompi>(['APPROVED', 'DECLINED', 'VOIDED', 'ERROR']);

/** Acciones de un aprobado que dejan el dinero aplicado o con su propio rastro para el admin. */
const APROBADO_RESUELTO: ReadonlySet<AccionPago> = new Set<AccionPago>([
  'pagado',
  'abono_pagado',
  'ya_pagado',
  'requiere_reembolso',
  'pago_tras_cancelacion',
  'sin_cambio',
]);

export interface PagoPorConciliar extends PagoFila {
  order_status: OrderStatus;
}

export interface FuenteConciliacion {
  /** Pagos `wompi` `full`/`cod_deposit` creados desde `desde` cuyo pedido está en `ESTADOS_COBRO`; recientes primero. */
  pagosPorConciliar(desde: Date, limite: number): Promise<PagoPorConciliar[]>;
}

export interface DepsConciliacion extends DepsJobWompi {
  fuente: FuentePagosWorker & FuenteConciliacion;
}

export interface ResultadoConciliacion {
  revisados: number;
  consultas: number;
  aplicados: number;
  sin_aplicar: number;
  omitidos: number;
  errores: number;
  wompi_caido: boolean;
}

export type EstadoConciliacionPedido = 'conciliado' | 'sin_pagos' | 'fallo';

export interface ConciliadorWompi {
  /** Recorre los candidatos de la ventana (una vez por corrida). */
  barrer(): Promise<ResultadoConciliacion>;
  /** Concilia ya todos los pagos Wompi del pedido (antes de vencerlo). `fallo` si alguno no se pudo consultar. */
  conciliarPedido(orderId: string): Promise<EstadoConciliacionPedido>;
}

function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

/** Turno de un pago viejo: una vez por periodo, repartido por hash para no consultar todos a la vez. */
export function enTurno(paymentId: string, ahora: Date, intervaloMs = INTERVALO_CONCILIACION_MS): boolean {
  const fase = hash(paymentId) % PERIODO_ANTIGUOS_MS;
  const t = (((ahora.getTime() - fase) % PERIODO_ANTIGUOS_MS) + PERIODO_ANTIGUOS_MS) % PERIODO_ANTIGUOS_MS;
  return t < intervaloMs;
}

const fecha = (d: Date) => d.toISOString().slice(0, 10);

/** Error de red/servidor de Wompi (cuenta para cortar la corrida), frente a uno propio del pago. */
function esCaidaWompi(e: unknown): boolean {
  if (e instanceof ErrorWompi) return e.reintentable || e.codigo === 'CREDENCIALES';
  return e instanceof ErrorReintentable && /: (RED|HTTP|RESPUESTA_INVALIDA|CREDENCIALES|consulta)$/.test(e.message);
}

export function crearConciliadorWompi(deps: DepsConciliacion): ConciliadorWompi {
  const { fuente } = deps;
  const ahora = (deps.ahora ?? (() => new Date()))();
  const r: ResultadoConciliacion = { revisados: 0, consultas: 0, aplicados: 0, sin_aplicar: 0, omitidos: 0, errores: 0, wompi_caido: false };
  const hechos = new Map<string, boolean>();
  let fallasSeguidas = 0;
  let creds: Promise<WompiCredentials | null> | null = null;
  let listado: Promise<TransaccionWompi[]> | null = null;

  const credenciales = () => (creds ??= fuente.credencialesWompi());

  /** Llamada a Wompi con el corte por caída. */
  async function llamar<T>(f: () => Promise<T>): Promise<T> {
    if (r.wompi_caido) throw new ErrorWompi('RED', true);
    r.consultas += 1;
    try {
      const v = await f();
      fallasSeguidas = 0;
      return v;
    } catch (e) {
      if (esCaidaWompi(e)) {
        fallasSeguidas += 1;
        if (fallasSeguidas >= MAX_FALLAS_SEGUIDAS && !r.wompi_caido) {
          r.wompi_caido = true;
          console.error(`[alerta-pagos] conciliación Wompi: API sin respuesta ${fallasSeguidas} veces seguidas, se corta la corrida`);
        }
      }
      throw e;
    }
  }

  async function transaccionesDe(p: PagoFila, c: WompiCredentials): Promise<TransaccionWompi[]> {
    const cliente = deps.cliente(c);
    if (p.purpose === 'full') {
      if (!p.provider_reference) return [];
      const ref = p.provider_reference;
      return (await llamar(() => cliente.buscarTransacciones({ reference: ref }))).filter((t) => t.reference === ref);
    }
    if (!p.payment_link_id) return [];
    listado ??= llamar(() =>
      cliente.buscarTransacciones({
        from_date: fecha(new Date(ahora.getTime() - VENTANA_CONCILIACION_MS - DIA_MS)),
        until_date: fecha(new Date(ahora.getTime() + DIA_MS)),
      }),
    );
    const link = p.payment_link_id;
    return (await listado).filter((t) => t.payment_link_id === link);
  }

  async function alertaSinAplicar(p: PagoFila, tx: TransaccionWompi, accion: AccionPago): Promise<void> {
    r.sin_aplicar += 1;
    console.error(`[alerta-pagos] pago aprobado sin aplicar: pedido ${p.order_id}, pago ${p.id}, motivo ${accion}`);
    await fuente.registrarAlerta(p.order_id, 'pago_aprobado_sin_aplicar', {
      payment_id: p.id,
      reference: tx.reference,
      transaction_id: tx.id,
      motivo_job: accion,
      origen: 'conciliacion',
    });
  }

  /** `true` si quedó conciliado (consultado y procesado sin error). */
  async function conciliarPago(p: PagoFila): Promise<boolean> {
    const previo = hechos.get(p.id);
    if (previo !== undefined) return previo;
    if (r.wompi_caido) return false; // corrida cortada: ni consulta ni ruido; la siguiente corrida lo intenta
    r.revisados += 1;
    let ok = true;
    try {
      const c = await credenciales();
      if (!c) {
        if (!r.wompi_caido) console.error('[alerta-pagos] conciliación Wompi: no hay credencial activa de Wompi CO legible');
        r.wompi_caido = true;
        throw new ErrorReintentable('sin_credenciales', 'conciliacion.wompi');
      }
      const finales = (await transaccionesDe(p, c)).filter((t) => FINALES.has(t.status));
      const aprobadas = finales.filter((t) => t.status === 'APPROVED').sort((a, b) => a.id.localeCompare(b.id));
      const pendienteLocal = p.status === 'created' || p.status === 'pending';
      // Un aprobado manda; un rechazo solo se aplica si el pago aún no lo refleja (evita trabajo repetido).
      const aProcesar = aprobadas.length > 0 ? aprobadas : pendienteLocal ? finales.slice(0, 1) : [];
      for (const tx of aProcesar) {
        const res = await llamar(() =>
          procesarTransaccionWompi({ event_id: `conciliacion.${tx.id}.${tx.status}`, transaction_id: tx.id, origen: 'conciliacion' }, deps),
        );
        if (tx.status !== 'APPROVED') continue;
        if (res.accion === 'pagado' || res.accion === 'abono_pagado') {
          r.aplicados += 1;
          console.log(`[worker] conciliación Wompi: pedido ${p.order_id} → ${res.accion} (pago ${p.id})`);
        } else if (!APROBADO_RESUELTO.has(res.accion)) {
          await alertaSinAplicar(p, tx, res.accion);
        }
      }
    } catch (e) {
      ok = false;
      r.errores += 1;
      console.error(`[worker] conciliación Wompi: pago ${p.id} sin conciliar: ${e instanceof Error ? e.message.slice(0, 120) : 'error'}`);
    }
    hechos.set(p.id, ok);
    return ok;
  }

  return {
    async barrer() {
      const candidatos = await fuente.pagosPorConciliar(new Date(ahora.getTime() - VENTANA_CONCILIACION_MS), LIMITE_CANDIDATOS);
      const conRitmo = candidatos.length > UMBRAL_RITMO;
      for (const p of candidatos) {
        if (r.wompi_caido) break;
        const edad = ahora.getTime() - new Date(p.created_at).getTime();
        if ((conRitmo && edad > RECIENTE_MS && !enTurno(p.id, ahora)) || r.consultas >= MAX_CONSULTAS) {
          r.omitidos += 1;
          continue;
        }
        await conciliarPago(p);
      }
      if (candidatos.length > 0) console.log(`[worker] conciliación Wompi: ${JSON.stringify({ candidatos: candidatos.length, ...r })}`);
      return { ...r };
    },

    async conciliarPedido(orderId) {
      const pagos = (await fuente.pagosDelPedido(orderId)).filter((p) => p.purpose === 'full' || p.purpose === 'cod_deposit');
      if (pagos.length === 0) return 'sin_pagos';
      let ok = true;
      for (const p of pagos) if (!(await conciliarPago(p))) ok = false;
      return ok ? 'conciliado' : 'fallo';
    },
  };
}
