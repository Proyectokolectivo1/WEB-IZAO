import { beforeEach, describe, expect, it, vi } from 'vitest';

const { auditar } = vi.hoisted(() => ({ auditar: vi.fn(async (_e: unknown) => true) }));
vi.mock('@/lib/admin/auditoria', () => ({ auditarCambio: auditar }));

import { hashTokenAgente, tokenDeEncabezado } from '@/app/api/agent/_lib/contrato';
import { clienteFalso } from '../crud/cliente-falso';
import { estadoConexion } from './estado';
import {
  cambiarEstadoAgenteBd,
  conEstado,
  crearAgenteBd,
  generarTokenAgente,
  guardarConfigAgenteBd,
  listarAgentes,
  paginaPruebaBd,
  rotarTokenBd,
} from './servidor';

const ID = '11111111-1111-4111-8111-111111111111';
const comun = { actor: 'u1', ip: null };
const TOKEN = 'T'.repeat(43);
const agente = (extra: Record<string, unknown> = {}) => ({
  id: ID,
  name: 'PC despacho',
  is_active: true,
  mode: 'api',
  version: '1.0.0',
  printer_name: 'Zebra',
  last_heartbeat_at: '2026-10-21T15:00:00Z',
  created_at: '2026-10-01T10:00:00Z',
  status_payload: {},
  remote_config: {},
  ...extra,
});

beforeEach(() => auditar.mockClear());

describe('token', () => {
  it('es largo, aleatorio y lo acepta la API del agente', () => {
    const a = generarTokenAgente();
    const b = generarTokenAgente();
    expect(a).not.toBe(b);
    expect(tokenDeEncabezado(`Bearer ${a}`)).toBe(a);
    expect(a.length).toBeGreaterThanOrEqual(32);
  });
});

describe('crearAgenteBd', () => {
  it('guarda solo el hash, devuelve el token una vez y no lo audita', async () => {
    const { cliente, llamadas } = clienteFalso({ 'print_agents.insert': { data: { id: ID } } });
    const r = await crearAgenteBd({ cliente, ...comun, nombre: '  PC despacho ', generar: () => TOKEN });
    expect(r).toMatchObject({ ok: true, id: ID, token: TOKEN });
    const fila = llamadas.find((l) => l.clave === 'print_agents.insert')!.args[0] as Record<string, unknown>;
    expect(fila).toEqual({ name: 'PC despacho', token_hash: hashTokenAgente(TOKEN) });
    expect(JSON.stringify(fila)).not.toContain(TOKEN);
    expect(auditar.mock.calls[0]![0]).toMatchObject({ accion: 'agente.creado', entidadId: ID });
    expect(JSON.stringify(auditar.mock.calls)).not.toContain(TOKEN);
    expect(JSON.stringify(auditar.mock.calls)).not.toContain(hashTokenAgente(TOKEN));
  });

  it('nombre inválido o error de base: no devuelve token', async () => {
    const { cliente } = clienteFalso({ 'print_agents.insert': { error: { message: 'x' } } });
    expect((await crearAgenteBd({ cliente, ...comun, nombre: 'a' })).ok).toBe(false);
    const r = await crearAgenteBd({ cliente, ...comun, nombre: 'PC despacho', generar: () => TOKEN });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain(TOKEN);
    expect(auditar).not.toHaveBeenCalled();
  });
});

describe('rotarTokenBd', () => {
  it('reemplaza el hash y el token viejo deja de coincidir', async () => {
    const { cliente, llamadas } = clienteFalso({ 'print_agents.select': { data: agente() }, 'print_agents.update': { data: null } });
    const r = await rotarTokenBd({ cliente, ...comun, id: ID, generar: () => TOKEN });
    expect(r).toMatchObject({ ok: true, token: TOKEN });
    const cambio = llamadas.find((l) => l.clave === 'print_agents.update')!.args[0] as Record<string, unknown>;
    expect(cambio).toEqual({ token_hash: hashTokenAgente(TOKEN) });
    expect(auditar.mock.calls[0]![0]).toMatchObject({ accion: 'agente.token_rotado' });
    expect(JSON.stringify(auditar.mock.calls)).not.toContain(TOKEN);
  });

  it('agente inexistente o fallo de base: sin token', async () => {
    const a = clienteFalso({ 'print_agents.select': { data: null } });
    expect((await rotarTokenBd({ cliente: a.cliente, ...comun, id: ID })).ok).toBe(false);
    const b = clienteFalso({ 'print_agents.select': { data: agente() }, 'print_agents.update': { error: { message: 'x' } } });
    const r = await rotarTokenBd({ cliente: b.cliente, ...comun, id: ID, generar: () => TOKEN });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });
});

