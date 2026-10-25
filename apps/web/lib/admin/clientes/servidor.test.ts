import { beforeEach, describe, expect, it, vi } from 'vitest';

const { auditar } = vi.hoisted(() => ({ auditar: vi.fn(async (_e: unknown) => true) }));
vi.mock('@/lib/admin/auditoria', () => ({ auditarCambio: auditar }));
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));

import type { Cliente } from '../catalogo/taxonomias-servidor';
import { clienteFalso, type RespuestaOLista } from '../crud/cliente-falso';
import { leerFiltrosCliente } from './clientes';
import { anonimizarClienteBd, listarClientes, obtenerCliente } from './servidor';

const ID = '11111111-1111-4111-8111-111111111111';
const AUTH = '33333333-3333-4333-8333-333333333333';
const comun = { actor: 'admin1', ip: null };
const CORREO = 'ana@correo.co';
const CELULAR = '+573001234567';

const cliente = (o: Record<string, unknown> = {}) => ({
  id: ID,
  country_code: 'CO',
  first_name: 'Ana',
  last_name: 'Pérez',
  email: CORREO,
  phone_e164: CELULAR,
  marketing_opt_in: true,
  whatsapp_opt_in: true,
  anonymized_at: null,
  created_at: '2026-01-01T00:00:00Z',
  document_type: 'CC',
  document_number: '1020304050',
  auth_user_id: AUTH,
  ...o,
});
const pedido = (id: string, status: string) => ({ id, number: `IZ-CO-${id}`, status, currency_code: 'COP', total_customer: 100000, created_at: '2026-09-01T00:00:00Z' });

function conAuth(respuestas: Record<string, RespuestaOLista>, borrar = vi.fn(async (_id: string) => ({ error: null }))) {
  const f = clienteFalso(respuestas);
  const auth = { admin: { deleteUser: borrar } };
  return { ...f, borrar, cliente: Object.assign(f.cliente as object, { auth }) as unknown as Cliente };
}

/** Respuestas base de un cliente con un pedido entregado (por id) y uno de invitado (por celular). */
const base = (extra: Record<string, RespuestaOLista> = {}): Record<string, RespuestaOLista> => ({
  'customers.select': { data: cliente() },
  'orders.select': [{ data: [pedido('a', 'entregado')] }, { data: [pedido('a', 'entregado'), pedido('b', 'cancelado')] }, { data: [] }],
  'warranty_claims.select': { count: 0 },
  'addresses.select': { count: 2 },
  'admin_users.select': { count: 0 },
  ...extra,
});

beforeEach(() => auditar.mockClear());

describe('obtenerCliente', () => {
  it('une pedidos vinculados y de invitado sin repetir, y no bloquea si todo está cerrado', async () => {
    const { cliente: c } = conAuth(base());
    const d = await obtenerCliente(c, ID);
    expect(d?.pedidos.map((p) => p.id).sort()).toEqual(['a', 'b']);
    expect(d?.direcciones).toBe(2);
    expect(d?.bloqueos).toEqual([]);
  });

  it('bloquea con pedidos en curso, garantías abiertas o cuenta del panel', async () => {
    const { cliente: c } = conAuth(
      base({ 'orders.select': { data: [pedido('a', 'en_transito')] }, 'warranty_claims.select': { count: 1 }, 'admin_users.select': { count: 1 } }),
    );
    const d = await obtenerCliente(c, ID);
    expect(d?.bloqueos).toHaveLength(3);
  });

  it('un cliente ya anonimizado no consulta pedidos', async () => {
    const f = conAuth(base({ 'customers.select': { data: cliente({ anonymized_at: '2026-10-01T00:00:00Z', first_name: null, email: null, phone_e164: null }) } }));
    const d = await obtenerCliente(f.cliente, ID);
    expect(d?.pedidos).toEqual([]);
    expect(f.llamadas.some((l) => l.clave === 'orders.select')).toBe(false);
    expect(d?.bloqueos).toEqual(['Este cliente ya fue anonimizado.']);
  });

  it('inexistente = null', async () => {
    const { cliente: c } = conAuth({ 'customers.select': { data: null } });
    expect(await obtenerCliente(c, ID)).toBeNull();
  });
});

