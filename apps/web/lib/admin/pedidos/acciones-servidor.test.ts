import { beforeEach, describe, expect, it, vi } from 'vitest';

const { auditar } = vi.hoisted(() => ({ auditar: vi.fn(async (_e: unknown) => true) }));
vi.mock('@/lib/admin/auditoria', () => ({ auditarCambio: auditar }));

import type { OrderStatusEvent } from '@izao/core/order-state';
import { clienteFalso } from '../crud/cliente-falso';
import {
  agregarNotaBd,
  cancelarPedidoBd,
  marcarPagadoBd,
  reimprimirEtiquetaBd,
  reintentarEnvioBd,
} from './acciones-servidor';

const ID = '11111111-1111-4111-8111-111111111111';
const AHORA = new Date('2026-10-21T15:00:00Z');
const comun = { actor: 'u1', ip: null, ahora: () => AHORA };

const pedido = (status: string, extra: Record<string, unknown> = {}) => ({ number: 'IZ-CO-000123', status, payment_method: 'cod', country_code: 'CO', ...extra });
const envio = (extra: Record<string, unknown> = {}) => ({ id: 's1', provider_order_id: 777, provider_status_id: 1, label_local_path: null, label_url: null, ...extra });

const okTransicion = () =>
  vi.fn(async (orderId: string, e: OrderStatusEvent) => ({
    ok: true as const,
    order_id: orderId,
    from_status: e.from_status,
    to_status: e.to_status,
    event_id: '22222222-2222-4222-8222-222222222222',
  }));

beforeEach(() => auditar.mockClear());

const okCancelar = (extra: Record<string, unknown> = {}) =>
  vi.fn(async (e: { order_id: string; from_status: string }) => ({
    ok: true as const,
    order_id: e.order_id,
    from_status: e.from_status as never,
    to_status: 'cancelado' as const,
    event_id: '22222222-2222-4222-8222-222222222222',
    stock_estado: 'released',
    stock_liberado: true,
    stock_devuelto: false,
    unidades_devueltas: 0,
    stock_retenido: null,
    ...extra,
  }));
const noCancelar = (motivo: 'transicion_invalida' | 'estado_cambiado' | 'pedido_inexistente' | 'datos_invalidos') =>
  vi.fn(async () => ({ ok: false as const, motivo }));

describe('cancelarPedidoBd · llave de MasterShop del país del pedido (D-052)', () => {
  it('un pedido de Ecuador se cancela con el país EC (no con la llave de Colombia)', async () => {
    const { cliente } = clienteFalso({
      'orders.select': { data: pedido('enviado_transportadora', { country_code: 'EC' }) },
      'shipments.select': { data: envio({ provider_status_id: 1 }) },
    });
    const cancelarEnMasterShop = vi.fn(async () => undefined);
    const r = await cancelarPedidoBd({ cliente, ...comun, orderId: ID, motivo: 'Dirección imposible', cancelar: okCancelar(), cancelarEnMasterShop });
    expect(r.ok).toBe(true);
    expect(cancelarEnMasterShop).toHaveBeenCalledWith(777, 'EC');
  });
});

describe('cancelarPedidoBd · sin país del pedido', () => {
  it('falla cerrado: no cae a la llave de Colombia ni cancela en MasterShop ni en la base', async () => {
    const { cliente } = clienteFalso({
      'orders.select': { data: pedido('enviado_transportadora', { country_code: null }) },
      'shipments.select': { data: envio({ provider_status_id: 1 }) },
    });
    const cancelarEnMasterShop = vi.fn(async () => undefined);
    const cancelar = okCancelar();
    const r = await cancelarPedidoBd({ cliente, ...comun, orderId: ID, motivo: 'Dirección imposible', cancelar, cancelarEnMasterShop });
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/país de este pedido/);
    expect(cancelarEnMasterShop).not.toHaveBeenCalled();
    expect(cancelar).not.toHaveBeenCalled();
  });
});

