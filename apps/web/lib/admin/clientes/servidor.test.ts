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
const AHORA = new Date('2026-10-25T12:00:00.000Z');
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

describe('anonimizarClienteBd', () => {
  const datos = { id: ID, motivo: 'Radicado 123 del 20/10' };

  it('neutraliza pedidos, garantías, leads, direcciones y cuenta, y marca al final', async () => {
    const f = conAuth(base());
    const r = await anonimizarClienteBd({ cliente: f.cliente, datos, ahora: AHORA, ...comun });
    expect(r).toEqual({ ok: true, id: ID });
    const orden = f.llamadas.filter((l) => /\.(update|delete)$/.test(l.clave)).map((l) => l.clave);
    expect(orden).toEqual([
      'orders.update',
      'whatsapp_messages.update',
      'warranty_claims.update',
      'leads.delete',
      'warranty_claims.update',
      'leads.delete',
      'addresses.delete',
      'wishlists.delete',
      'chat_sessions.delete',
      'customers.update',
    ]);
    expect(f.borrar).toHaveBeenCalledWith(AUTH);
    expect(f.llamadas.find((l) => l.clave === 'orders.update')!.args[0]).toMatchObject({
      contact_first_name: 'Anonimizado',
      contact_email: null,
      document_number: null,
      shipping_address1: null,
    });
    // Los pedidos conservan montos, fecha, estado y ciudad: no se tocan esas columnas.
    expect(Object.keys(f.llamadas.find((l) => l.clave === 'orders.update')!.args[0] as object)).not.toEqual(
      expect.arrayContaining(['total_customer', 'status', 'created_at', 'shipping_city_name']),
    );
    expect(f.llamadas.filter((l) => l.clave === 'customers.update').at(-1)!.args[0]).toMatchObject({
      first_name: null,
      email: null,
      phone_e164: null,
      document_number: null,
      marketing_opt_in: false,
      anonymized_at: AHORA.toISOString(),
    });
    // Garantías y leads se buscan por celular y por correo, cada uno con su filtro.
    const eqs = f.filtros.filter((x) => (x.tabla === 'warranty_claims' || x.tabla === 'leads') && x.metodo === 'eq').map((x) => x.args);
    expect(eqs).toEqual(expect.arrayContaining([['phone', CELULAR], ['email', CORREO], ['phone_e164', CELULAR]]));
  });

  it('la auditoría no lleva ningún dato personal', async () => {
    const f = conAuth(base());
    await anonimizarClienteBd({ cliente: f.cliente, datos, ahora: AHORA, ...comun });
    const texto = JSON.stringify(auditar.mock.calls);
    for (const dato of [CORREO, CELULAR, 'Ana', 'Pérez', '1020304050']) expect(texto).not.toContain(dato);
    expect(auditar).toHaveBeenCalledWith(
      expect.objectContaining({ accion: 'clientes.anonimizado', entidadId: ID, diff: { motivo: datos.motivo, pedidos: 2, direcciones: 2, cuenta_acceso_eliminada: true } }),
    );
  });

  it('con pedidos en curso no toca nada', async () => {
    const f = conAuth(base({ 'orders.select': { data: [pedido('a', 'pagado')] } }));
    const r = await anonimizarClienteBd({ cliente: f.cliente, datos, ...comun });
    expect(r).toMatchObject({ ok: false, mensaje: expect.stringMatching(/en curso/) });
    expect(f.llamadas.some((l) => /\.(update|delete)$/.test(l.clave))).toBe(false);
    expect(f.borrar).not.toHaveBeenCalled();
    expect(auditar).not.toHaveBeenCalled();
  });

  it('si un paso falla, el cliente no queda marcado y se puede repetir', async () => {
    const f = conAuth(base({ 'addresses.delete': { error: { message: 'boom' } } }));
    const r = await anonimizarClienteBd({ cliente: f.cliente, datos, ...comun });
    expect(r).toMatchObject({ ok: false, mensaje: expect.stringMatching(/direcciones.*intentarlo de nuevo/) });
    expect(f.llamadas.some((l) => l.clave === 'customers.update')).toBe(false);
    expect(f.borrar).not.toHaveBeenCalled();
    expect(auditar).not.toHaveBeenCalled();
  });

  it('un cliente sin cuenta de acceso ni celular no busca por esos campos', async () => {
    const f = conAuth(base({ 'customers.select': { data: cliente({ auth_user_id: null, phone_e164: null }) } }));
    expect((await anonimizarClienteBd({ cliente: f.cliente, datos, ahora: AHORA, ...comun })).ok).toBe(true);
    expect(f.borrar).not.toHaveBeenCalled();
    expect(f.filtros.some((x) => x.args[0] === 'phone_e164')).toBe(false);
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
