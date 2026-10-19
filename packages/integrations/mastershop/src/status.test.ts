import { ORDER_STATUSES } from '@izao/core/order-state';
import { describe, expect, it } from 'vitest';
import {
  CARRIER_PHASE_STATUSES,
  MASTERSHOP_STATUSES,
  getMasterShopStatus,
  masterShopStatusFromName,
  noveltyBadge,
  planInternalTransition,
  resolveMasterShopStatus,
} from './status';

// Tabla de §14.6 con el grupo `statusParent` de la colección de Postman (observado el
// 2026-10-02: 1-2 Por preparar, 3-5 En preparación, 6 En tránsito, 8-11 Finalizadas).
// id, nombre del filtro, grupo, estado interno, confirmado, final.
const TABLE = [
  [1, 'Por Confirmar', 'Por preparar', 'enviado_transportadora', false, false],
  [2, 'Pendiente', 'Por preparar', 'enviado_transportadora', true, false],
  [3, 'Por Alistar', 'En preparación', 'en_preparacion', true, false],
  [4, 'Por Recolectar', 'En preparación', 'en_preparacion', true, false],
  [5, 'Recolectada', 'En preparación', 'en_transito', true, false],
  [6, 'En tránsito', 'En tránsito', 'en_transito', true, false],
  [8, 'Entregada', 'Finalizadas', 'entregado', true, true],
  [9, 'Cancelada', 'Finalizadas', 'cancelado', false, true],
  [10, 'Devuelta', 'Finalizadas', 'devuelto', true, true],
  [11, 'Reclamaciones', 'Finalizadas', 'reclamacion', true, true],
] as const;

describe('estados de MasterShop (§14.6)', () => {
  it.each(TABLE)('id %i → %s / %s / %s', (id, name, group, internal, confirmed, final) => {
    const s = getMasterShopStatus(id);
    expect(s).toMatchObject({ id, filterName: name, group, internal, confirmed, final });
  });

  it('la tabla tiene exactamente los ids 1–6 y 8–11', () => {
    expect(MASTERSHOP_STATUSES.map((s) => s.id)).toEqual([1, 2, 3, 4, 5, 6, 8, 9, 10, 11]);
  });

  it('el id 7 no existe, ni otros fuera de la tabla', () => {
    for (const id of [7, 0, 12, -1, 1.5, Number.NaN]) {
      expect(getMasterShopStatus(id)).toBeNull();
    }
  });

  it('los grupos son los del dashboard (§21.3)', () => {
    const groups = new Set(MASTERSHOP_STATUSES.map((s) => s.group));
    expect([...groups]).toEqual(['Por preparar', 'En preparación', 'En tránsito', 'Finalizadas']);
  });

  it.each(TABLE)(
    'el nombre del listado %s se reconoce sin importar mayúsculas ni tildes',
    (id, name) => {
      expect(masterShopStatusFromName(name)?.id).toBe(id);
      expect(masterShopStatusFromName(name.toUpperCase())?.id).toBe(id);
      expect(
        masterShopStatusFromName(` ${name.normalize('NFD').replace(/\p{M}/gu, '')} `)?.id,
      ).toBe(id);
    },
  );

  it('acepta el nombre del estado en la forma de la tabla de estados ("Por confirmar")', () => {
    expect(masterShopStatusFromName('Por confirmar')?.id).toBe(1);
    expect(masterShopStatusFromName('Por alistar')?.id).toBe(3);
  });

  it('un nombre desconocido da null', () => {
    expect(masterShopStatusFromName('Perdida')).toBeNull();
    expect(masterShopStatusFromName('')).toBeNull();
  });

  it('resolve prefiere el id y cae al nombre', () => {
    expect(resolveMasterShopStatus({ id: 8, name: 'Pendiente' })?.id).toBe(8);
    expect(resolveMasterShopStatus({ id: null, name: 'Entregada' })?.id).toBe(8);
    expect(resolveMasterShopStatus({ id: '6', name: null })?.id).toBe(6);
    expect(resolveMasterShopStatus({ id: 7, name: null })).toBeNull();
    expect(resolveMasterShopStatus({})).toBeNull();
  });
});