describe('cancelarPedidoBd (RPC atómica cancelar_pedido)', () => {
  it('cancela un pedido pendiente manual en una sola llamada (estado, evento y stock) y audita', async () => {
    const { cliente } = clienteFalso({ 'orders.select': { data: pedido('pendiente_manual') }, 'shipments.select': { data: null } });
    const cancelar = okCancelar();
    const cancelarEnMasterShop = vi.fn(async () => undefined);
    const r = await cancelarPedidoBd({ cliente, ...comun, orderId: ID, motivo: 'El cliente ya no lo quiere', cancelar, cancelarEnMasterShop });
    expect(r).toEqual({ ok: true, mensaje: 'Pedido cancelado.' });
    expect(cancelarEnMasterShop).not.toHaveBeenCalled();
    expect(cancelar).toHaveBeenCalledWith({
      order_id: ID,
      from_status: 'pendiente_manual',
      actor: 'admin:u1',
      motivo: 'El cliente ya no lo quiere',
      cancelled_at: AHORA.toISOString(),
    });
    expect(auditar.mock.calls[0]![0]).toMatchObject({
      accion: 'pedido.cancelado',
      entidadId: ID,
      actor: 'u1',
      diff: { stock_estado: 'released', stock_liberado: true, cancelado_en_mastershop: false },
    });
  });

  it('con envío en MasterShop 1–2 lo cancela allá primero y luego en la base', async () => {
    for (const estadoRemoto of [1, 2]) {
      const { cliente } = clienteFalso({
        'orders.select': { data: pedido('enviado_transportadora') },
        'shipments.select': { data: envio({ provider_status_id: estadoRemoto }) },
      });
      const orden: string[] = [];
      const cancelarEnMasterShop = vi.fn(async () => void orden.push('mastershop'));
      const cancelar = vi.fn(async (e: { order_id: string; from_status: string }) => {
        orden.push('base');
        return okCancelar()(e);
      });
      const r = await cancelarPedidoBd({ cliente, ...comun, orderId: ID, motivo: 'Dirección imposible', cancelar, cancelarEnMasterShop });
      expect(r.ok).toBe(true);
      expect(cancelarEnMasterShop).toHaveBeenCalledWith(777, 'CO');
      expect(orden).toEqual(['mastershop', 'base']);
    }
  });

  it('si MasterShop rechaza la cancelación no toca la base', async () => {
    const { cliente } = clienteFalso({ 'orders.select': { data: pedido('enviado_transportadora') }, 'shipments.select': { data: envio() } });
    const cancelar = okCancelar();
    const r = await cancelarPedidoBd({
      cliente,
      ...comun,
      orderId: ID,
      motivo: 'Error de digitación',
      cancelar,
      cancelarEnMasterShop: async () => {
        throw new Error('502');
      },
    });
    expect(r.ok).toBe(false);
    expect(cancelar).not.toHaveBeenCalled();
    expect(auditar).not.toHaveBeenCalled();
  });

  it('si MasterShop responde estado_no_editable (estado local atrasado en 1) explica que ya avanzó, da el id y no cambia nada', async () => {
    const { cliente } = clienteFalso({ 'orders.select': { data: pedido('enviado_transportadora') }, 'shipments.select': { data: envio({ provider_status_id: 1, provider_order_id: 3084317 }) } });
    const cancelar = okCancelar();
    const r = await cancelarPedidoBd({
      cliente,
      ...comun,
      orderId: ID,
      motivo: 'El cliente ya no lo quiere',
      cancelar,
      cancelarEnMasterShop: async () => {
        throw Object.assign(new Error('409'), { name: 'MasterShopError', kind: 'estado_no_editable' });
      },
    });
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/ya avanzó en MasterShop/);
    expect(r.mensaje).toContain('3084317');
    expect(r.mensaje).not.toMatch(/no aceptó/);
    expect(cancelar).not.toHaveBeenCalled();
    expect(auditar).not.toHaveBeenCalled();
  });

  it('un envío que ya avanzó en MasterShop (3 o más) se cancela allá, no desde el panel', async () => {
    const { cliente } = clienteFalso({ 'orders.select': { data: pedido('en_preparacion') }, 'shipments.select': { data: envio({ provider_status_id: 3 }) } });
    const cancelar = okCancelar();
    const cancelarEnMasterShop = vi.fn(async () => undefined);
    const r = await cancelarPedidoBd({ cliente, ...comun, orderId: ID, motivo: 'Cambio de opinión', cancelar, cancelarEnMasterShop });
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/MasterShop/);
    expect(cancelarEnMasterShop).not.toHaveBeenCalled();
    expect(cancelar).not.toHaveBeenCalled();
  });

  it('rechaza estados que la máquina de estados no permite y motivos vacíos sin llamar a la RPC', async () => {
    for (const estado of ['pagado', 'entregado', 'cancelado', 'en_transito', 'pendiente_pago']) {
      const { cliente } = clienteFalso({ 'orders.select': { data: pedido(estado) }, 'shipments.select': { data: null } });
      const cancelar = okCancelar();
      const r = await cancelarPedidoBd({ cliente, ...comun, orderId: ID, motivo: 'motivo válido', cancelar, cancelarEnMasterShop: async () => undefined });
      expect(r.ok, estado).toBe(false);
      expect(cancelar).not.toHaveBeenCalled();
    }
    const { cliente } = clienteFalso({ 'orders.select': { data: pedido('pendiente_manual') } });
    const cancelar = okCancelar();
    expect((await cancelarPedidoBd({ cliente, ...comun, orderId: ID, motivo: '  ', cancelar, cancelarEnMasterShop: async () => undefined })).ok).toBe(false);
    expect(cancelar).not.toHaveBeenCalled();
  });

  it('si otro proceso movió el pedido, la RPC lo rechaza y no se audita', async () => {
    const { cliente } = clienteFalso({ 'orders.select': { data: pedido('pendiente_manual') }, 'shipments.select': { data: null } });
    const r = await cancelarPedidoBd({ cliente, ...comun, orderId: ID, motivo: 'Cancelación solicitada', cancelar: noCancelar('estado_cambiado'), cancelarEnMasterShop: async () => undefined });
    expect(r).toMatchObject({ ok: false, mensaje: expect.stringMatching(/cambió de estado/) });
    expect(auditar).not.toHaveBeenCalled();
  });

  it('si MasterShop ya canceló y la base rechaza, lo aclara para que se sincronice', async () => {
    const { cliente } = clienteFalso({ 'orders.select': { data: pedido('enviado_transportadora') }, 'shipments.select': { data: envio() } });
    const r = await cancelarPedidoBd({ cliente, ...comun, orderId: ID, motivo: 'Cancelación solicitada', cancelar: noCancelar('estado_cambiado'), cancelarEnMasterShop: async () => undefined });
    expect(r).toMatchObject({ ok: false, mensaje: expect.stringMatching(/MasterShop sí se hizo/) });
  });

  it('si el stock ya estaba descontado, la cancelación lo dice en la auditoría', async () => {
    const { cliente } = clienteFalso({ 'orders.select': { data: pedido('requiere_reembolso') }, 'shipments.select': { data: null } });
    const cancelar = okCancelar({ stock_estado: 'confirmed', stock_liberado: false, stock_devuelto: false, stock_retenido: 'envio_recolectado' });
    expect((await cancelarPedidoBd({ cliente, ...comun, orderId: ID, motivo: 'Cancelación solicitada', cancelar, cancelarEnMasterShop: async () => undefined })).ok).toBe(true);
    expect(auditar.mock.calls[0]![0]).toMatchObject({ diff: { stock_estado: 'confirmed', stock_liberado: false, stock_retenido: 'envio_recolectado' } });
  });

  it('si la cancelación devolvió el stock pagado, la auditoría guarda las unidades', async () => {
    const { cliente } = clienteFalso({ 'orders.select': { data: pedido('pendiente_manual') }, 'shipments.select': { data: null } });
    const cancelar = okCancelar({ stock_devuelto: true, unidades_devueltas: 3 });
    await cancelarPedidoBd({ cliente, ...comun, orderId: ID, motivo: 'Cancelación solicitada', cancelar, cancelarEnMasterShop: async () => undefined });
    expect(auditar.mock.calls[0]![0]).toMatchObject({ diff: { stock_devuelto: true, unidades_devueltas: 3, stock_retenido: null } });
  });

  it('pedido inexistente', async () => {
    const { cliente } = clienteFalso({ 'orders.select': { data: null } });
    const r = await cancelarPedidoBd({ cliente, ...comun, orderId: ID, motivo: 'motivo válido', cancelar: okCancelar(), cancelarEnMasterShop: async () => undefined });
    expect(r.ok).toBe(false);
  });
});

