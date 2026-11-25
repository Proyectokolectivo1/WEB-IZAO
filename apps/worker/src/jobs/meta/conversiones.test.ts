import { describe, expect, it, vi } from 'vitest';
import type { CountryCode } from '@izao/core/money';
import { ErrorCapi, type OpcionesEnvio } from '@izao/meta-pixel/capi';
import {
  enviarCompraCapi,
  jobIdCapiCompra,
  parseDatosCapi,
  type CredencialMeta,
  type DepsConversiones,
  type FuenteConversiones,
  type PedidoConversion,
} from './conversiones.js';
import { combinarTrasTransicion, encolarCapiSiPagado } from './tras-transicion.js';

const ID = '11111111-1111-4111-8111-111111111111';
const TOKEN_CO = 'EAAtokenColombiaSecreto999';
const TOKEN_EC = 'EAAtokenEcuadorSecreto888';
const CREDENCIALES: Record<CountryCode, CredencialMeta> = {
  CO: { pixelId: '111111111111111', token: TOKEN_CO },
  EC: { pixelId: '222222222222222', token: TOKEN_EC },
};

function pedido(sobre: Partial<PedidoConversion> = {}): PedidoConversion {
  return {
    id: ID,
    numero: 'IZ-CO-000123',
    pais: 'CO',
    pagadoEn: new Date('2026-11-24T15:00:00Z'),
    total: 99000n,
    correo: 'Ana@Correo.com',
    telefono: '+573001234567',
    lineas: [{ id: 'SKU-1', cantidad: 1, precioUnitario: 90000n }],
    consentimientoMarketing: true,
    ...sobre,
  };
}

function montar(p: PedidoConversion | null, opciones: { enviado?: boolean; sinCredencial?: boolean } = {}) {
  const eventos: { tipo: string; payload: Record<string, unknown> }[] = [];
  const fuente: FuenteConversiones = {
    pedido: async () => p,
    yaEnviado: async () => opciones.enviado === true,
    credencial: async (pais) => (opciones.sinCredencial ? null : CREDENCIALES[pais]),
    registrarEvento: async (_id, tipo, _actor, payload) => {
      eventos.push({ tipo, payload });
    },
  };
  const enviar = vi.fn(async (_o: OpcionesEnvio) => ({ eventosRecibidos: 1, fbtraceId: 'T' }));
  const deps: DepsConversiones = { fuente, urlSitio: 'https://izaoperfumeria.com/', enviar };
  return { deps, enviar, eventos };
}

