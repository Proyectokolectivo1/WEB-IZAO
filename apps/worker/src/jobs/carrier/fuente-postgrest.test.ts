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
