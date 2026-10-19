import { describe, expect, it } from 'vitest';
import {
  MASTERSHOP_STATUSES,
  getMasterShopStatus,
  masterShopStatusFromName,
  noveltyBadge,
  planInternalTransition,
  resolveMasterShopStatus,
} from './status';

// Tabla completa de §14.6: id, nombre del filtro, grupo, estado interno, confirmado, final.
const TABLE = [
  [1, 'Por Confirmar', 'Por preparar', 'enviado_transportadora', false, false],
  [2, 'Pendiente', 'Por preparar', 'enviado_transportadora', true, false],
  [3, 'Por Alistar', 'En preparación', 'en_preparacion', true, false],
  [4, 'Por Recolectar', 'En preparación', 'en_preparacion', true, false],
  [5, 'Recolectada', 'En tránsito', 'en_transito', true, false],
  [6, 'En tránsito', 'En tránsito', 'en_transito', true, false],
  [8, 'Entregada', 'Finalizadas', 'entregado', true, true],
  [9, 'Cancelada', 'Finalizadas', 'cancelado', false, true],
  [10, 'Devuelta', 'Finalizadas', 'devuelto', true, true],
  [11, 'Reclamaciones', null, 'reclamacion', true, true],
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
    expect([...groups]).toEqual([
      'Por preparar',
      'En preparación',
      'En tránsito',
      'Finalizadas',
      null,
    ]);
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

  it('ignora un estado que haría retroceder el pedido', () => {
    expect(planInternalTransition('entregado', 6)).toEqual({
      kind: 'no_aplicable',
      target: 'en_transito',
    });
  });

  it('id desconocido', () => {
    expect(planInternalTransition('enviado_transportadora', 7)).toEqual({ kind: 'desconocido' });
  });
});
