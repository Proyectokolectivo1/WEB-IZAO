import { describe, expect, it, vi } from 'vitest';
import { fuenteDeVenta } from '@/lib/admin/metricas/dashboard';
import { COOKIE_CLICK_IDS, COOKIE_REF, COOKIE_UTM, serializarClickIds, serializarUtm } from './captura';
import { atribucionDelPedido } from './pedido';

const cookie = (partes: { ref?: string; utm?: Record<string, string>; clk?: Record<string, string> }) =>
  [
    partes.ref ? `${COOKIE_REF}=${partes.ref}` : '',
    partes.utm ? `${COOKIE_UTM}=${encodeURIComponent(serializarUtm(partes.utm))}` : '',
    partes.clk ? `${COOKIE_CLICK_IDS}=${encodeURIComponent(serializarClickIds(partes.clk))}` : '',
  ]
    .filter(Boolean)
    .join('; ');

describe('atribucionDelPedido', () => {
  it('prefiere el influencer del código aplicado y no consulta la cookie', async () => {
    const buscar = vi.fn(async () => 'inf-cookie');
    const r = await atribucionDelPedido({ cookie: cookie({ ref: 'ANA10' }), influencerDelCodigoAplicado: 'inf-codigo', influencerDeCodigo: buscar });
    expect(r.influencer_id).toBe('inf-codigo');
    expect(buscar).not.toHaveBeenCalled();
  });

  it('sin código aplicado usa el ref de la cookie', async () => {
    const buscar = vi.fn(async (c: string) => (c === 'ANA10' ? 'inf-ana' : null));
    expect((await atribucionDelPedido({ cookie: cookie({ ref: 'ANA10' }), influencerDeCodigo: buscar })).influencer_id).toBe('inf-ana');
    expect(buscar).toHaveBeenCalledWith('ANA10');
  });

  it('un ref desconocido o un fallo de la base no frenan el pedido', async () => {
    expect((await atribucionDelPedido({ cookie: cookie({ ref: 'NOEXISTE' }), influencerDeCodigo: async () => null })).influencer_id).toBeNull();
    const falla = async () => {
      throw new Error('base caída');
    };
    expect((await atribucionDelPedido({ cookie: cookie({ ref: 'ANA10' }), influencerDeCodigo: falla })).influencer_id).toBeNull();
  });

  it('sin cookies devuelve objetos vacíos y no consulta', async () => {
    const buscar = vi.fn();
    const r = await atribucionDelPedido({ cookie: null, influencerDeCodigo: buscar });
    expect(r).toEqual({ influencer_id: null, utm: {}, click_ids: {} });
    expect(buscar).not.toHaveBeenCalled();
  });

  it('utm y click_ids producen la fuente que lee el dashboard (orders.sale_source)', async () => {
    const dep = { influencerDeCodigo: async () => null };
    const conUtm = await atribucionDelPedido({ ...dep, cookie: cookie({ utm: { utm_source: 'Instagram', utm_medium: 'story' } }) });
    expect(fuenteDeVenta(conUtm.utm, conUtm.click_ids)).toBe('instagram / story');
    const soloClic = await atribucionDelPedido({ ...dep, cookie: cookie({ clk: { fbclid: 'IwAR1' } }) });
    expect(fuenteDeVenta(soloClic.utm, soloClic.click_ids)).toBe('meta (clic de anuncio)');
    const google = await atribucionDelPedido({ ...dep, cookie: cookie({ clk: { gclid: 'G' } }) });
    expect(fuenteDeVenta(google.utm, google.click_ids)).toBe('google (clic de anuncio)');
    const tiktok = await atribucionDelPedido({ ...dep, cookie: cookie({ clk: { ttclid: 'T' } }) });
    expect(fuenteDeVenta(tiktok.utm, tiktok.click_ids)).toBe('tiktok (clic de anuncio)');
    const directo = await atribucionDelPedido({ ...dep, cookie: null });
    expect(fuenteDeVenta(directo.utm, directo.click_ids)).toBe('Directo o sin fuente');
  });
});