describe('recálculo de métricas tras cambiar el pedido', () => {
  it('cancelar encola metrics.recompute_day del pedido; si Redis falla, el cambio sigue valiendo', async () => {
    const { cliente } = clienteFalso({ 'orders.select': { data: pedido('pendiente_manual') }, 'shipments.select': { data: null } });
    const recalcular = vi.fn(async () => undefined);
    expect((await cancelarPedidoBd({ cliente, ...comun, recalcular, orderId: ID, motivo: 'Cancelación solicitada', cancelar: okCancelar(), cancelarEnMasterShop: async () => undefined })).ok).toBe(true);
    expect(recalcular).toHaveBeenCalledWith(ID);

    const roto = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const r = await cancelarPedidoBd({ cliente, ...comun, recalcular: roto, orderId: ID, motivo: 'Cancelación solicitada', cancelar: okCancelar(), cancelarEnMasterShop: async () => undefined });
    expect(r.ok).toBe(true);
    expect(auditar).toHaveBeenCalled();
  });

  it('un rechazo de la RPC no encola nada', async () => {
    const { cliente } = clienteFalso({ 'orders.select': { data: pedido('pendiente_manual') }, 'shipments.select': { data: null } });
    const recalcular = vi.fn(async () => undefined);
    await cancelarPedidoBd({ cliente, ...comun, recalcular, orderId: ID, motivo: 'Cancelación solicitada', cancelar: noCancelar('estado_cambiado'), cancelarEnMasterShop: async () => undefined });
    expect(recalcular).not.toHaveBeenCalled();
  });

  it('marcar pagado encola el recálculo tras aplicar el pago', async () => {
    const { cliente } = clienteFalso({ 'orders.select': { data: pedido('pendiente_manual') } });
    const recalcular = vi.fn(async () => undefined);
    const r = await marcarPagadoBd({
      cliente,
      ...comun,
      recalcular,
      orderId: ID,
      referencia: 'Transferencia 123',
      confirmarStock: async () => true,
      encolarEnvio: async () => 'encolado',
      aplicar: okTransicion(),
    });
    expect(r.ok).toBe(true);
    expect(recalcular).toHaveBeenCalledWith(ID);
    const sinStock = vi.fn(async () => undefined);
    await marcarPagadoBd({ cliente, ...comun, recalcular: sinStock, orderId: ID, referencia: 'Transferencia 123', confirmarStock: async () => false, encolarEnvio: async () => 'encolado', aplicar: okTransicion() });
    expect(sinStock).not.toHaveBeenCalled();
  });
});

