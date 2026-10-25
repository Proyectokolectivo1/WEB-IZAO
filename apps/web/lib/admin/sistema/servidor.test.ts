import { describe, expect, it } from 'vitest';
import { clienteFalso } from '../crud/cliente-falso';
import { leerFiltrosAuditoria } from './auditoria';
import { erroresRecientes, listarAuditoria, volumenDeDatos } from './servidor';

const USUARIO = '11111111-1111-4111-8111-111111111111';
const evento = (o: Record<string, unknown> = {}) => ({
  id: 'e1',
  actor: USUARIO,
  action: 'gastos.creado',
  entity: 'expenses',
  entity_id: 'x',
  diff: { despues: {} },
  ip: '10.0.0.1',
  created_at: '2026-10-20T15:00:00Z',
  ...o,
});

describe('listarAuditoria', () => {
  it('oculta los accesos por defecto, aplica filtros y resuelve el nombre del actor', async () => {
    const { cliente, filtros } = clienteFalso({
      'audit_log.select': { data: [evento(), evento({ id: 'e2', actor: 'script:crear-admin' })], count: 2 },
      'admin_users.select': { data: [{ auth_user_id: USUARIO, name: 'Ana' }] },
    });
    const r = await listarAuditoria(cliente, leerFiltrosAuditoria({ accion: 'gastos.', desde: '2026-10-01', hasta: '2026-10-20' }));
    expect(r.total).toBe(2);
    expect(r.filas.map((e) => e.actorNombre)).toEqual(['Ana', null]);
    const f = filtros.filter((x) => x.tabla === 'audit_log').map((x) => [x.metodo, ...x.args]);
    expect(f).toEqual(
      expect.arrayContaining([
        ['neq', 'entity', 'sesion_admin'],
        ['ilike', 'action', 'gastos.%'],
        ['gte', 'created_at', '2026-10-01T05:00:00.000Z'],
        ['lt', 'created_at', '2026-10-21T05:00:00.000Z'],
      ]),
    );
  });

  it('con "accesos" o una entidad explícita no excluye los accesos', async () => {
    const a = clienteFalso({ 'audit_log.select': { data: [], count: 0 } });
    await listarAuditoria(a.cliente, leerFiltrosAuditoria({ accesos: '1' }));
    expect(a.filtros.some((x) => x.metodo === 'neq')).toBe(false);
    const b = clienteFalso({ 'audit_log.select': { data: [], count: 0 } });
    await listarAuditoria(b.cliente, leerFiltrosAuditoria({ entidad: 'sesion_admin' }));
    expect(b.filtros.find((x) => x.metodo === 'eq')?.args).toEqual(['entity', 'sesion_admin']);
  });

  it('propaga el error de la base', async () => {
    const { cliente } = clienteFalso({ 'audit_log.select': { error: { message: 'boom' } } });
    await expect(listarAuditoria(cliente, leerFiltrosAuditoria({}))).rejects.toThrow(/auditoría/);
  });
});

describe('erroresRecientes y volumenDeDatos', () => {
  it('junta webhooks, impresiones, WhatsApp (sin número) y pedidos con error', async () => {
    const { cliente, llamadas } = clienteFalso({
      'webhook_events.select': { data: [{ id: 'w', provider: 'wompi', event_id: 'ev', error: 'firma', created_at: 'x' }] },
      'print_jobs.select': { data: [{ id: 'p', type: 'label', error: 'sin papel', attempts: 3, created_at: 'x' }] },
      'whatsapp_messages.select': { data: [{ id: 'm', error_code: '131026', error_text: null, order_id: 'o', created_at: 'x' }] },
      'orders.select': { count: 4 },
    });
    const r = await erroresRecientes(cliente);
    expect(r.pedidosErrorTransportadora).toBe(4);
    expect([r.webhooks.length, r.impresiones.length, r.whatsapp.length]).toEqual([1, 1, 1]);
    const columnas = String(llamadas.find((l) => l.clave === 'whatsapp_messages.select')!.args[0]);
    expect(columnas).not.toContain('to_e164');
  });

  it('cuenta las tablas que más crecen', async () => {
    const { cliente } = clienteFalso({ 'orders.select': { count: 10 }, 'audit_log.select': { count: 99 } });
    const v = await volumenDeDatos(cliente);
    expect(v.find((x) => x.tabla === 'orders')?.filas).toBe(10);
    expect(v.find((x) => x.tabla === 'audit_log')?.filas).toBe(99);
    expect(v.length).toBeGreaterThanOrEqual(5);
  });
});
