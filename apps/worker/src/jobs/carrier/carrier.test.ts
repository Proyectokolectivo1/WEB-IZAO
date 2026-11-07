import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CARRIER_CREATE_RETRY_DELAYS_MS,
  LABEL_POLL_INTERVAL_MS,
  LABEL_POLL_MAX_ATTEMPTS,
  MasterShopCarrier,
  MasterShopClient,
} from '@izao/mastershop';
import { FakeClock, MasterShopMock, MOCK_LABEL_HOST, MS_ERRORS } from '@izao/mastershop/mock';
import { makeItem, makeOrder } from '@izao/mastershop/test-utils';
import { crearAlmacenEtiquetas } from './almacen-etiquetas.js';
import type { DepsCarrier } from './comun.js';
import { procesarCrear } from './crear.js';
import { procesarEtiqueta } from './etiqueta.js';
import { conRecalculoMetricas } from '../metrics/tras-transicion.js';
import type { FuenteCarrier } from './fuente.js';
import { FuenteMemoria, ProgramadorMemoria } from './fuente-memoria.js';
import { procesarSync } from './sincronizar.js';

/** Vista de objeto plano de la fuente en memoria (como la de PostgREST), para envolverla con `conRecalculoMetricas`. */
function fuentePlana(f: FuenteMemoria): FuenteCarrier {
  const proto = FuenteMemoria.prototype as unknown as Record<string, unknown>;
  const o: Record<string, unknown> = {};
  for (const k of Object.getOwnPropertyNames(proto)) {
    const v = proto[k];
    if (k !== 'constructor' && typeof v === 'function') o[k] = (v as (...a: unknown[]) => unknown).bind(f);
  }
  return o as unknown as FuenteCarrier;
}

const KEY = 'clave-de-prueba';
const creaciones = (m: MasterShopMock) => m.requests.filter((r) => r.method === 'POST' && r.path === '/api/orders').length;
const ID = 'order-1';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'izao-etiquetas-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function setup(opts: { autoLabel?: boolean } = {}) {
  const clock = new FakeClock();
  const mock = new MasterShopMock({ apiKey: KEY, clock, autoLabelOnConfirm: opts.autoLabel ?? false });
  const fuente = new FuenteMemoria();
  const programar = new ProgramadorMemoria();
  const deps: DepsCarrier = {
    fuente,
    programar,
    etiquetas: crearAlmacenEtiquetas({ mediaRoot: dir, fetchImpl: mock.fetch, hostsPermitidos: [MOCK_LABEL_HOST] }),
    transportadora: (creds, opciones) =>
      new MasterShopCarrier({
        client: new MasterShopClient({ apiKey: creds.apiKey, fetch: mock.fetch, clock }),
        clock,
        resolveOrderOptions: () => {
          if (!opciones) throw new Error('sin opciones de creación');
          return opciones;
        },
      }),
    ahora: () => new Date(clock.now()),
  };
  return { clock, mock, fuente, programar, deps };
}

