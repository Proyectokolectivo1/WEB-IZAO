import { describe, expect, it } from 'vitest';
import { fetchFalso } from '../fetch-falso.js';
import { crearFuenteCarrierPostgrest } from './fuente-postgrest.js';

const OPC = { supabaseUrl: 'https://x.supabase.co', secretKey: 'llave-servidor-ficticia', claveCifrado: 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=' };

describe('fuente PostgREST de carrier: impresión automática de etiqueta', () => {
  it('crea el print_job con requested_by auto si no hay uno automático', async () => {
    const { f, llamadas } = fetchFalso((l) => (l.metodo === 'GET' ? { status: 200, cuerpo: [] } : { status: 201 }));
    const fuente = crearFuenteCarrierPostgrest({ ...OPC, fetchImpl: f });
    expect(await fuente.crearImpresionEtiqueta('o-1', 's-1')).toBe(true);
    expect(llamadas[0]!.url).toContain('print_jobs?shipment_id=eq.s-1&type=eq.label&requested_by=eq.auto&status=neq.cancelled');
    expect(llamadas[1]!.cuerpo).toEqual({ order_id: 'o-1', shipment_id: 's-1', type: 'label', requested_by: 'auto' });
  });

  it('409/23505 del índice único parcial (carrera poll_label / sync) → "ya existe", sin lanzar', async () => {
    const { f } = fetchFalso((l) =>
      l.metodo === 'GET' ? { status: 200, cuerpo: [] } : { status: 409, cuerpo: { code: '23505', message: 'duplicate key' } },
    );
    const fuente = crearFuenteCarrierPostgrest({ ...OPC, fetchImpl: f });
    expect(await fuente.crearImpresionEtiqueta('o-1', 's-1')).toBe(false);
  });

  it('otro error al insertar sí se propaga', async () => {
    const { f } = fetchFalso((l) => (l.metodo === 'GET' ? { status: 200, cuerpo: [] } : { status: 400, cuerpo: { code: '23502' } }));
    const fuente = crearFuenteCarrierPostgrest({ ...OPC, fetchImpl: f });
    await expect(fuente.crearImpresionEtiqueta('o-1', 's-1')).rejects.toThrow(/23502/);
  });

  it('si ya existe uno automático no inserta', async () => {
    const { f, llamadas } = fetchFalso(() => ({ status: 200, cuerpo: [{ id: 'pj-1' }] }));
    const fuente = crearFuenteCarrierPostgrest({ ...OPC, fetchImpl: f });
    expect(await fuente.crearImpresionEtiqueta('o-1', 's-1')).toBe(false);
    expect(llamadas).toHaveLength(1);
  });
});

describe('fuente PostgREST de carrier: umbral de impresión automática (D-062)', () => {
  it('lee el umbral del país como bigint; null = sin límite', async () => {
    const con = fetchFalso(() => ({ status: 200, cuerpo: [{ auto_print_max_shipping_rate: 25000 }] }));
    expect(await crearFuenteCarrierPostgrest({ ...OPC, fetchImpl: con.f }).umbralImpresionAuto('CO')).toBe(25_000n);
    expect(con.llamadas[0]!.url).toContain('country_settings?country_code=eq.CO&select=auto_print_max_shipping_rate');
    const sin = fetchFalso(() => ({ status: 200, cuerpo: [{ auto_print_max_shipping_rate: null }] }));
    expect(await crearFuenteCarrierPostgrest({ ...OPC, fetchImpl: sin.f }).umbralImpresionAuto('EC')).toBeNull();
    const vacio = fetchFalso(() => ({ status: 200, cuerpo: [] }));
    expect(await crearFuenteCarrierPostgrest({ ...OPC, fetchImpl: vacio.f }).umbralImpresionAuto('EC')).toBeNull();
  });

  it('estado: creada si hay trabajo automático, retenida si hay evento, si no ninguna', async () => {
    const estado = async (jobs: unknown[], eventos: unknown[]) => {
      const { f, llamadas } = fetchFalso((l) => ({ status: 200, cuerpo: l.url.includes('print_jobs') ? jobs : eventos }));
      const r = await crearFuenteCarrierPostgrest({ ...OPC, fetchImpl: f }).estadoImpresionAuto('o-1', 's-1');
      return { r, urls: llamadas.map((l) => l.url) };
    };
    expect((await estado([{ id: 'pj' }], [])).r).toBe('creada');
    expect((await estado([], [{ id: 'ev' }])).r).toBe('retenida');
    const ninguna = await estado([], []);
    expect(ninguna.r).toBe('ninguna');
    expect(ninguna.urls.some((u) => u.includes('order_events?order_id=eq.o-1&type=eq.transportadora&payload->>accion=eq.impresion_manual_requerida'))).toBe(true);
  });

  it('retener inserta el evento transportadora; 23505 (ya registrada) → false sin lanzar', async () => {
    const ok = fetchFalso(() => ({ status: 201 }));
    expect(await crearFuenteCarrierPostgrest({ ...OPC, fetchImpl: ok.f }).retenerImpresion('o-1', 'system', { flete: '30000' })).toBe(true);
    expect(ok.llamadas[0]!.cuerpo).toEqual({
      order_id: 'o-1',
      type: 'transportadora',
      actor: 'system',
      payload: { flete: '30000', accion: 'impresion_manual_requerida' },
    });
    const dup = fetchFalso(() => ({ status: 409, cuerpo: { code: '23505', message: 'duplicate key' } }));
    expect(await crearFuenteCarrierPostgrest({ ...OPC, fetchImpl: dup.f }).retenerImpresion('o-1', 'system', {})).toBe(false);
    const otro = fetchFalso(() => ({ status: 400, cuerpo: { code: '23514' } }));
    await expect(crearFuenteCarrierPostgrest({ ...OPC, fetchImpl: otro.f }).retenerImpresion('o-1', 'system', {})).rejects.toThrow(/23514/);
  });
});
