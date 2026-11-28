/**
 * D-062: umbral de flete para la impresión automática de la guía, contra el mock de MasterShop.
 * Si `shipping_rate` supera `country_settings.auto_print_max_shipping_rate`, no se crea el `print_job` automático,
 * queda una sola vez el evento `transportadora:impresion_manual_requerida` y la alerta del panel.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MasterShopCarrier, MasterShopClient } from '@izao/mastershop';
import { FakeClock, MasterShopMock, MOCK_LABEL_HOST } from '@izao/mastershop/mock';
import { makeOrder } from '@izao/mastershop/test-utils';
import { crearAlmacenEtiquetas } from './almacen-etiquetas.js';
import type { DepsCarrier } from './comun.js';
import { procesarCrear } from './crear.js';
import { procesarEtiqueta } from './etiqueta.js';
import { FuenteMemoria, ProgramadorMemoria } from './fuente-memoria.js';
import { procesarSync } from './sincronizar.js';

const KEY = 'clave-de-prueba';
const ID = 'order-1';
const PID = 1001;

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'izao-umbral-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Pedido creado y confirmado en el mock, con la guía lista y el flete dado (unidad menor). */
async function preparar(flete: number | null, umbral: bigint | null, opts: { cdnBloqueado?: boolean } = {}) {
  const clock = new FakeClock();
  const mock = new MasterShopMock({ apiKey: KEY, clock });
  const fuente = new FuenteMemoria();
  fuente.umbral = umbral;
  const programar = new ProgramadorMemoria();
  const deps: DepsCarrier = {
    fuente,
    programar,
    etiquetas: crearAlmacenEtiquetas({
      mediaRoot: dir,
      fetchImpl: mock.fetch,
      hostsPermitidos: [MOCK_LABEL_HOST],
      // Sin User-Agent el mock responde 403: reproduce el bloqueo del CDN a la IP del VPS (D-051).
      ...(opts.cdnBloqueado ? { userAgent: '' } : {}),
    }),
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
  fuente.agregar(makeOrder());
  await procesarCrear({ order_id: ID, intento: 0 }, deps);
  programar.sacar('etiqueta');
  mock.attachLabel(PID, '240000000001');
  mock.setStatus(PID, 3);
  mock.orders.get(PID)!.shippingRate = flete;
  const sync = (event_id: string) => procesarSync({ event_id, provider_order_id: PID, external_order_id: null, origen: 'webhook' }, deps);
  const manuales = () => fuente.eventos.filter((e) => e.type === 'transportadora' && e.payload.accion === 'impresion_manual_requerida');
  const alertas = () => fuente.eventos.filter((e) => e.type === 'alerta' && e.payload.motivo === 'impresion_manual_requerida');
  return { mock, fuente, programar, deps, sync, manuales, alertas };
}

describe('D-062: impresión automática según el flete', () => {
  it('flete sobre el umbral: descarga la guía, no crea print_job y deja evento y alerta una sola vez', async () => {
    const { fuente, deps, sync, manuales, alertas } = await preparar(30_000, 25_000n);
    expect((await procesarEtiqueta({ order_id: ID, intento: 0 }, deps)).accion).toBe('impresion_manual');
    expect((await fuente.envio(ID))!.label_local_path).toBe('labels/IZ-CO-000123.pdf');
    expect(fuente.impresiones).toEqual([]);
    expect(manuales()).toHaveLength(1);
    expect(manuales()[0]!.payload).toMatchObject({
      accion: 'impresion_manual_requerida',
      guia: '240000000001',
      flete: '30000',
      umbral: '25000',
      motivo: 'flete_sobre_umbral',
    });
    expect(alertas()).toHaveLength(1);
    expect(alertas()[0]!.payload).toMatchObject({ flete: '30000', umbral: '25000', causa: 'flete_sobre_umbral' });
    expect(fuente.eventos.find((e) => e.payload.accion === 'etiqueta_guardada')?.payload).toMatchObject({ impresion_creada: false, impresion_manual: true });

    // Idempotente: repetir poll_label y la sincronización no crea trabajo ni repite eventos.
    const propios = () => fuente.eventos.filter((e) => e.type === 'transportadora' || e.type === 'alerta').length;
    const n = propios();
    expect((await procesarEtiqueta({ order_id: ID, intento: 1 }, deps)).accion).toBe('impresion_manual');
    await sync('e-1');
    await sync('e-2');
    expect(fuente.impresiones).toEqual([]);
    expect(manuales()).toHaveLength(1);
    expect(alertas()).toHaveLength(1);
    expect(fuente.eventos.filter((e) => e.payload.accion === 'impresion_manual_requerida' || e.payload.motivo === 'impresion_manual_requerida')).toHaveLength(2);
    // La sincronización puede mover el estado (status_changed); de transportadora y alertas no aparece nada nuevo.
    expect(propios()).toBe(n);
  });

  it('no imprime solo de forma retroactiva si después baja el flete o sube el umbral', async () => {
    const { mock, fuente, deps, sync, manuales } = await preparar(30_000, 25_000n);
    await procesarEtiqueta({ order_id: ID, intento: 0 }, deps);
    mock.orders.get(PID)!.shippingRate = 10_000;
    fuente.umbral = 100_000n;
    await sync('e-baja');
    expect((await procesarEtiqueta({ order_id: ID, intento: 1 }, deps)).accion).toBe('impresion_manual');
    fuente.umbral = null;
    expect((await procesarEtiqueta({ order_id: ID, intento: 2 }, deps)).accion).toBe('impresion_manual');
    expect(fuente.impresiones).toEqual([]);
    expect(manuales()).toHaveLength(1);
  });

  it('flete igual al umbral: imprime solo (el umbral se puede alcanzar)', async () => {
    const { fuente, deps, manuales, alertas } = await preparar(25_000, 25_000n);
    expect((await procesarEtiqueta({ order_id: ID, intento: 0 }, deps)).accion).toBe('guardada');
    expect(fuente.impresiones).toHaveLength(1);
    expect(manuales()).toEqual([]);
    expect(alertas()).toEqual([]);
  });

  it('flete bajo el umbral: imprime solo y no se retiene aunque luego suba el flete', async () => {
    const { mock, fuente, deps, sync, manuales } = await preparar(12_000, 25_000n);
    expect((await procesarEtiqueta({ order_id: ID, intento: 0 }, deps)).accion).toBe('guardada');
    expect(fuente.impresiones).toHaveLength(1);
    mock.orders.get(PID)!.shippingRate = 90_000;
    await sync('e-sube');
    expect((await procesarEtiqueta({ order_id: ID, intento: 1 }, deps)).accion).toBe('ya_guardada');
    expect(fuente.impresiones).toHaveLength(1);
    expect(manuales()).toEqual([]);
  });

  it('umbral null (sin límite, p. ej. EC): imprime solo con cualquier flete', async () => {
    const { fuente, deps, manuales } = await preparar(900_000, null);
    expect((await procesarEtiqueta({ order_id: ID, intento: 0 }, deps)).accion).toBe('guardada');
    expect(fuente.impresiones).toHaveLength(1);
    expect(manuales()).toEqual([]);
  });

  it('flete desconocido (null): imprime solo como antes', async () => {
    const { fuente, deps, manuales } = await preparar(null, 25_000n);
    expect((await procesarEtiqueta({ order_id: ID, intento: 0 }, deps)).accion).toBe('guardada');
    expect(fuente.impresiones).toHaveLength(1);
    expect(manuales()).toEqual([]);
  });

  it('la guía llega por la sincronización (webhook) con flete sobre el umbral: retiene una sola vez', async () => {
    const { fuente, sync, manuales, alertas } = await preparar(30_000, 25_000n);
    await sync('e-a');
    await sync('e-b');
    expect((await fuente.envio(ID))!.label_local_path).toBe('labels/IZ-CO-000123.pdf');
    expect(fuente.impresiones).toEqual([]);
    expect(manuales()).toHaveLength(1);
    expect(alertas()).toHaveLength(1);
    expect(manuales()[0]!.actor).toBe('webhook:mastershop');
  });

  it('D-051 + D-062: con el CDN bloqueado y flete alto no crea trabajo para el agente ni repite eventos', async () => {
    const { fuente, deps, sync, manuales, alertas } = await preparar(30_000, 25_000n, { cdnBloqueado: true });
    expect((await procesarEtiqueta({ order_id: ID, intento: 0 }, deps)).accion).toBe('impresion_manual');
    await sync('e-403');
    expect(fuente.impresiones).toEqual([]);
    expect(fuente.eventos.some((e) => e.payload.accion === 'etiqueta_por_agente')).toBe(false);
    expect(manuales()).toHaveLength(1);
    expect(alertas()).toHaveLength(1);
  });

  it('carrera: si otro proceso ya registró la retención no se duplica la alerta', async () => {
    const { fuente, deps, manuales, alertas } = await preparar(30_000, 25_000n);
    // Simula que entre la lectura del estado y el insert otro proceso registró la retención.
    const original = fuente.estadoImpresionAuto.bind(fuente);
    fuente.estadoImpresionAuto = async (o, s) => {
      const r = await original(o, s);
      if (r === 'ninguna') await fuente.retenerImpresion(o, 'system', { motivo: 'flete_sobre_umbral' });
      return r;
    };
    expect((await procesarEtiqueta({ order_id: ID, intento: 0 }, deps)).accion).toBe('impresion_manual');
    expect(fuente.impresiones).toEqual([]);
    expect(manuales()).toHaveLength(1);
    expect(alertas()).toEqual([]);
  });
});