describe('carrier.create contra el mock de MasterShop', () => {
  it('crea, guarda el envío, transiciona, confirma y programa la etiqueta', async () => {
    const { mock, fuente, programar, deps } = setup();
    fuente.agregar(makeOrder());
    const r = await procesarCrear({ order_id: ID, intento: 0 }, deps);
    expect(r).toEqual({ accion: 'confirmado', order_id: ID, provider_order_id: 1001 });
    expect(mock.orders.get(1001)?.statusId).toBe(2);
    expect(fuente.estado(ID)).toBe('enviado_transportadora');
    expect(fuente.fechas[ID]?.sent_to_carrier_at).toBeInstanceOf(Date);
    expect(await fuente.envio(ID)).toMatchObject({ provider_order_id: 1001, provider_status_id: 2, external_order_id: 'IZ-CO-000123' });
    expect(fuente.tipos(ID)).toEqual(['transportadora:creado', 'abono_pagado>enviado_transportadora', 'transportadora:confirmado']);
    expect(programar.jobs).toEqual([{ tipo: 'etiqueta', order_id: ID, intento: 0, espera: LABEL_POLL_INTERVAL_MS }]);
    // Total exacto (contra entrega: recaudo = 80.000) y notas con la referencia del abono.
    const body = mock.orders.get(1001)!.body as { order_transaction: { total: number; payment_method: string }; notes: string[] };
    expect(body.order_transaction).toMatchObject({ total: 80000, payment_method: 'cod' });
    expect(body.notes.join(' ')).toContain('ref-1');
  });

  it('es idempotente: repetir el job no crea otro pedido ni duplica eventos', async () => {
    const { mock, fuente, deps } = setup();
    fuente.agregar(makeOrder());
    await procesarCrear({ order_id: ID, intento: 0 }, deps);
    const n = fuente.eventos.length;
    const r = await procesarCrear({ order_id: ID, intento: 0 }, deps);
    expect(r.accion).toBe('ya_enviado');
    expect(creaciones(mock)).toBe(1);
    expect(fuente.eventos.length).toBe(n);
  });

  it('500 "409 - La orden ya existe": lo trata como creado y toma el id existente', async () => {
    const { mock, fuente, deps } = setup();
    fuente.agregar(makeOrder());
    mock.seed({ externalOrderId: 'IZ-CO-000123', createdAt: new Date() });
    const r = await procesarCrear({ order_id: ID, intento: 0 }, deps);
    expect(r).toMatchObject({ accion: 'confirmado', provider_order_id: 1001 });
    expect(mock.orders.size).toBe(1);
  });

  it('retoma tras una caída entre crear y transicionar sin volver a crear', async () => {
    const { mock, fuente, deps } = setup();
    fuente.agregar(makeOrder());
    mock.seed({ externalOrderId: 'IZ-CO-000123', createdAt: new Date() });
    await fuente.guardarEnvio(ID, { external_order_id: 'IZ-CO-000123', provider_order_id: 1001, provider_status_id: 1 });
    const r = await procesarCrear({ order_id: ID, intento: 0 }, deps);
    expect(r.accion).toBe('confirmado');
    expect(creaciones(mock)).toBe(0);
    expect(fuente.estado(ID)).toBe('enviado_transportadora');
  });

  it('5xx: reprograma con 30 s, 2 min, 10 min, 30 min, 2 h y al agotar pasa a error_transportadora', async () => {
    const { mock, fuente, programar, deps } = setup();
    fuente.agregar(makeOrder());
    const esperas: number[] = [];
    for (let intento = 0; intento <= CARRIER_CREATE_RETRY_DELAYS_MS.length; intento++) {
      mock.inject('create', { status: 500, body: MS_ERRORS.internal });
      mock.inject('create', { status: 500, body: MS_ERRORS.internal });
      mock.inject('create', { status: 500, body: MS_ERRORS.internal });
      const r = await procesarCrear({ order_id: ID, intento }, deps);
      const job = programar.sacar('crear');
      if (intento < CARRIER_CREATE_RETRY_DELAYS_MS.length) {
        expect(r.accion).toBe('reintento_programado');
        expect(job?.intento).toBe(intento + 1);
        esperas.push(job!.espera);
      } else {
        expect(r.accion).toBe('error_transportadora');
        expect(job).toBeUndefined();
      }
    }
    expect(esperas).toEqual([30_000, 120_000, 600_000, 1_800_000, 7_200_000]);
    expect(fuente.estado(ID)).toBe('error_transportadora');
    const alerta = fuente.eventos.find((e) => e.type === 'alerta');
    expect(alerta?.payload).toMatchObject({ motivo: 'error_transportadora', detalle: 'crear_reintentos_agotados' });
    expect(JSON.stringify(alerta?.payload)).not.toContain(KEY);
  });

  it('un error de validación no se reintenta: error_transportadora con el detalle; "Reintentar" lo envía', async () => {
    const { mock, fuente, programar, deps } = setup();
    fuente.agregar(makeOrder({ items: [makeItem({ mastershop_product_id: null })] }));
    const r = await procesarCrear({ order_id: ID, intento: 0 }, deps);
    expect(r.accion).toBe('error_transportadora');
    expect(programar.jobs.filter((j) => j.tipo === 'crear')).toEqual([]);
    expect(creaciones(mock)).toBe(0);
    // El admin vincula la variante y pulsa "Reintentar" (nuevo carrier.create).
    const o = (await fuente.pedido(ID))!;
    fuente.pedidos.set(ID, { ...o, items: [makeItem()] });
    const r2 = await procesarCrear({ order_id: ID, intento: 0 }, deps);
    expect(r2.accion).toBe('confirmado');
    expect(fuente.tipos(ID)).toContain('error_transportadora>enviado_transportadora');
  });

  it('sin credenciales: error_transportadora con alerta, sin llamar a la API', async () => {
    const { mock, fuente, deps } = setup();
    fuente.agregar(makeOrder());
    fuente.creds = null;
    expect((await procesarCrear({ order_id: ID, intento: 0 }, deps)).accion).toBe('error_transportadora');
    expect(mock.requests).toEqual([]);
  });

  it('502 al confirmar sin aplicarse: consulta, sigue en enviado_transportadora y reprograma la confirmación', async () => {
    const { mock, fuente, programar, deps } = setup();
    fuente.agregar(makeOrder());
    mock.inject('update', { status: 502, body: MS_ERRORS.notConfirmed, apply: false });
    const r = await procesarCrear({ order_id: ID, intento: 0 }, deps);
    expect(r.accion).toBe('reintento_programado');
    expect(mock.countRequests('PUT', '/api/orders/')).toBe(1);
    expect(fuente.estado(ID)).toBe('enviado_transportadora');
    const job = programar.sacar('crear')!;
    const r2 = await procesarCrear({ order_id: ID, intento: job.intento }, deps);
    expect(r2.accion).toBe('confirmado');
    expect(mock.orders.get(1001)?.statusId).toBe(2);
    expect(creaciones(mock)).toBe(1);
  });

  it('502 al confirmar que sí se aplicó: no reintenta el PUT', async () => {
    const { mock, fuente, deps } = setup();
    fuente.agregar(makeOrder());
    mock.inject('update', { status: 502, body: MS_ERRORS.notConfirmed, apply: true });
    const r = await procesarCrear({ order_id: ID, intento: 0 }, deps);
    expect(r.accion).toBe('confirmado');
    expect(mock.countRequests('PUT', '/api/orders/')).toBe(1);
  });

  it('sin confirmación automática: queda en 1 y no programa etiqueta', async () => {
    const { mock, fuente, programar, deps } = setup();
    fuente.agregar(makeOrder());
    fuente.ajustesPais = { proveedor: 'mastershop', autoConfirmar: false, modo: 'prorate' };
    expect((await procesarCrear({ order_id: ID, intento: 0 }, deps)).accion).toBe('creado');
    expect(mock.orders.get(1001)?.statusId).toBe(1);
    expect(programar.jobs).toEqual([]);
  });

  it('pago completo (pia): total = lo pagado y estados fuera de fase no hacen nada', async () => {
    const { mock, fuente, deps } = setup();
    fuente.agregar(makeOrder({ payment_method: 'wompi' }));
    await procesarCrear({ order_id: ID, intento: 0 }, deps);
    const body = mock.orders.get(1001)!.body as { order_transaction: { total: number; payment_method: string } };
    expect(body.order_transaction).toMatchObject({ total: 90000, payment_method: 'pia' });

    const s = setup();
    s.fuente.agregar(makeOrder({ status: 'esperando_abono' }));
    expect((await procesarCrear({ order_id: ID, intento: 0 }, s.deps)).accion).toBe('fuera_de_fase');
    expect(s.mock.requests).toEqual([]);
  });

  it('país sin transportadora: alerta y no llama a la API', async () => {
    const { mock, fuente, deps } = setup();
    fuente.agregar(makeOrder());
    fuente.ajustesPais = { proveedor: null, autoConfirmar: true, modo: 'prorate' };
    expect((await procesarCrear({ order_id: ID, intento: 0 }, deps)).accion).toBe('sin_transportadora');
    expect(mock.requests).toEqual([]);
    expect(fuente.estado(ID)).toBe('abono_pagado');
  });

  it('si otro proceso movió el pedido mientras se creaba, alerta y no lo pisa', async () => {
    const { fuente, deps } = setup();
    fuente.agregar(makeOrder());
    fuente.moverAntes = 'requiere_reembolso';
    expect((await procesarCrear({ order_id: ID, intento: 0 }, deps)).accion).toBe('movido_por_otro');
    expect(fuente.estado(ID)).toBe('requiere_reembolso');
    expect(fuente.tipos(ID)).toContain('alerta:pedido_movido_tras_crear');
  });
});