describe('marcarPagadoBd', () => {
  const deps = () => ({
    confirmarStock: vi.fn(async () => true),
    encolarEnvio: vi.fn(async () => 'encolado' as const),
    aplicar: okTransicion(),
  });

  it('solo marca pagado un pedido en pendiente_manual: confirma stock, transiciona, encola el envío y audita', async () => {
    const { cliente } = clienteFalso({ 'orders.select': { data: pedido('pendiente_manual', { payment_method: 'manual' }) } });
    const d = deps();
    const r = await marcarPagadoBd({ cliente, ...comun, orderId: ID, referencia: 'Transferencia Bancolombia 8841', ...d });
    expect(r.ok).toBe(true);
    expect(d.confirmarStock).toHaveBeenCalledWith(ID);
    expect(d.aplicar).toHaveBeenCalledWith(
      ID,
      expect.objectContaining({ from_status: 'pendiente_manual', to_status: 'pagado', actor: 'admin:u1', payload: { motivo: 'pago_manual', referencia: 'Transferencia Bancolombia 8841' } }),
      { paid_at: AHORA.toISOString() },
    );
    expect(d.encolarEnvio).toHaveBeenCalledWith(ID, 'pagado');
    expect(auditar.mock.calls[0]![0]).toMatchObject({ accion: 'pedido.marcado_pagado', entidadId: ID });
  });

  it('rechaza cualquier otro estado', async () => {
    for (const estado of ['pendiente_pago', 'esperando_abono', 'pagado', 'cancelado', 'expirado']) {
      const { cliente } = clienteFalso({ 'orders.select': { data: pedido(estado) } });
      const d = deps();
      const r = await marcarPagadoBd({ cliente, ...comun, orderId: ID, referencia: 'Recibo 55', ...d });
      expect(r.ok, estado).toBe(false);
      expect(d.aplicar).not.toHaveBeenCalled();
      expect(d.confirmarStock).not.toHaveBeenCalled();
    }
  });

  it('exige una referencia del pago', async () => {
    const { cliente } = clienteFalso({ 'orders.select': { data: pedido('pendiente_manual') } });
    const d = deps();
    expect((await marcarPagadoBd({ cliente, ...comun, orderId: ID, referencia: ' ', ...d })).ok).toBe(false);
    expect(d.aplicar).not.toHaveBeenCalled();
  });

  it('sin stock no marca pagado', async () => {
    const { cliente } = clienteFalso({ 'orders.select': { data: pedido('pendiente_manual') } });
    const d = { ...deps(), confirmarStock: vi.fn(async () => false) };
    const r = await marcarPagadoBd({ cliente, ...comun, orderId: ID, referencia: 'Recibo 55', ...d });
    expect(r.ok).toBe(false);
    expect(d.aplicar).not.toHaveBeenCalled();
  });

  it('si no se pudo encolar el envío queda pagado y avisa que use Reintentar', async () => {
    const { cliente } = clienteFalso({ 'orders.select': { data: pedido('pendiente_manual') } });
    const d = { ...deps(), encolarEnvio: vi.fn(async (): Promise<'encolado'> => {
      throw new Error('redis');
    }) };
    const r = await marcarPagadoBd({ cliente, ...comun, orderId: ID, referencia: 'Recibo 55', ...d });
    expect(r.ok).toBe(true);
    expect(r.mensaje).toMatch(/Reintentar/);
    expect(d.aplicar).toHaveBeenCalled();
  });
});

