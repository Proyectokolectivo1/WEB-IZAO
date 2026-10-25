import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../auth/supabase/servicio', () => ({
  crearClienteServicio: () => {
    throw new Error('las pruebas inyectan el cliente');
  },
}));

import { ErrorDb, fijarClienteDbParaPruebas } from './cliente';
import { anonimizarClienteDb, cancelarPedidoDb, ESTADOS_CANCELABLES, publicarPaginaDb } from './panel-atomicas';

const ID = 'c0000000-0000-0000-0000-000000003101';
const EV = 'c0000000-0000-0000-0000-000000003102';

function clienteFalso(data: unknown, error: { message: string; code?: string } | null = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  fijarClienteDbParaPruebas({ rpc } as never);
  return rpc;
}

afterEach(() => fijarClienteDbParaPruebas(null));

describe('anonimizarClienteDb', () => {
  it('anonimizado: llama el RPC y devuelve los conteos', async () => {
    const rpc = clienteFalso({
      ok: true, estado: 'anonimizado', id: ID, pedidos: 2, mensajes_whatsapp: 1, garantias: 1, leads: 2, direcciones: 1,
      deseos: 1, conversaciones: 2, cuenta_acceso_eliminada: true,
    });
    expect(await anonimizarClienteDb(ID)).toMatchObject({ ok: true, pedidos: 2, cuenta_acceso_eliminada: true });
    expect(rpc).toHaveBeenCalledWith('anonimizar_cliente', { p_id: ID });
  });

  it('bloqueado y motivos simples pasan tal cual; id inválido no llama la base', async () => {
    clienteFalso({ ok: false, motivo: 'bloqueado', cuenta_del_panel: false, pedidos_en_curso: 1, garantias_abiertas: 0 });
    expect(await anonimizarClienteDb(ID)).toMatchObject({ motivo: 'bloqueado', pedidos_en_curso: 1 });
    clienteFalso({ ok: false, motivo: 'ya_anonimizado' });
    expect(await anonimizarClienteDb(ID)).toEqual({ ok: false, motivo: 'ya_anonimizado' });
    const rpc = clienteFalso(null);
    expect(await anonimizarClienteDb('x')).toEqual({ ok: false, motivo: 'datos_invalidos' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('forma inesperada: ErrorDb', async () => {
    clienteFalso({ ok: true, estado: 'anonimizado', id: ID });
    await expect(anonimizarClienteDb(ID)).rejects.toBeInstanceOf(ErrorDb);
  });
});

describe('cancelarPedidoDb', () => {
  it('los estados cancelables salen de order-state y coinciden con la RPC', () => {
    expect([...ESTADOS_CANCELABLES].sort()).toEqual(['en_preparacion', 'enviado_transportadora', 'pendiente_manual', 'requiere_reembolso']);
  });

  it('cancela: envía {p} con la fecha en ISO y valida la respuesta', async () => {
    const rpc = clienteFalso({
      ok: true, order_id: ID, from_status: 'pendiente_manual', to_status: 'cancelado', event_id: EV, stock_estado: 'released', stock_liberado: true,
    });
    const r = await cancelarPedidoDb({
      order_id: ID, from_status: 'pendiente_manual', actor: 'admin:u1', motivo: 'Desistió', cancelled_at: new Date('2026-10-25T10:00:00Z'),
    });
    expect(r).toMatchObject({ ok: true, stock_liberado: true });
    expect(rpc).toHaveBeenCalledWith('cancelar_pedido', {
      p: { order_id: ID, from_status: 'pendiente_manual', actor: 'admin:u1', motivo: 'Desistió', cancelled_at: '2026-10-25T10:00:00.000Z' },
    });
  });

  it('rechazos pasan tal cual; actor inválido lanza antes de llamar', async () => {
    clienteFalso({ ok: false, motivo: 'estado_cambiado', status_actual: 'en_transito' });
    expect(await cancelarPedidoDb({ order_id: ID, from_status: 'en_preparacion', actor: 'system' })).toMatchObject({ motivo: 'estado_cambiado' });
    const rpc = clienteFalso(null);
    await expect(cancelarPedidoDb({ order_id: ID, from_status: 'en_preparacion', actor: 'cualquiera' })).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('publicarPaginaDb', () => {
  const entrada = { country_code: 'CO', kind: 'envios', slug: 'envios', title: 'Envíos', content_html: '<p>a</p>', status: 'published' } as const;

  it('publicada: devuelve la despublicada y el estado anterior', async () => {
    const rpc = clienteFalso({
      ok: true, estado: 'actualizada', id: ID, version: 3, status: 'published', publicada_ahora: true,
      despublicada: { id: EV, title: 'Vieja', country_code: 'CO' },
      antes: { country_code: 'CO', kind: 'envios', slug: 'envios', title: 'Envíos', status: 'draft', version: 2, seo_title: null, seo_description: null, content_length: 8 },
    });
    const r = await publicarPaginaDb({ ...entrada, id: ID });
    expect(r).toMatchObject({ ok: true, version: 3, despublicada: { title: 'Vieja' } });
    expect(rpc).toHaveBeenCalledWith('admin_publicar_pagina', { p: { ...entrada, id: ID } });
  });

  it('rechazos con motivo; entrada inválida lanza antes de llamar', async () => {
    clienteFalso({ ok: false, motivo: 'marcadores_pendientes' });
    expect(await publicarPaginaDb(entrada)).toEqual({ ok: false, motivo: 'marcadores_pendientes' });
    const rpc = clienteFalso(null);
    await expect(publicarPaginaDb({ ...entrada, kind: 'otro' as never })).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });
});