describe('carrier.poll_label', () => {
  it('sin etiqueta reprograma cada 2 min; con etiqueta descarga el PDF y crea un print_job', async () => {
    const { mock, fuente, programar, deps } = setup();
    fuente.agregar(makeOrder());
    await procesarCrear({ order_id: ID, intento: 0 }, deps);
    programar.sacar('etiqueta');
    expect((await procesarEtiqueta({ order_id: ID, intento: 0 }, deps)).accion).toBe('sin_etiqueta');
    expect(programar.sacar('etiqueta')).toMatchObject({ intento: 1, espera: LABEL_POLL_INTERVAL_MS });

    mock.attachLabel(1001, '240000000001');
    mock.setStatus(1001, 3);
    expect((await procesarEtiqueta({ order_id: ID, intento: 1 }, deps)).accion).toBe('guardada');
    const envio = (await fuente.envio(ID))!;
    expect(envio).toMatchObject({ tracking_code: '240000000001', label_local_path: 'labels/IZ-CO-000123.pdf' });
    expect((await readFile(join(dir, 'labels', 'IZ-CO-000123.pdf'), 'latin1')).startsWith('%PDF-')).toBe(true);
    expect(fuente.impresiones).toHaveLength(1);
    // Repetir no duplica la impresión.
    expect((await procesarEtiqueta({ order_id: ID, intento: 2 }, deps)).accion).toBe('ya_guardada');
    expect(fuente.impresiones).toHaveLength(1);
    expect(programar.jobs).toEqual([]);
  });

  it('al llegar al tope alerta y deja de consultar', async () => {
    const { fuente, programar, deps } = setup();
    fuente.agregar(makeOrder());
    await procesarCrear({ order_id: ID, intento: 0 }, deps);
    programar.sacar('etiqueta');
    expect((await procesarEtiqueta({ order_id: ID, intento: LABEL_POLL_MAX_ATTEMPTS - 1 }, deps)).accion).toBe('agotado');
    expect(programar.jobs).toEqual([]);
    expect(fuente.tipos(ID)).toContain('alerta:etiqueta_no_disponible');
  });

  it('una URL que no es PDF no se guarda y se vuelve a intentar', async () => {
    const { mock, fuente, programar, deps } = setup();
    fuente.agregar(makeOrder());
    await procesarCrear({ order_id: ID, intento: 0 }, deps);
    programar.sacar('etiqueta');
    mock.attachLabel(1001, 'G1');
    mock.orders.get(1001)!.shippingLabel = 'http://labels.example.com/G1.pdf';
    expect((await procesarEtiqueta({ order_id: ID, intento: 0 }, deps)).accion).toBe('consulta_programada');
    expect(fuente.impresiones).toEqual([]);
  });

  it('D-051: si el CDN bloquea al servidor (403) crea igual el print_job para que el agente la descargue', async () => {
    const { mock, fuente, programar, deps } = setup();
    // El mock responde 403 sin User-Agent: así se reproduce el bloqueo por IP del VPS.
    const bloqueado: DepsCarrier = {
      ...deps,
      etiquetas: crearAlmacenEtiquetas({ mediaRoot: dir, fetchImpl: mock.fetch, userAgent: '', hostsPermitidos: [MOCK_LABEL_HOST] }),
    };
    fuente.agregar(makeOrder());
    await procesarCrear({ order_id: ID, intento: 0 }, bloqueado);
    programar.sacar('etiqueta');
    mock.attachLabel(1001, '75070783091');
    mock.setStatus(1001, 3);

    expect((await procesarEtiqueta({ order_id: ID, intento: 0 }, bloqueado)).accion).toBe('remota');
    expect((await fuente.envio(ID))!).toMatchObject({ label_local_path: null, label_url: expect.stringContaining(MOCK_LABEL_HOST) });
    expect(fuente.impresiones).toHaveLength(1);
    expect(programar.jobs).toEqual([]);
    const porAgente = () => fuente.eventos.filter((e) => (e.payload as { accion?: string }).accion === 'etiqueta_por_agente');
    expect(porAgente()).toHaveLength(1);
    expect(fuente.eventos.some((e) => e.type === 'alerta')).toBe(false);

    // La sincronización vuelve a intentar la copia local sin duplicar trabajo ni evento ni alertar.
    await procesarSync({ event_id: 'e-403', provider_order_id: 1001, external_order_id: null, origen: 'webhook' }, bloqueado);
    expect(fuente.impresiones).toHaveLength(1);
    expect(porAgente()).toHaveLength(1);
    expect(fuente.eventos.some((e) => e.type === 'alerta')).toBe(false);

    // Cuando el CDN libera la IP, la siguiente sincronización guarda la copia local (sin otro print_job).
    await procesarSync({ event_id: 'e-200', provider_order_id: 1001, external_order_id: null, origen: 'polling' }, deps);
    expect((await fuente.envio(ID))!.label_local_path).toBe('labels/IZ-CO-000123.pdf');
    expect(fuente.impresiones).toHaveLength(1);
  });

  it('otros fallos de descarga (no 403) siguen reintentándose y no crean print_job', async () => {
    const { mock, fuente, programar, deps } = setup();
    const caido: DepsCarrier = { ...deps, etiquetas: { guardar: async () => Promise.reject(new Error('red caída')) } };
    fuente.agregar(makeOrder());
    await procesarCrear({ order_id: ID, intento: 0 }, caido);
    programar.sacar('etiqueta');
    mock.attachLabel(1001, 'G2');
    expect((await procesarEtiqueta({ order_id: ID, intento: 0 }, caido)).accion).toBe('consulta_programada');
    expect(fuente.impresiones).toEqual([]);
  });
});

