import 'server-only';
/**
 * Agentes de impresión desde el panel (§15, §24.1): alta con token que se muestra una sola vez, activar/desactivar,
 * rotar token, configuración remota y página de prueba. Regla: el token solo existe en claro dentro de la respuesta
 * de alta/rotación; en la base queda su sha256 (`hashTokenAgente`, la misma función con la que la API valida) y
 * nunca se lee `token_hash` para mostrarlo, ni se escribe el token en auditoría, eventos o registros.
 */
import { randomBytes } from 'node:crypto';
import { hashTokenAgente } from '@/app/api/agent/_lib/contrato';
import { auditarCambio } from '@/lib/admin/auditoria';
import type { Cliente } from '../catalogo/taxonomias-servidor';
import { diffCampos } from '../crud/comun';
import { esquemaNombreAgente, mezclarConfigRemota, type ConfigRemota, type ModoAgente } from './esquemas';
import { estadoConexion, type EstadoConexion } from './estado';

type Ctx = { cliente: Cliente; actor: string; ip: string | null };
export type ResultadoAgente<T extends object = object> = ({ ok: true; mensaje: string } & T) | { ok: false; mensaje: string };

/** 32 bytes aleatorios en base64url: 43 caracteres de `[A-Za-z0-9_-]`, el formato que acepta la API del agente. */
export function generarTokenAgente(): string {
  return randomBytes(32).toString('base64url');
}

export type AgentePublico = {
  id: string;
  name: string;
  is_active: boolean;
  mode: ModoAgente;
  version: string | null;
  printer_name: string | null;
  last_heartbeat_at: string | null;
  created_at: string;
  status_payload: Record<string, unknown>;
  remote_config: Record<string, unknown>;
};

/** Sin `token_hash`: lo único que sale del servidor hacia las páginas. */
const COLUMNAS_AGENTE = 'id, name, is_active, mode, version, printer_name, last_heartbeat_at, created_at, status_payload, remote_config';