describe('meta.capi_purchase', () => {
  it('pedido pagado con consentimiento de marketing: envía el Purchase', async () => {
    const m = montar(pedido());
    expect((await enviarCompraCapi(ID, m.deps)).accion).toBe('enviado');
    expect(m.enviar).toHaveBeenCalledTimes(1);
  });

  it('sin consentimiento de marketing (o pedido antiguo): no llama a Meta ni lee la credencial, sin reintento ni evento', async () => {
    const m = montar(pedido({ consentimientoMarketing: false }));
    const credencial = vi.spyOn(m.deps.fuente, 'credencial');
    const yaEnviado = vi.spyOn(m.deps.fuente, 'yaEnviado');
    await expect(enviarCompraCapi(ID, m.deps)).resolves.toEqual({ ok: true, accion: 'sin_consentimiento', order_id: ID });
    expect(m.enviar).not.toHaveBeenCalled();
    expect(credencial).not.toHaveBeenCalled();
    expect(yaEnviado).not.toHaveBeenCalled();
    expect(m.eventos).toEqual([]);
  });

  it('no envía nada si el pedido no está pagado', async () => {
    const m = montar(pedido({ pagadoEn: null }));
    expect((await enviarCompraCapi(ID, m.deps)).accion).toBe('no_pagado');
    expect(m.enviar).not.toHaveBeenCalled();
  });

  it('envía con el Pixel y el token del país del pedido (CO)', async () => {
    const m = montar(pedido());
    expect((await enviarCompraCapi(ID, m.deps)).accion).toBe('enviado');
    const o = m.enviar.mock.calls[0]![0];
    expect(o.pixelId).toBe(CREDENCIALES.CO.pixelId);
    expect(o.token).toBe(TOKEN_CO);
    const e = o.eventos[0]!;
    expect(e.event_id).toBe('purchase_IZ-CO-000123');
    expect(e.custom_data.value).toBe(99000);
    expect(e.custom_data.currency).toBe('COP');
    expect(e.custom_data.content_ids).toEqual(['SKU-1']);
    expect(e.event_source_url).toBe('https://izaoperfumeria.com/co');
  });

  it('Ecuador usa su propio Pixel, token, moneda y valor decimal', async () => {
    const m = montar(pedido({ pais: 'EC', numero: 'IZ-EC-000007', total: 9982n, lineas: [{ id: 'SKU-9', cantidad: 2, precioUnitario: 4991n }], telefono: '+593991234567' }));
    await enviarCompraCapi(ID, m.deps);
    const o = m.enviar.mock.calls[0]![0];
    expect(o.pixelId).toBe(CREDENCIALES.EC.pixelId);
    expect(o.token).toBe(TOKEN_EC);
    expect(o.eventos[0]!.custom_data.value).toBe(99.82);
    expect(o.eventos[0]!.custom_data.currency).toBe('USD');
  });

  it('user_data va con hash: sin correo ni teléfono en claro', async () => {
    const m = montar(pedido());
    await enviarCompraCapi(ID, m.deps);
    const texto = JSON.stringify(m.enviar.mock.calls[0]![0].eventos);
    expect(texto).not.toContain('Ana@Correo');
    expect(texto).not.toContain('ana@correo');
    expect(texto).not.toContain('3001234567');
  });

  it('Purchase único: si ya se envió no vuelve a enviar', async () => {
    const m = montar(pedido(), { enviado: true });
    expect((await enviarCompraCapi(ID, m.deps)).accion).toBe('ya_enviado');
    expect(m.enviar).not.toHaveBeenCalled();
  });

  it('registra lo enviado en order_events sin token', async () => {
    const m = montar(pedido());
    await enviarCompraCapi(ID, m.deps);
    expect(m.eventos).toHaveLength(1);
    expect(m.eventos[0]!.tipo).toBe('meta_capi_purchase');
    expect(m.eventos[0]!.payload).toMatchObject({ event_id: 'purchase_IZ-CO-000123', events_received: 1 });
    expect(JSON.stringify(m.eventos)).not.toContain(TOKEN_CO);
  });

  it('sin credencial activa no envía ni falla', async () => {
    const m = montar(pedido(), { sinCredencial: true });
    expect((await enviarCompraCapi(ID, m.deps)).accion).toBe('sin_credencial');
    expect(m.enviar).not.toHaveBeenCalled();
    expect(m.eventos).toHaveLength(0);
  });

  it('un fallo temporal de Meta lanza para que BullMQ reintente (no marca como enviado)', async () => {
    const m = montar(pedido());
    m.enviar.mockRejectedValueOnce(new ErrorCapi('Meta respondió HTTP 503', { estado: 503, codigo: null, reintentable: true, fbtraceId: null }));
    await expect(enviarCompraCapi(ID, m.deps)).rejects.toBeInstanceOf(ErrorCapi);
    expect(m.eventos).toHaveLength(0);
  });

  it('un rechazo definitivo se anota y no se reintenta', async () => {
    const m = montar(pedido());
    m.enviar.mockRejectedValueOnce(new ErrorCapi('Meta respondió HTTP 400 (código 190): token inválido', { estado: 400, codigo: 190, reintentable: false, fbtraceId: 'F' }));
    expect((await enviarCompraCapi(ID, m.deps)).accion).toBe('rechazado');
    expect(m.eventos[0]!.tipo).toBe('meta_capi_error');
    expect(JSON.stringify(m.eventos)).not.toContain(TOKEN_CO);
  });

  it('valida el id del pedido del job', () => {
    expect(parseDatosCapi({ order_id: ID })).toEqual({ order_id: ID });
    expect(parseDatosCapi({ order_id: "1'; drop" })).toBeNull();
    expect(parseDatosCapi(null)).toBeNull();
  });
});

describe('enganche tras la transición', () => {
  it('encola con jobId fijo solo si el pedido ya está pagado', async () => {
    const add = vi.fn(async () => undefined);
    const enganche = encolarCapiSiPagado({ add } as never, async (id) => id === ID);
    await enganche('22222222-2222-4222-8222-222222222222');
    expect(add).not.toHaveBeenCalled();
    await enganche(ID);
    expect(add).toHaveBeenCalledWith('meta.capi_purchase', { order_id: ID }, { jobId: jobIdCapiCompra(ID) });
  });

  it('un enganche que falla no impide a los demás', async () => {
    const segundo = vi.fn(async () => undefined);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await combinarTrasTransicion(async () => { throw new Error('redis caído'); }, segundo)(ID);
    expect(segundo).toHaveBeenCalledWith(ID);
    log.mockRestore();
  });
});