describe('carrier.sync (webhook o polling)', () => {
  async function enviado() {
    const s = setup({ autoLabel: true });
    s.fuente.agregar(makeOrder());
    await procesarCrear({ order_id: ID, intento: 0 }, s.deps);
    s.programar.jobs.length = 0;
    return s;
  }

  it('reconsulta la API, ignora el cuerpo y aplica el camino de estados paso a paso', async () => {
    const { mock, fuente, deps } = await enviado();
    mock.setStatus(1001, 6);
    const r = await procesarSync({ event_id: 'e1', provider_order_id: 1001, external_order_id: null, origen: 'webhook' }, deps);
    expect(r).toMatchObject({ accion: 'transicionado', pasos: ['en_preparacion', 'en_transito'] });
    expect(fuente.estado(ID)).toBe('en_transito');
    expect(fuente.eventos.filter((e) => e.type === 'status_changed').at(-1)?.actor).toBe('webhook:mastershop');
    expect(fuente.webhooks.get('e1')).toEqual({ ok: true });
    // La etiqueta llegó con la confirmación (modo simulado) y se guardó en la sincronización.
    expect((await fuente.envio(ID))?.label_local_path).toBe('labels/IZ-CO-000123.pdf');
    expect(fuente.impresiones).toHaveLength(1);

    // Reentrega idéntica: sin cambios.
    const n = fuente.eventos.length;
    expect((await procesarSync({ event_id: 'e1', provider_order_id: 1001, external_order_id: null, origen: 'webhook' }, deps)).accion).toBe('sin_cambio');
    expect(fuente.eventos.length).toBe(n);
  });

  it('entregado fija delivered_at; un estado atrasado alerta sin mover el pedido', async () => {
    const { mock, fuente, deps } = await enviado();
    mock.setStatus(1001, 8);
    await procesarSync({ event_id: null, provider_order_id: 1001, external_order_id: null, origen: 'polling' }, deps);
    expect(fuente.estado(ID)).toBe('entregado');
    expect(fuente.fechas[ID]?.delivered_at).toBeInstanceOf(Date);
    mock.setStatus(1001, 5);
    expect((await procesarSync({ event_id: null, provider_order_id: 1001, external_order_id: null, origen: 'polling' }, deps)).accion).toBe('alerta');
    expect(fuente.estado(ID)).toBe('entregado');
    expect(fuente.tipos(ID)).toContain('alerta:sincronizacion');
  });

  it('pedido desconocido: marca el webhook y no falla', async () => {
    const { fuente, deps } = await enviado();
    const r = await procesarSync({ event_id: 'e9', provider_order_id: 999, external_order_id: 'IZ-CO-999999', origen: 'webhook' }, deps);
    expect(r.accion).toBe('pedido_desconocido');
    expect(fuente.webhooks.get('e9')).toEqual({ ok: true });
  });

  it('métricas (§21.4): cada transición encola el recálculo; una tarifa nueva sin transición también', async () => {
    const s = setup({ autoLabel: true });
    const recalculados: string[] = [];
    const recalcular = async (id: string) => void recalculados.push(id);
    const deps: DepsCarrier = { ...s.deps, fuente: conRecalculoMetricas(fuentePlana(s.fuente), recalcular), recalcularMetricas: recalcular };
    s.fuente.agregar(makeOrder());
    await procesarCrear({ order_id: ID, intento: 0 }, deps);
    expect(recalculados).toEqual([ID]);
    s.mock.orders.get(1001)!.shippingRate = 12000;
    s.mock.setStatus(1001, 6);
    const datos = { event_id: null, provider_order_id: 1001, external_order_id: null, origen: 'polling' } as const;
    expect((await procesarSync(datos, deps)).accion).toBe('transicionado');
    expect(recalculados).toHaveLength(3);
    await procesarSync(datos, deps);
    expect(recalculados).toHaveLength(3);
    s.mock.orders.get(1001)!.shippingRate = 13500;
    expect((await procesarSync(datos, deps)).accion).toBe('sin_cambio');
    expect(recalculados).toHaveLength(4);
  });

  it('si el recálculo falla la sincronización igual termina', async () => {
    const s = await enviado();
    const recalcular = async () => {
      throw new Error('redis caído');
    };
    const deps: DepsCarrier = { ...s.deps, fuente: conRecalculoMetricas(fuentePlana(s.fuente), recalcular), recalcularMetricas: recalcular };
    s.mock.orders.get(1001)!.shippingRate = 9000;
    s.mock.setStatus(1001, 6);
    const r = await procesarSync({ event_id: 'e5', provider_order_id: 1001, external_order_id: null, origen: 'webhook' }, deps);
    expect(r.accion).toBe('transicionado');
    expect(s.fuente.estado(ID)).toBe('en_transito');
  });

  it('un 5xx se relanza para que BullMQ reintente', async () => {
    const { mock, deps } = await enviado();
    for (let i = 0; i < 4; i++) mock.inject('get', { status: 500, body: MS_ERRORS.internal });
    await expect(
      procesarSync({ event_id: 'e2', provider_order_id: 1001, external_order_id: null, origen: 'webhook' }, deps),
    ).rejects.toMatchObject({ name: 'MasterShopError' });
  });
});