describe('agregarNotaBd', () => {
  it('guarda la nota como evento del pedido con actor admin y audita', async () => {
    const { cliente, llamadas } = clienteFalso({ 'orders.select': { data: { number: 'IZ-CO-000123' } }, 'order_events.insert': { data: null } });
    const r = await agregarNotaBd({ cliente, ...comun, orderId: ID, texto: '  Cliente pidió llamar antes de entregar  ' });
    expect(r.ok).toBe(true);
    expect(llamadas.find((l) => l.clave === 'order_events.insert')!.args[0]).toEqual({
      order_id: ID,
      type: 'nota_interna',
      payload: { texto: 'Cliente pidió llamar antes de entregar' },
      actor: 'admin:u1',
    });
    expect(auditar.mock.calls[0]![0]).toMatchObject({ accion: 'pedido.nota_agregada' });
  });

  it('rechaza notas vacías o demasiado largas', async () => {
    const { cliente, llamadas } = clienteFalso({ 'orders.select': { data: { number: 'IZ-CO-000123' } } });
    expect((await agregarNotaBd({ cliente, ...comun, orderId: ID, texto: '   ' })).ok).toBe(false);
    expect((await agregarNotaBd({ cliente, ...comun, orderId: ID, texto: 'x'.repeat(1001) })).ok).toBe(false);
    expect(llamadas.some((l) => l.clave === 'order_events.insert')).toBe(false);
  });
});

describe('reintentarEnvioBd', () => {
  it('traduce cada resultado de la cola y registra el evento solo si se encoló', async () => {
    const casos = [
      ['encolado', true, true],
      ['ya_pendiente', true, false],
      ['estado_invalido', false, false],
    ] as const;
    for (const [resultado, ok, registra] of casos) {
      const { cliente, llamadas } = clienteFalso({
        'orders.select': { data: pedido('error_transportadora') },
        'order_events.insert': { data: null },
      });
      const reintentar = vi.fn(async () => resultado);
      const r = await reintentarEnvioBd({ cliente, ...comun, orderId: ID, reintentar });
      expect(reintentar).toHaveBeenCalledWith(ID, 'error_transportadora');
      expect(r.ok, resultado).toBe(ok);
      expect(llamadas.some((l) => l.clave === 'order_events.insert'), resultado).toBe(registra);
      expect(r.mensaje.length).toBeGreaterThan(10);
    }
  });

  it('si Redis falla da un mensaje genérico', async () => {
    const { cliente } = clienteFalso({ 'orders.select': { data: pedido('pagado') } });
    const r = await reintentarEnvioBd({
      cliente,
      ...comun,
      orderId: ID,
      reintentar: async () => {
        throw new Error('ECONNREFUSED 10.0.0.1:6379');
      },
    });
    expect(r.ok).toBe(false);
    expect(r.mensaje).not.toContain('ECONNREFUSED');
  });
});

