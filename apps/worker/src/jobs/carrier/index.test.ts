import { describe, expect, it } from 'vitest';
import { JOB_CARRIER_CREATE, OPCIONES_JOB_CARRIER, type ColaMinima } from '@izao/mastershop';
import { fetchFalso } from '../fetch-falso.js';
import { crearFuenteCarrierPostgrest } from './fuente-postgrest.js';
import { crearProcesadorCarrier, dependenciasCarrierDesdeEnv, encolarTransportadora, programadorCarrier } from './index.js';
import { FuenteMemoria, ProgramadorMemoria } from './fuente-memoria.js';
import type { DepsCarrier } from './comun.js';

function colaFalsa(estados: Record<string, string> = {}) {
  const agregados: { nombre: string; datos: unknown; opts: Record<string, unknown> }[] = [];
  const quitados: string[] = [];
  const cola: ColaMinima = {
    async getJob(id) {
      const estado = estados[id];
      return estado ? { getState: async () => estado, remove: async () => void quitados.push(id) } : undefined;
    },
    async add(nombre, datos, opts) {
      agregados.push({ nombre, datos, opts });
    },
  };
  return { cola, agregados, quitados };
}

const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SECRET_KEY: 'sb', APP_ENCRYPTION_KEY: 'k'.repeat(44) };

describe('encolarTransportadora y programador', () => {
  it('encola carrier.create con id fijo y no duplica uno pendiente', async () => {
    const { cola, agregados } = colaFalsa({ 'carrier.create.o2': 'delayed' });
    const encolar = encolarTransportadora(cola);
    await encolar('o1');
    await encolar('o2');
    expect(agregados).toEqual([
      { nombre: JOB_CARRIER_CREATE, datos: { order_id: 'o1', intento: 0 }, opts: { ...OPCIONES_JOB_CARRIER, jobId: 'carrier.create.o1' } },
    ]);
  });

  it('"Reintentar" reemplaza un job terminado', async () => {
    const { cola, agregados, quitados } = colaFalsa({ 'carrier.create.o1': 'completed' });
    await encolarTransportadora(cola)('o1');
    expect(quitados).toEqual(['carrier.create.o1']);
    expect(agregados).toHaveLength(1);
  });

  it('reintentos y etiqueta con espera e id por intento', async () => {
    const { cola, agregados } = colaFalsa();
    const p = programadorCarrier(cola);
    await p.crear('o1', 2, 120_000);
    await p.etiqueta('o1', 0, 120_000);
    expect(agregados.map((a) => [a.opts.jobId, a.opts.delay])).toEqual([
      ['carrier.create.o1.r2', 120_000],
      ['carrier.poll_label.o1.0', 120_000],
    ]);
  });
});

describe('procesador de la cola carrier', () => {
  it('rechaza datos inválidos sin tocar nada', async () => {
    const fuente = new FuenteMemoria();
    const deps = { fuente, programar: new ProgramadorMemoria() } as unknown as DepsCarrier;
    const proc = crearProcesadorCarrier(deps);
    const r = await proc({ name: JOB_CARRIER_CREATE, data: { order_id: 'a:b', intento: 0 } } as never, undefined);
    expect(r).toMatchObject({ ok: false, motivo: 'datos_invalidos' });
    expect(fuente.eventos).toEqual([]);
  });
});

describe('dependenciasCarrierDesdeEnv', () => {
  it('exige las variables de Supabase y prohíbe el modo simulado en producción', () => {
    const p = new ProgramadorMemoria();
    expect(() => dependenciasCarrierDesdeEnv(p, {})).toThrow(/Faltan/);
    expect(() => dependenciasCarrierDesdeEnv(p, { ...ENV, MASTERSHOP_MODO: 'simulado', NODE_ENV: 'production' })).toThrow(/producción/);
    const d = dependenciasCarrierDesdeEnv(p, { ...ENV, MASTERSHOP_MODO: 'simulado', NODE_ENV: 'development' });
    expect(typeof d.transportadora).toBe('function');
    expect(d.recalcularMetricas).toBeUndefined();
  });

  it('con recalcularMetricas lo expone y envuelve la transición de la fuente', () => {
    const recalcular = async () => {};
    const d = dependenciasCarrierDesdeEnv(new ProgramadorMemoria(), ENV, recalcular);
    expect(d.recalcularMetricas).toBe(recalcular);
    expect(d.fuente.aplicarTransicion.name).toBe('aplicarTransicion');
    expect(d.fuente.aplicarTransicion).not.toBe(dependenciasCarrierDesdeEnv(new ProgramadorMemoria(), ENV).fuente.aplicarTransicion);
  });
});

describe('fuente PostgREST de carrier', () => {
  it('guardarEnvio hace upsert por (order_id, provider), agrega historial y serializa bigint', async () => {
    const { f, llamadas } = fetchFalso((l) => {
      if (l.metodo === 'GET') return { status: 200, cuerpo: [{ status_history: [{ id_status: 1 }] }] };
      return { status: 201, cuerpo: [{ id: 's1', order_id: 'o1', external_order_id: 'IZ-CO-1', provider_order_id: 5, provider_status_id: 2 }] };
    });
    const fuente = crearFuenteCarrierPostgrest({ ...ENV, supabaseUrl: ENV.SUPABASE_URL, secretKey: 'sb', claveCifrado: ENV.APP_ENCRYPTION_KEY, fetchImpl: f });
    const e = await fuente.guardarEnvio('o1', {
      external_order_id: 'IZ-CO-1',
      provider_status_id: 2,
      shipping_rate: 12_500n,
      historial: { id_status: 2, at: '2026-10-20T00:00:00.000Z', origen: 'confirmacion' },
    });
    expect(e).toMatchObject({ id: 's1', provider_order_id: 5, provider_status_id: 2 });
    const post = llamadas.find((l) => l.metodo === 'POST')!;
    expect(post.url).toContain('shipments?on_conflict=order_id,provider');
    expect(post.cabeceras.get('prefer')).toBe('resolution=merge-duplicates,return=representation');
    expect(post.cuerpo).toMatchObject({
      order_id: 'o1',
      provider: 'mastershop',
      shipping_rate: '12500',
      status_history: [{ id_status: 1 }, { id_status: 2, origen: 'confirmacion' }],
    });
  });

  it('crearImpresionEtiqueta no duplica una etiqueta no cancelada', async () => {
    const { f, llamadas } = fetchFalso((l) => (l.metodo === 'GET' ? { status: 200, cuerpo: [{ id: 'p1' }] } : { status: 201 }));
    const fuente = crearFuenteCarrierPostgrest({ supabaseUrl: ENV.SUPABASE_URL, secretKey: 'sb', claveCifrado: ENV.APP_ENCRYPTION_KEY, fetchImpl: f });
    expect(await fuente.crearImpresionEtiqueta('o1', 's1')).toBe(false);
    expect(llamadas.map((l) => l.metodo)).toEqual(['GET']);
    expect(llamadas[0]!.url).toContain('status=neq.cancelled');
  });
});