describe('anonimizarClienteBd (RPC atómica)', () => {
  const datos = { id: ID, motivo: 'Radicado 123 del 20/10' };
  const { cliente } = clienteFalso({});
  const exito = {
    ok: true as const,
    estado: 'anonimizado' as const,
    id: ID,
    pedidos: 2,
    mensajes_whatsapp: 1,
    garantias: 1,
    leads: 3,
    direcciones: 2,
    deseos: 4,
    conversaciones: 5,
    cuenta_acceso_eliminada: true,
    pagos_limpiados: 2,
    webhooks_recortados: 3,
    resenas: 1,
    fotos_garantia: 4,
  };

  it('llama a la RPC con el id y audita el resultado sin datos personales', async () => {
    const rpc = vi.fn(async (_id: string) => exito);
    expect(await anonimizarClienteBd({ cliente, datos, rpc, ...comun })).toEqual({ ok: true, id: ID });
    expect(rpc).toHaveBeenCalledWith(ID);
    const texto = JSON.stringify(auditar.mock.calls);
    for (const dato of [CORREO, CELULAR, 'Ana', 'Pérez', '1020304050']) expect(texto).not.toContain(dato);
    expect(auditar).toHaveBeenCalledWith(
      expect.objectContaining({
        accion: 'clientes.anonimizado',
        entidadId: ID,
        diff: {
          motivo: datos.motivo,
          pedidos: 2,
          garantias: 1,
          leads: 3,
          direcciones: 2,
          conversaciones: 5,
          pagos_limpiados: 2,
          webhooks_recortados: 3,
          resenas: 1,
          fotos_garantia: 4,
          cuenta_acceso_eliminada: true,
        },
      }),
    );
  });

  it('si la RPC se niega por pedidos o garantías en curso, lo explica y no audita', async () => {
    const rpc = vi.fn(async () => ({ ok: false as const, motivo: 'bloqueado' as const, cuenta_del_panel: false, pedidos_en_curso: 2, garantias_abiertas: 1 }));
    const r = await anonimizarClienteBd({ cliente, datos, rpc, ...comun });
    expect(r).toMatchObject({ ok: false, mensaje: expect.stringMatching(/2 pedido.*en curso.*1 garantía/) });
    expect(auditar).not.toHaveBeenCalled();
  });

  it('explica cuenta del panel, ya anonimizado, inexistente y datos inválidos', async () => {
    const motivo = (m: 'ya_anonimizado' | 'no_existe' | 'datos_invalidos') => anonimizarClienteBd({ cliente, datos, rpc: async () => ({ ok: false, motivo: m }), ...comun });
    expect(await motivo('ya_anonimizado')).toMatchObject({ ok: false, mensaje: expect.stringMatching(/ya fue anonimizado/) });
    expect(await motivo('no_existe')).toMatchObject({ ok: false, mensaje: expect.stringMatching(/ya no existe/) });
    expect(await motivo('datos_invalidos')).toMatchObject({ ok: false });
    const panel = await anonimizarClienteBd({
      cliente,
      datos,
      rpc: async () => ({ ok: false, motivo: 'bloqueado', cuenta_del_panel: true, pedidos_en_curso: 0, garantias_abiertas: 0 }),
      ...comun,
    });
    expect(panel).toMatchObject({ ok: false, mensaje: expect.stringMatching(/cuenta del panel/) });
    expect(auditar).not.toHaveBeenCalled();
  });

  it('un fallo de la base se propaga: no se audita una anonimización que no ocurrió', async () => {
    const rpc = vi.fn(async (): Promise<never> => {
      throw new Error('db caída');
    });
    await expect(anonimizarClienteBd({ cliente, datos, rpc, ...comun })).rejects.toThrow('db caída');
    expect(auditar).not.toHaveBeenCalled();
  });
});

describe('listarClientes', () => {
  it('aplica país, estado y búsqueda por correo', async () => {
    const { cliente: c, filtros } = clienteFalso({ 'customers.select': { data: [cliente()], count: 1 } });
    const r = await listarClientes(c, leerFiltrosCliente({ pais: 'CO', estado: 'activos', q: 'ANA@correo.co' }));
    expect(r.total).toBe(1);
    const f = filtros.map((x) => [x.metodo, ...x.args]);
    expect(f).toEqual(expect.arrayContaining([['eq', 'country_code', 'CO'], ['is', 'anonymized_at', null], ['ilike', 'email', '%ana@correo.co%']]));
  });

  it('la búsqueda por nombre solo deja pasar letras, números, espacio y guion al filtro', async () => {
    const { cliente: c, filtros } = clienteFalso({ 'customers.select': { data: [], count: 0 } });
    await listarClientes(c, leerFiltrosCliente({ q: 'Ana),first_name.neq.x' }));
    const or = String(filtros.find((x) => x.metodo === 'or')?.args[0]);
    expect(or).toBe('first_name.ilike.%Anafirstnameneqx%,last_name.ilike.%Anafirstnameneqx%');
    expect(or).not.toContain(')');
  });
});
