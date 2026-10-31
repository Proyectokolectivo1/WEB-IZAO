import { describe, expect, it, vi } from 'vitest';
import { diasRetencionChat, fuenteChatPostgrest, purgarConversacionesChat, LOTE_CHAT, type FuenteChat } from './purgar-conversaciones.js';

const AHORA = new Date('2026-10-30T12:00:00Z');

function fuente(msgs: string[][], ses: string[][]) {
  const m = [...msgs];
  const s = [...ses];
  return {
    mensajesViejos: vi.fn().mockImplementation(async () => m.shift() ?? []),
    sesionesViejas: vi.fn().mockImplementation(async () => s.shift() ?? []),
    borrarMensajes: vi.fn().mockResolvedValue(undefined),
    borrarSesiones: vi.fn().mockResolvedValue(undefined),
  } satisfies FuenteChat;
}

describe('purgarConversacionesChat', () => {
  it('usa corte de 180 días y borra mensajes y sesiones', async () => {
    const f = fuente([['m1', 'm2']], [['s1']]);
    const r = await purgarConversacionesChat(f, { ahora: () => AHORA });
    expect(f.mensajesViejos).toHaveBeenCalledWith('2026-05-03T12:00:00.000Z', LOTE_CHAT);
    expect(r).toEqual({ mensajes: 2, sesiones: 1 });
  });

  it('procesa por lotes hasta vaciar', async () => {
    const lleno = Array.from({ length: LOTE_CHAT }, (_, i) => `m${i}`);
    const f = fuente([lleno, ['x']], []);
    const r = await purgarConversacionesChat(f, { ahora: () => AHORA });
    expect(f.borrarMensajes).toHaveBeenCalledTimes(2);
    expect(r.mensajes).toBe(LOTE_CHAT + 1);
  });

  it('es idempotente: sin viejos no borra nada', async () => {
    const f = fuente([], []);
    expect(await purgarConversacionesChat(f, { ahora: () => AHORA })).toEqual({ mensajes: 0, sesiones: 0 });
    expect(f.borrarMensajes).not.toHaveBeenCalled();
  });

  it('retención por entorno con mínimo de 30 días', () => {
    expect(diasRetencionChat(undefined)).toBe(180);
    expect(diasRetencionChat('90')).toBe(90);
    expect(diasRetencionChat('5')).toBe(180);
  });
});

describe('fuenteChatPostgrest', () => {
  it('solo toca chat_messages y chat_sessions (nunca chat_usage_monthly)', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => new Response('[{"id":"a"}]', { status: 200 }));
    const f = fuenteChatPostgrest({ supabaseUrl: 'https://x.co', secretKey: 'k', fetchImpl });
    await f.mensajesViejos('2026-01-01T00:00:00.000Z', 5);
    await f.sesionesViejas('2026-01-01T00:00:00.000Z', 5);
    await f.borrarMensajes(['a', 'b']);
    await f.borrarSesiones(['c']);
    const urls = fetchImpl.mock.calls.map((c) => String(c[0]));
    expect(urls.every((u) => /chat_(messages|sessions)\?/.test(u))).toBe(true);
    expect(urls.some((u) => u.includes('usage'))).toBe(false);
    expect(decodeURIComponent(urls[1] ?? '')).toContain('last_message_at.is.null');
    expect(urls[2]).toContain('id=in.(a,b)');
  });

  it('el DELETE de un lote completo cabe en una URL de menos de 8 KB', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => new Response('[]', { status: 200 }));
    const f = fuenteChatPostgrest({ supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co', secretKey: 'k', fetchImpl });
    const ids = Array.from({ length: LOTE_CHAT }, () => crypto.randomUUID());
    await f.borrarMensajes(ids);
    expect(String(fetchImpl.mock.calls[0]?.[0]).length).toBeLessThan(8_000);
  });
});
