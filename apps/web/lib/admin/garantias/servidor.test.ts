import { beforeEach, describe, expect, it, vi } from 'vitest';

const { auditar, invalidar } = vi.hoisted(() => ({ auditar: vi.fn(async (_e: unknown) => true), invalidar: vi.fn() }));
vi.mock('@/lib/admin/auditoria', () => ({ auditarCambio: auditar }));
vi.mock('next/cache', () => ({ revalidateTag: invalidar }));

import { clienteFalso } from '../crud/cliente-falso';
import { esquemaAjustesGarantia, esquemaGestion, leerFiltrosGarantia, type DatosGestion } from './garantias';
import { gestionarGarantiaBd, guardarAjustesGarantiaBd, listarGarantias, obtenerGarantia } from './servidor';

const ID = '11111111-1111-4111-8111-111111111111';
const comun = { actor: 'u1', ip: null };
const AHORA = new Date('2026-10-20T15:00:00.000Z');

const previo = (o: Record<string, unknown> = {}) => ({
  id: ID,
  country_code: 'CO',
  status: 'recibida',
  resolution: null,
  cost_amount: 0,
  admin_notes: null,
  status_history: [],
  resolved_at: null,
  updated_at: '2026-10-19T10:00:00+00:00',
  ...o,
});

const datos = (o: Record<string, string> = {}): DatosGestion =>
  esquemaGestion('CO').parse({ id: ID, status: 'en_revision', resolution: '', cost_amount: '', admin_notes: '', nota_historial: '', ...o });

beforeEach(() => {
  auditar.mockClear();
  invalidar.mockClear();
});

describe('gestionarGarantiaBd', () => {
  it('cambia el estado, anota el historial y audita', async () => {
    const { cliente, llamadas, filtros } = clienteFalso({
      'warranty_claims.select': { data: previo() },
      'warranty_claims.update': { data: [{ id: ID }] },
    });
    const r = await gestionarGarantiaBd({ cliente, datos: datos({ nota_historial: 'Se pidió foto' }), ahora: AHORA, ...comun });
    expect(r).toEqual({ ok: true, id: ID });
    const fila = llamadas.find((l) => l.clave === 'warranty_claims.update')!.args[0] as Record<string, unknown>;
    expect(fila).toMatchObject({ status: 'en_revision', cost_amount: '0', resolved_at: null });
    expect(fila.status_history).toEqual([{ at: AHORA.toISOString(), actor: 'u1', from: 'recibida', to: 'en_revision', nota: 'Se pidió foto' }]);
    // Optimista: solo actualiza si nadie lo tocó desde que se leyó.
    expect(filtros.some((f) => f.metodo === 'eq' && f.args[0] === 'updated_at' && f.args[1] === '2026-10-19T10:00:00+00:00')).toBe(true);
    expect(auditar).toHaveBeenCalledWith(expect.objectContaining({ accion: 'garantias.estado_cambiado', entidad: 'warranty_claims', entidadId: ID }));
  });

  it('resolver fija resolved_at y guarda el costo como entero', async () => {
    const { cliente, llamadas } = clienteFalso({
      'warranty_claims.select': { data: previo({ status: 'aprobada' }) },
      'warranty_claims.update': { data: [{ id: ID }] },
    });
    const r = await gestionarGarantiaBd({
      cliente,
      datos: datos({ status: 'resuelta', resolution: 'cambio', cost_amount: '38000' }),
      ahora: AHORA,
      ...comun,
    });
    expect(r.ok).toBe(true);
    const fila = llamadas.find((l) => l.clave === 'warranty_claims.update')!.args[0] as Record<string, unknown>;
    expect(fila).toMatchObject({ status: 'resuelta', resolution: 'cambio', cost_amount: '38000', resolved_at: AHORA.toISOString() });
  });

  it('solo editar notas no agrega historial ni cambia resolved_at', async () => {
    const { cliente, llamadas } = clienteFalso({
      'warranty_claims.select': { data: previo({ status: 'resuelta', resolution: 'cambio', resolved_at: '2026-10-18T00:00:00Z', status_history: [{ at: 'a', actor: 'u', from: null, to: 'resuelta', nota: null }] }) },
      'warranty_claims.update': { data: [{ id: ID }] },
    });
    await gestionarGarantiaBd({ cliente, datos: datos({ status: 'resuelta', resolution: 'cambio', admin_notes: 'ok' }), ahora: AHORA, ...comun });
    const fila = llamadas.find((l) => l.clave === 'warranty_claims.update')!.args[0] as { status_history: unknown[]; resolved_at: string };
    expect(fila.status_history).toHaveLength(1);
    expect(fila.resolved_at).toBe('2026-10-18T00:00:00Z');
    expect(auditar).toHaveBeenCalledWith(expect.objectContaining({ accion: 'garantias.actualizada' }));
  });

  it('rechaza un salto de estado sin tocar la base', async () => {
    const { cliente, llamadas } = clienteFalso({ 'warranty_claims.select': { data: previo() } });
    const r = await gestionarGarantiaBd({ cliente, datos: datos({ status: 'resuelta', resolution: 'otro' }), ...comun });
    expect(r).toMatchObject({ ok: false, errores: { status: expect.any(String) } });
    expect(llamadas.some((l) => l.clave === 'warranty_claims.update')).toBe(false);
    expect(auditar).not.toHaveBeenCalled();
  });

  it('si otra persona modificó el caso, no lo pisa', async () => {
    const { cliente } = clienteFalso({ 'warranty_claims.select': { data: previo() }, 'warranty_claims.update': { data: [] } });
    const r = await gestionarGarantiaBd({ cliente, datos: datos(), ...comun });
    expect(r).toMatchObject({ ok: false, mensaje: expect.stringMatching(/Alguien más/) });
    expect(auditar).not.toHaveBeenCalled();
  });

  it('caso inexistente', async () => {
    const { cliente } = clienteFalso({ 'warranty_claims.select': { data: null } });
    expect(await gestionarGarantiaBd({ cliente, datos: datos(), ...comun })).toMatchObject({ ok: false, mensaje: expect.stringMatching(/ya no existe/) });
  });
});