describe('reimprimirEtiquetaBd', () => {
  it('crea el trabajo con requested_by del administrador (nunca auto)', async () => {
    const { cliente, llamadas } = clienteFalso({
      'orders.select': { data: pedido('en_preparacion') },
      'shipments.select': { data: envio({ label_local_path: 'labels/IZ-CO-000123.pdf' }) },
      'print_jobs.select': { data: [] },
      'print_jobs.insert': { data: null },
    });
    const r = await reimprimirEtiquetaBd({ cliente, ...comun, orderId: ID });
    expect(r.ok).toBe(true);
    const fila = llamadas.find((l) => l.clave === 'print_jobs.insert')!.args[0] as Record<string, unknown>;
    expect(fila).toMatchObject({ order_id: ID, shipment_id: 's1', type: 'label', status: 'queued', requested_by: 'admin:u1' });
    expect(fila.requested_by).not.toBe('auto');
    expect(auditar.mock.calls[0]![0]).toMatchObject({ accion: 'pedido.etiqueta_reimpresa' });
  });

  it('sin copia local reimprime con la URL de MasterShop (D-051) y audita igual', async () => {
    const { cliente, llamadas } = clienteFalso({
      'orders.select': { data: pedido('en_preparacion') },
      'shipments.select': { data: envio({ label_local_path: null, label_url: 'https://cdn.bemaster.com/labels/75070783091.pdf' }) },
      'print_jobs.select': { data: [] },
      'print_jobs.insert': { data: null },
    });
    const r = await reimprimirEtiquetaBd({ cliente, ...comun, orderId: ID });
    expect(r.ok).toBe(true);
    expect(llamadas.find((l) => l.clave === 'print_jobs.insert')!.args[0]).toMatchObject({ type: 'label', requested_by: 'admin:u1' });
    expect(auditar.mock.calls[0]![0]).toMatchObject({ accion: 'pedido.etiqueta_reimpresa' });
  });

  it('una label_url fuera de la lista no permite reimprimir sin copia local', async () => {
    for (const url of ['https://evil.example.com/a.pdf', 'http://cdn.bemaster.com/a.pdf', '']) {
      const { cliente, llamadas } = clienteFalso({
        'orders.select': { data: pedido('en_preparacion') },
        'shipments.select': { data: envio({ label_local_path: null, label_url: url }) },
      });
      expect((await reimprimirEtiquetaBd({ cliente, ...comun, orderId: ID })).ok, url).toBe(false);
      expect(llamadas.some((l) => l.clave === 'print_jobs.insert')).toBe(false);
    }
  });

  it('sin etiqueta descargada o con otra impresión en cola no crea nada', async () => {
    const sinEtiqueta = clienteFalso({
      'orders.select': { data: pedido('en_preparacion') },
      'shipments.select': { data: envio({ label_local_path: null }) },
    });
    expect((await reimprimirEtiquetaBd({ cliente: sinEtiqueta.cliente, ...comun, orderId: ID })).ok).toBe(false);
    expect(sinEtiqueta.llamadas.some((l) => l.clave === 'print_jobs.insert')).toBe(false);

    const enCola = clienteFalso({
      'orders.select': { data: pedido('en_preparacion') },
      'shipments.select': { data: envio({ label_local_path: 'labels/x.pdf' }) },
      'print_jobs.select': { data: [{ id: 'j1' }] },
    });
    const r = await reimprimirEtiquetaBd({ cliente: enCola.cliente, ...comun, orderId: ID });
    expect(r.ok).toBe(false);
    expect(enCola.llamadas.some((l) => l.clave === 'print_jobs.insert')).toBe(false);
  });

  it('un pedido sin envío no se reimprime', async () => {
    const { cliente } = clienteFalso({ 'orders.select': { data: pedido('pagado') }, 'shipments.select': { data: null } });
    expect((await reimprimirEtiquetaBd({ cliente, ...comun, orderId: ID })).ok).toBe(false);
  });
});