describe('cambiarEstadoAgenteBd', () => {
  it('desactiva, audita antes/después; si ya estaba así no escribe', async () => {
    const a = clienteFalso({ 'print_agents.select': { data: agente() }, 'print_agents.update': { data: null } });
    expect((await cambiarEstadoAgenteBd({ cliente: a.cliente, ...comun, id: ID, activo: false })).ok).toBe(true);
    expect(a.llamadas.find((l) => l.clave === 'print_agents.update')!.args[0]).toEqual({ is_active: false });
    expect(auditar.mock.calls[0]![0]).toMatchObject({ accion: 'agente.desactivado', diff: { antes: { is_active: true }, despues: { is_active: false } } });

    auditar.mockClear();
    const b = clienteFalso({ 'print_agents.select': { data: agente() } });
    expect((await cambiarEstadoAgenteBd({ cliente: b.cliente, ...comun, id: ID, activo: true })).ok).toBe(true);
    expect(b.llamadas.some((l) => l.clave === 'print_agents.update')).toBe(false);
    expect(auditar).not.toHaveBeenCalled();
  });
});

describe('guardarConfigAgenteBd', () => {
  it('guarda modo y configuración conservando claves ajenas, y audita el diff', async () => {
    const { cliente, llamadas } = clienteFalso({
      'print_agents.select': { data: agente({ remote_config: { print: { copies: 1 }, futuro: true } }) },
      'print_agents.update': { data: null },
    });
    const r = await guardarConfigAgenteBd({ cliente, ...comun, id: ID, modo: 'api', config: { print: { copies: 2, print_settings: 'noscale' } } });
    expect(r.ok).toBe(true);
    expect(llamadas.find((l) => l.clave === 'print_agents.update')!.args[0]).toEqual({
      mode: 'api',
      remote_config: { futuro: true, print: { copies: 2, print_settings: 'noscale' } },
    });
    expect(auditar.mock.calls[0]![0]).toMatchObject({ accion: 'agente.configuracion_guardada' });
    const diff = (auditar.mock.calls[0]![0] as { diff: { antes: Record<string, unknown>; despues: Record<string, unknown> } }).diff;
    expect(diff.antes.remote_config).toEqual({ print: { copies: 1 }, futuro: true });
  });
});

describe('paginaPruebaBd', () => {
  it('crea un test_page pedido por el usuario si hay agente activo y nada pendiente', async () => {
    const { cliente, llamadas } = clienteFalso({
      'print_agents.select': { data: [{ id: ID }] },
      'print_jobs.select': { data: [] },
      'print_jobs.insert': { data: null },
    });
    const r = await paginaPruebaBd({ cliente, ...comun });
    expect(r.ok).toBe(true);
    expect(llamadas.find((l) => l.clave === 'print_jobs.insert')!.args[0]).toEqual({ type: 'test_page', status: 'queued', requested_by: 'admin:u1' });
  });

  it('sin agentes activos o con una prueba pendiente no crea nada', async () => {
    const sin = clienteFalso({ 'print_agents.select': { data: [] } });
    expect((await paginaPruebaBd({ cliente: sin.cliente, ...comun })).ok).toBe(false);
    const pendiente = clienteFalso({ 'print_agents.select': { data: [{ id: ID }] }, 'print_jobs.select': { data: [{ id: 'j' }] } });
    expect((await paginaPruebaBd({ cliente: pendiente.cliente, ...comun })).ok).toBe(false);
    expect([...sin.llamadas, ...pendiente.llamadas].some((l) => l.clave === 'print_jobs.insert')).toBe(false);
  });
});

describe('lecturas y estado', () => {
  it('listarAgentes nunca pide token_hash', async () => {
    const { cliente, llamadas } = clienteFalso({ 'print_agents.select': { data: [agente()] } });
    const l = await listarAgentes(cliente);
    expect(l[0]).not.toHaveProperty('token_hash');
    expect(String(llamadas[0]!.args[0])).not.toContain('token_hash');
  });

  it('estado de conexión por antigüedad del latido', () => {
    const ahora = new Date('2026-10-21T15:10:00Z');
    expect(estadoConexion(true, '2026-10-21T15:09:30Z', ahora)).toBe('en_linea');
    expect(estadoConexion(true, '2026-10-21T15:07:00Z', ahora)).toBe('retrasado');
    expect(estadoConexion(true, '2026-10-21T15:00:00Z', ahora)).toBe('sin_latido');
    expect(estadoConexion(true, null, ahora)).toBe('nunca');
    expect(estadoConexion(false, '2026-10-21T15:09:59Z', ahora)).toBe('desactivado');
    expect(conEstado([agente() as never], ahora)[0]!.conexion).toBe('sin_latido');
  });
});