describe('guardarAjustesGarantiaBd', () => {
  it('hace upsert por país, audita e invalida el contenido del país', async () => {
    const { cliente, llamadas } = clienteFalso({ 'warranty_settings.select': { data: { country_code: 'CO', period_days: 30, response_days: 5, reasons: [], instructions_html: '', conditions_html: '' } }, 'warranty_settings.upsert': {} });
    const d = esquemaAjustesGarantia.parse({ country_code: 'CO', period_days: '45', response_days: '3', reasons: 'Producto dañado', instructions_html: '', conditions_html: '' });
    expect(await guardarAjustesGarantiaBd({ cliente, datos: d, ...comun })).toEqual({ ok: true, id: 'CO' });
    expect(llamadas.find((l) => l.clave === 'warranty_settings.upsert')!.args[1]).toEqual({ onConflict: 'country_code' });
    expect(auditar).toHaveBeenCalledWith(expect.objectContaining({ accion: 'garantias.ajustes_guardados', diff: expect.objectContaining({ despues: expect.objectContaining({ period_days: 45 }) }) }));
    expect(invalidar).toHaveBeenCalledWith('content:CO');
  });
});

describe('listarGarantias', () => {
  const ajustes = { data: [{ country_code: 'CO', response_days: 5 }, { country_code: 'EC', response_days: 3 }] };
  const caso = (o: Record<string, unknown> = {}) => ({ id: ID, number: 'GAR-CO-0001', country_code: 'CO', customer_name: 'Ana', phone: '3001234567', reason: 'Dañado', status: 'recibida', resolution: null, cost_amount: 0, created_at: '2026-10-10T12:00:00Z', resolved_at: null, order_id: null, ...o });

  it('marca las vencidas según los días de respuesta de su país', async () => {
    const { cliente } = clienteFalso({
      'warranty_settings.select': ajustes,
      'warranty_claims.select': { data: [caso(), caso({ id: 'b', country_code: 'EC', created_at: '2026-10-19T12:00:00Z' }), caso({ id: 'c', status: 'resuelta' })], count: 3 },
    });
    const { filas, total } = await listarGarantias(cliente, leerFiltrosGarantia({}), AHORA);
    expect(total).toBe(3);
    expect(filas.map((f) => f.vencida)).toEqual([true, false, false]);
  });

  it('con "vencidas" filtra abiertas y compara con el límite de cada país', async () => {
    const { cliente, filtros } = clienteFalso({ 'warranty_settings.select': ajustes, 'warranty_claims.select': { data: [], count: 0 } });
    await listarGarantias(cliente, leerFiltrosGarantia({ vencidas: '1', estado: 'recibida', pais: 'CO', q: 'GAR-CO-0001' }), AHORA);
    const f = filtros.filter((x) => x.tabla === 'warranty_claims');
    expect(f.find((x) => x.metodo === 'in')?.args).toEqual(['status', ['recibida', 'en_revision']]);
    const or = String(f.find((x) => x.metodo === 'or')?.args[0]);
    expect(or).toContain('country_code.eq.CO,created_at.lt.2026-10-15T15:00:00.000Z'); // 5 días
    expect(or).toContain('country_code.eq.EC,created_at.lt.2026-10-17T15:00:00.000Z'); // 3 días
    expect(f.find((x) => x.metodo === 'ilike')?.args).toEqual(['number', '%GAR-CO-0001%']);
  });
});

describe('obtenerGarantia', () => {
  it('trae el pedido, las fotos y el historial ordenado', async () => {
    const { cliente } = clienteFalso({
      'warranty_claims.select': {
        data: {
          ...previo({ status: 'en_revision', created_at: '2026-10-10T12:00:00Z' }),
          number: 'GAR-CO-0001',
          customer_name: 'Ana',
          phone: '300',
          email: null,
          reason: 'Dañado',
          description: null,
          order_id: 'o1',
          media_ids: ['m1', 'm2'],
          status_history: [{ at: '2026-10-11T00:00:00Z', actor: 'u1', from: 'recibida', to: 'en_revision', nota: null }],
          created_at: '2026-10-10T12:00:00Z',
        },
      },
      'orders.select': { data: { id: 'o1', number: 'IZ-CO-000001', status: 'entregado', delivered_at: null } },
      'media.select': { data: [{ id: 'm1', variants: { '400': 'w/a-400.webp' }, alt: null, original_name: 'foto.jpg' }, { id: 'm2', variants: {}, alt: null, original_name: null }] },
      'warranty_settings.select': { data: [{ country_code: 'CO', response_days: 5 }] },
    });
    const d = await obtenerGarantia(cliente, ID, AHORA);
    expect(d?.pedido?.number).toBe('IZ-CO-000001');
    expect(d?.fotos).toEqual([{ id: 'm1', ruta: 'w/a-400.webp', alt: 'foto.jpg' }]);
    expect(d?.historial).toHaveLength(1);
    expect(d?.limite).toEqual({ fecha: '2026-10-15T12:00:00.000Z', vencida: true });
    expect(d?.caso).not.toHaveProperty('status_history');
    expect(d?.caso).not.toHaveProperty('media_ids');
  });

  it('inexistente = null', async () => {
    const { cliente } = clienteFalso({ 'warranty_claims.select': { data: null } });
    expect(await obtenerGarantia(cliente, ID)).toBeNull();
  });
});