describe('noveltyBadge', () => {
  it('se muestra con hasNovelty o con alertas', () => {
    expect(noveltyBadge({ hasNovelty: false, alerts: [] })).toEqual({ show: false, alerts: [] });
    expect(noveltyBadge({ hasNovelty: true, alerts: [] }).show).toBe(true);
    const r = noveltyBadge({
      hasNovelty: false,
      alerts: [{ idAlert: 3, name: 'Dirección incompleta', type: 'novedad' }],
    });
    expect(r).toEqual({
      show: true,
      alerts: [{ idAlert: 3, name: 'Dirección incompleta', type: 'novedad' }],
    });
  });

  it('tolera alertas mal formadas o ausentes', () => {
    expect(noveltyBadge({ hasNovelty: undefined, alerts: undefined })).toEqual({
      show: false,
      alerts: [],
    });
    expect(noveltyBadge({ hasNovelty: null, alerts: [null, 'x', { name: 5 }] })).toEqual({
      show: true,
      alerts: [{ idAlert: null, name: null, type: null }],
    });
  });
});

describe('planInternalTransition', () => {
  it('sin cambio cuando el pedido ya está en el estado interno', () => {
    expect(planInternalTransition('enviado_transportadora', 2)).toEqual({ kind: 'sin_cambio' });
  });

  it('recorre los estados intermedios cuando el polling se los salta', () => {
    expect(planInternalTransition('enviado_transportadora', 8)).toEqual({
      kind: 'transicion',
      target: 'entregado',
      path: ['en_preparacion', 'en_transito', 'entregado'],
    });
  });

  it('un paso directo', () => {
    expect(planInternalTransition('en_preparacion', 5)).toEqual({
      kind: 'transicion',
      target: 'en_transito',
      path: ['en_transito'],
    });
  });

  it('un retroceso (notificación atrasada) no transiciona y da alerta "retroceso"', () => {
    expect(planInternalTransition('entregado', 6)).toEqual({
      kind: 'no_aplicable',
      target: 'en_transito',
      alerta: { codigo: 'retroceso', estado_actual: 'entregado', id_status: 6 },
    });
  });

  it('id desconocido da alerta tipada', () => {
    expect(planInternalTransition('enviado_transportadora', 7)).toEqual({
      kind: 'desconocido',
      alerta: {
        codigo: 'estado_desconocido',
        estado_actual: 'enviado_transportadora',
        id_status: 7,
      },
    });
  });

  it('desde pagado, abono_pagado y error_transportadora entra a la fase de transportadora', () => {
    expect(planInternalTransition('pagado', 1)).toEqual({
      kind: 'transicion',
      target: 'enviado_transportadora',
      path: ['enviado_transportadora'],
    });
    expect(planInternalTransition('error_transportadora', 2)).toMatchObject({
      path: ['enviado_transportadora'],
    });
    expect(planInternalTransition('abono_pagado', 8)).toMatchObject({
      path: ['enviado_transportadora', 'en_preparacion', 'en_transito', 'entregado'],
    });
  });

  it('cancelado en MasterShop con el pedido en preparación (3-4) → cancelado', () => {
    expect(planInternalTransition('en_preparacion', 9)).toEqual({
      kind: 'transicion',
      target: 'cancelado',
      path: ['cancelado'],
    });
  });

  // A1: una notificación de MasterShop nunca puede inventar un pago.
  it.each([
    ['pendiente_pago', 1, 'enviado_transportadora', 'fuera_de_fase'],
    ['abandonado', 1, 'enviado_transportadora', 'fuera_de_fase'],
    ['pendiente_manual', 8, 'entregado', 'fuera_de_fase'],
    ['expirado', 9, 'cancelado', 'fuera_de_fase'],
    ['en_transito', 9, 'cancelado', 'sin_camino'],
  ] as const)('%s + MasterShop %i → no_aplicable con alerta', (current, id, target, codigo) => {
    const plan = planInternalTransition(current, id);
    expect(plan).toEqual({
      kind: 'no_aplicable',
      target,
      alerta: { codigo, estado_actual: current, id_status: id },
    });
  });

  it('ningún camino pasa por estados de pago, sea cual sea el estado actual', () => {
    const payment = new Set(['pagado', 'abono_pagado', 'pendiente_pago', 'esperando_abono']);
    for (const current of ORDER_STATUSES) {
      for (const s of MASTERSHOP_STATUSES) {
        const plan = planInternalTransition(current, s.id);
        if (plan.kind === 'transicion') {
          expect(CARRIER_PHASE_STATUSES).toContain(current);
          for (const step of plan.path) expect(payment.has(step)).toBe(false);
        }
      }
    }
  });
});
