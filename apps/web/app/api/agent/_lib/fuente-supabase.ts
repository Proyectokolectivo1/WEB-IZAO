/**
 * `FuenteAgente` contra Supabase con la llave de servidor y disco de `MEDIA_ROOT` (SOLO SERVIDOR).
 * El reclamo es un UPDATE condicionado al estado (`queued`, o `claimed` vencido): PostgREST no expone
 * `FOR UPDATE SKIP LOCKED`, y la condición en el WHERE basta para que dos agentes no se lleven la misma fila
 * (D-027).
 */
import 'server-only';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { clienteDb } from '@/lib/db/cliente';
import type { TrabajoFila } from './contrato';
import type { AgenteFila, DepsAgente, FuenteAgente } from './manejar';

const COLUMNAS = 'id,type,status,order_id,shipment_id,claimed_by_agent,claimed_at,attempts,requested_by,created_at,orders(number)';

type Fila = Record<string, unknown>;

function aTrabajo(r: Fila): TrabajoFila {
  const orden = r.orders as { number?: unknown } | null;
  return {
    id: String(r.id),
    type: r.type as TrabajoFila['type'],
    status: r.status as TrabajoFila['status'],
    order_id: typeof r.order_id === 'string' ? r.order_id : null,
    shipment_id: typeof r.shipment_id === 'string' ? r.shipment_id : null,
    order_number: typeof orden?.number === 'string' ? orden.number : null,
    claimed_by_agent: typeof r.claimed_by_agent === 'string' ? r.claimed_by_agent : null,
    claimed_at: typeof r.claimed_at === 'string' ? r.claimed_at : null,
    attempts: typeof r.attempts === 'number' ? r.attempts : 0,
    requested_by: String(r.requested_by),
    created_at: String(r.created_at),
  };
}

function fallo(op: string, e: { code?: string } | null): never {
  throw new Error(`${op}: ${e?.code ?? 'error'}`);
}

const disponibles = (vencidoAntes: Date) => `status.eq.queued,and(status.eq.claimed,claimed_at.lt."${vencidoAntes.toISOString()}")`;

export function fuenteAgenteSupabase(): FuenteAgente {
  const db = () => clienteDb();
  // Columnas que aún no están en los tipos generados (`remote_config`) se leen con `*`.
  const tabla = (t: string) => db().from(t as never) as unknown as ReturnType<ReturnType<typeof clienteDb>['from']>;
  return {
    async agentePorHash(hash) {
      const { data, error } = await tabla('print_agents').select('*').eq('token_hash', hash).eq('is_active', true).maybeSingle();
      if (error) fallo('print_agents', error);
      if (!data) return null;
      const r = data as Fila;
      const remota = r.remote_config;
      return {
        id: String(r.id),
        name: String(r.name),
        mode: r.mode === 'panel' ? 'panel' : 'api',
        remote_config: typeof remota === 'object' && remota !== null && !Array.isArray(remota) ? (remota as Record<string, unknown>) : {},
      } satisfies AgenteFila;
    },
    async guardarLatido(agenteId, d, ahora) {
      const { error } = await tabla('print_agents')
        .update({ last_heartbeat_at: ahora.toISOString(), version: d.version, printer_name: d.printer_name, status_payload: d.status_payload } as never)
        .eq('id', agenteId);
      if (error) fallo('print_agents', error);
    },
    async reclamadosPor(agenteId, max) {
      const { data, error } = await tabla('print_jobs')
        .select(COLUMNAS)
        .eq('status', 'claimed')
        .eq('claimed_by_agent', agenteId)
        .order('created_at', { ascending: true })
        .limit(max);
      if (error) fallo('print_jobs', error);
      return ((data ?? []) as unknown as Fila[]).map(aTrabajo);
    },
    async candidatos(agenteId, max, vencidoAntes) {
      const { data, error } = await tabla('print_jobs')
        .select('id,claimed_by_agent')
        .or(disponibles(vencidoAntes))
        .order('created_at', { ascending: true })
        .limit(max + 5);
      if (error) fallo('print_jobs', error);
      return ((data ?? []) as unknown as Fila[])
        .filter((r) => r.claimed_by_agent !== agenteId)
        .slice(0, max)
        .map((r) => String(r.id));
    },
    async reclamar(ids, agenteId, ahora, vencidoAntes) {
      const { data, error } = await tabla('print_jobs')
        .update({ status: 'claimed', claimed_by_agent: agenteId, claimed_at: ahora.toISOString() } as never)
        .in('id', [...ids])
        .or(disponibles(vencidoAntes))
        .select(COLUMNAS);
      if (error) fallo('print_jobs', error);
      return ((data ?? []) as unknown as Fila[]).map(aTrabajo).sort((a, b) => a.created_at.localeCompare(b.created_at));
    },
    async trabajo(id) {
      const { data, error } = await tabla('print_jobs').select(COLUMNAS).eq('id', id).maybeSingle();
      if (error) fallo('print_jobs', error);
      return data ? aTrabajo(data as unknown as Fila) : null;
    },
    async cerrar(id, agenteId, c) {
      const { data, error } = await tabla('print_jobs')
        .update(c as never)
        .eq('id', id)
        .eq('status', 'claimed')
        .eq('claimed_by_agent', agenteId)
        .select('id');
      if (error) fallo('print_jobs', error);
      return (data ?? []).length === 1;
    },
    async rutaEtiqueta(shipmentId) {
      const { data, error } = await tabla('shipments').select('label_local_path').eq('id', shipmentId).maybeSingle();
      if (error) fallo('shipments', error);
      const v = (data as Fila | null)?.label_local_path;
      return typeof v === 'string' ? v : null;
    },
    async alertaPedido(orderId, payload) {
      const { error } = await tabla('order_events').insert({ order_id: orderId, type: 'alerta', actor: 'agent', payload } as never);
      if (error) fallo('order_events', error);
    },
  };
}

const NOMBRE_CAPTURA = /^[0-9a-f-]{36}-\d{1,16}\.png$/;

export function depsAgenteDesdeEnv(env: NodeJS.ProcessEnv = process.env): DepsAgente {
  const mediaRoot = path.resolve(env.MEDIA_ROOT ?? '/srv/izao/media');
  return {
    fuente: fuenteAgenteSupabase(),
    mediaRoot,
    async leerArchivo(abs) {
      try {
        return new Uint8Array(await readFile(abs));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw e;
      }
    },
    async guardarCaptura(nombre, bytes) {
      if (!NOMBRE_CAPTURA.test(nombre)) throw new Error('nombre de captura inválido');
      const dir = path.join(mediaRoot, 'agent-screenshots');
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, nombre), bytes, { flag: 'wx' });
      return `agent-screenshots/${nombre}`;
    },
  };
}