function objeto(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function normalizar(f: Record<string, unknown>): AgentePublico {
  return {
    id: String(f.id),
    name: String(f.name),
    is_active: f.is_active === true,
    mode: f.mode === 'panel' ? 'panel' : 'api',
    version: typeof f.version === 'string' ? f.version : null,
    printer_name: typeof f.printer_name === 'string' ? f.printer_name : null,
    last_heartbeat_at: typeof f.last_heartbeat_at === 'string' ? f.last_heartbeat_at : null,
    created_at: String(f.created_at),
    status_payload: objeto(f.status_payload),
    remote_config: objeto(f.remote_config),
  };
}

export async function listarAgentes(cliente: Cliente): Promise<AgentePublico[]> {
  const { data, error } = await cliente.from('print_agents').select(COLUMNAS_AGENTE).order('created_at', { ascending: true });
  if (error) throw new Error('No se pudieron leer los agentes.');
  return ((data ?? []) as Record<string, unknown>[]).map(normalizar);
}

export async function obtenerAgente(cliente: Cliente, id: string): Promise<AgentePublico | null> {
  const { data, error } = await cliente.from('print_agents').select(COLUMNAS_AGENTE).eq('id', id).maybeSingle();
  if (error) throw new Error('No se pudo leer el agente.');
  return data ? normalizar(data as Record<string, unknown>) : null;
}

export type TrabajoCola = {
  id: string;
  order_id: string | null;
  type: string;
  status: string;
  attempts: number;
  error: string | null;
  requested_by: string;
  created_at: string;
  printed_at: string | null;
  orders: { number: string } | null;
};

export async function listarCola(cliente: Cliente, limite = 15): Promise<TrabajoCola[]> {
  const { data, error } = await cliente
    .from('print_jobs')
    .select('id, order_id, type, status, attempts, error, requested_by, created_at, printed_at, orders(number)')
    .order('created_at', { ascending: false })
    .limit(limite);
  if (error) throw new Error('No se pudo leer la cola de impresión.');
  return (data ?? []) as never;
}

export type VistaAgente = AgentePublico & { conexion: EstadoConexion };
export function conEstado(agentes: AgentePublico[], ahora: Date = new Date()): VistaAgente[] {
  return agentes.map((a) => ({ ...a, conexion: estadoConexion(a.is_active, a.last_heartbeat_at, ahora) }));
}

// ---------------------------------------------------------------------------
// Escrituras (solo administrador: `agente.gestionar`)
// ---------------------------------------------------------------------------

export async function crearAgenteBd(args: Ctx & { nombre: string; generar?: () => string }): Promise<ResultadoAgente<{ id: string; token: string }>> {
  const { cliente, actor, ip } = args;
  const nombre = esquemaNombreAgente.safeParse(args.nombre);
  if (!nombre.success) return { ok: false, mensaje: nombre.error.issues[0]?.message ?? 'Nombre no válido.' };
  const token = (args.generar ?? generarTokenAgente)();
  const { data, error } = await cliente
    .from('print_agents')
    .insert({ name: nombre.data, token_hash: hashTokenAgente(token) })
    .select('id')
    .single();
  if (error || !data) {
    console.error('[panel] no se pudo crear el agente:', error?.code ?? 'error');
    return { ok: false, mensaje: 'No se pudo crear el agente. Inténtalo de nuevo.' };
  }
  const id = String((data as { id: string }).id);
  await auditarCambio({ actor, accion: 'agente.creado', entidad: 'print_agents', entidadId: id, ip, diff: { nombre: nombre.data } });
  return { ok: true, id, token, mensaje: 'Agente creado. Copia el token ahora: no se vuelve a mostrar.' };
}

export async function rotarTokenBd(args: Ctx & { id: string; generar?: () => string }): Promise<ResultadoAgente<{ token: string }>> {
  const { cliente, actor, ip, id } = args;
  const agente = await obtenerAgente(cliente, id);
  if (!agente) return { ok: false, mensaje: 'Ese agente ya no existe.' };
  const token = (args.generar ?? generarTokenAgente)();
  const { error } = await cliente.from('print_agents').update({ token_hash: hashTokenAgente(token) }).eq('id', id);
  if (error) {
    console.error('[panel] no se pudo rotar el token:', error.code ?? 'error');
    return { ok: false, mensaje: 'No se pudo cambiar el token. El anterior sigue funcionando.' };
  }
  await auditarCambio({ actor, accion: 'agente.token_rotado', entidad: 'print_agents', entidadId: id, ip, diff: { nombre: agente.name } });
  return { ok: true, token, mensaje: 'Token nuevo generado. El anterior dejó de funcionar. Cópialo ahora: no se vuelve a mostrar.' };
}

export async function cambiarEstadoAgenteBd(args: Ctx & { id: string; activo: boolean }): Promise<ResultadoAgente> {
  const { cliente, actor, ip, id, activo } = args;
  const agente = await obtenerAgente(cliente, id);
  if (!agente) return { ok: false, mensaje: 'Ese agente ya no existe.' };
  if (agente.is_active === activo) return { ok: true, mensaje: activo ? 'El agente ya estaba activo.' : 'El agente ya estaba desactivado.' };
  const { error } = await cliente.from('print_agents').update({ is_active: activo }).eq('id', id);
  if (error) {
    console.error('[panel] no se pudo cambiar el estado del agente:', error.code ?? 'error');
    return { ok: false, mensaje: 'No se pudo cambiar el estado del agente. Inténtalo de nuevo.' };
  }
  await auditarCambio({
    actor,
    accion: activo ? 'agente.activado' : 'agente.desactivado',
    entidad: 'print_agents',
    entidadId: id,
    ip,
    diff: { nombre: agente.name, antes: { is_active: agente.is_active }, despues: { is_active: activo } },
  });
  return { ok: true, mensaje: activo ? 'Agente activado.' : 'Agente desactivado. Su token ya no se acepta.' };
}

export async function guardarConfigAgenteBd(args: Ctx & { id: string; modo: ModoAgente; config: ConfigRemota }): Promise<ResultadoAgente> {
  const { cliente, actor, ip, id } = args;
  const agente = await obtenerAgente(cliente, id);
  if (!agente) return { ok: false, mensaje: 'Ese agente ya no existe.' };
  const remota = mezclarConfigRemota(agente.remote_config, args.config);
  const { error } = await cliente.from('print_agents').update({ mode: args.modo, remote_config: remota }).eq('id', id);
  if (error) {
    console.error('[panel] no se pudo guardar la configuración del agente:', error.code ?? 'error');
    return { ok: false, mensaje: 'No se pudo guardar la configuración. Inténtalo de nuevo.' };
  }
  await auditarCambio({
    actor,
    accion: 'agente.configuracion_guardada',
    entidad: 'print_agents',
    entidadId: id,
    ip,
    diff: diffCampos({ mode: agente.mode, remote_config: agente.remote_config }, { mode: args.modo, remote_config: remota }),
  });
  return { ok: true, mensaje: 'Configuración guardada. El agente la toma en su próximo latido (unos segundos).' };
}

/** Página de prueba (`agente.pagina_prueba`, también del operador): un trabajo `test_page` pedido por quien la solicita. */
export async function paginaPruebaBd(args: Ctx): Promise<ResultadoAgente> {
  const { cliente, actor, ip } = args;
  const { data: activos, error: e1 } = await cliente.from('print_agents').select('id').eq('is_active', true).limit(1);
  if (e1) return { ok: false, mensaje: 'No se pudo verificar los agentes. Inténtalo de nuevo.' };
  if (!Array.isArray(activos) || activos.length === 0) return { ok: false, mensaje: 'No hay ningún agente activo para imprimir la página de prueba.' };
  const { data: pendientes, error: e2 } = await cliente
    .from('print_jobs')
    .select('id')
    .eq('type', 'test_page')
    .in('status', ['queued', 'claimed'])
    .limit(1);
  if (e2) return { ok: false, mensaje: 'No se pudo verificar la cola. Inténtalo de nuevo.' };
  if (Array.isArray(pendientes) && pendientes.length > 0) return { ok: false, mensaje: 'Ya hay una página de prueba en cola. Espera a que se imprima.' };
  const { error } = await cliente.from('print_jobs').insert({ type: 'test_page', status: 'queued', requested_by: `admin:${actor}` });
  if (error) {
    console.error('[panel] no se pudo crear la página de prueba:', error.code ?? 'error');
    return { ok: false, mensaje: 'No se pudo poner la página de prueba en cola. Inténtalo de nuevo.' };
  }
  await auditarCambio({ actor, accion: 'agente.pagina_prueba', entidad: 'print_jobs', ip, diff: {} });
  return { ok: true, mensaje: 'Página de prueba en cola. Debe salir por la impresora en unos segundos.' };
}
