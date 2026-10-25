import 'server-only';
/**
 * Influencers (§17.2) con el cliente de servicio: fichas, códigos asociados y reporte por rango de fechas. La
 * atribución de fecha es la de §21.1 (`paid_at`, o `created_at` si no se ha pagado) en hora de Bogotá.
 */
import { auditarCambio } from '@/lib/admin/auditoria';
import { inicioDiaBogotaUtc, sumarDias, type FechaIso } from '@izao/core/metrics';
import type { Cliente } from '../catalogo/taxonomias-servidor';
import { diffCampos, escaparBusqueda, rangoPagina, type ResultadoAccion } from '../crud/comun';
import { traducirErrorBd } from '../crud/servidor';
import { COLUMNAS_PEDIDO_METRICA, aPedidoMetrica, type FilaPedidoMetrica } from '../metricas/pedidos';
import {
  centesimasATexto,
  reportePorInfluencer,
  type DatosInfluencer,
  type FilaReporteInfluencer,
  type PedidoInfluencer,
} from './influencers';

type Ctx = { cliente: Cliente; actor: string; ip: string | null };

export type FilaInfluencer = {
  id: string;
  name: string;
  handle: string | null;
  country_code: 'CO' | 'EC';
  phone: string | null;
  email: string | null;
  commission_pct: number | string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
};

export type CodigoDeInfluencer = { id: string; code: string; is_active: boolean; usage_count: number };

const COLUMNAS = 'id, name, handle, country_code, phone, email, commission_pct, notes, is_active, created_at';

export async function listarInfluencers(
  cliente: Cliente,
  f: { pais: 'CO' | 'EC'; q: string; pagina: number },
): Promise<{ filas: FilaInfluencer[]; total: number; codigos: Map<string, CodigoDeInfluencer[]> }> {
  let q = cliente.from('influencers').select(COLUMNAS, { count: 'exact' }).eq('country_code', f.pais);
  if (f.q) q = q.ilike('name', `%${escaparBusqueda(f.q)}%`);
  const [desde, hasta] = rangoPagina(f.pagina);
  const { data, error, count } = await q.order('name', { ascending: true }).range(desde, hasta);
  if (error) throw new Error(`No se pudieron listar los influencers: ${error.message}`);
  const filas = (data ?? []) as unknown as FilaInfluencer[];
  const codigos = await codigosPorInfluencer(cliente, filas.map((i) => i.id));
  return { filas, total: count ?? 0, codigos };
}

export async function codigosPorInfluencer(cliente: Cliente, ids: readonly string[]): Promise<Map<string, CodigoDeInfluencer[]>> {
  const salida = new Map<string, CodigoDeInfluencer[]>();
  if (ids.length === 0) return salida;
  const { data } = await cliente
    .from('discount_codes')
    .select('id, code, is_active, usage_count, influencer_id')
    .in('influencer_id', [...ids])
    .order('code', { ascending: true });
  for (const c of (data ?? []) as (CodigoDeInfluencer & { influencer_id: string })[]) {
    const lista = salida.get(c.influencer_id) ?? [];
    lista.push({ id: c.id, code: c.code, is_active: c.is_active, usage_count: c.usage_count });
    salida.set(c.influencer_id, lista);
  }
  return salida;
}

export async function obtenerInfluencer(cliente: Cliente, id: string): Promise<FilaInfluencer | null> {
  const { data, error } = await cliente.from('influencers').select(COLUMNAS).eq('id', id).maybeSingle();
  if (error) throw new Error(`No se pudo leer el influencer: ${error.message}`);
  return (data as unknown as FilaInfluencer | null) ?? null;
}

function columnas(d: DatosInfluencer): Record<string, unknown> {
  return {
    name: d.name,
    handle: d.handle,
    country_code: d.country_code,
    phone: d.phone,
    email: d.email,
    commission_pct: d.commission_hundredths === null ? null : centesimasATexto(d.commission_hundredths),
    notes: d.notes,
    is_active: d.is_active,
  };
}

export async function guardarInfluencerBd(args: Ctx & { datos: DatosInfluencer }): Promise<ResultadoAccion> {
  const { cliente, datos, actor, ip } = args;
  const fila = columnas(datos);
  if (datos.id) {
    const { data: antes } = await cliente.from('influencers').select('*').eq('id', datos.id).maybeSingle();
    if (!antes) return { ok: false, mensaje: 'Ese influencer ya no existe.' };
    const previo = antes as Record<string, unknown>;
    if (previo.country_code !== datos.country_code) {
      // Los códigos asociados deben seguir siendo del mismo país que su influencer.
      const { count } = await cliente
        .from('discount_codes')
        .select('id', { count: 'exact', head: true })
        .eq('influencer_id', datos.id);
      if ((count ?? 0) > 0) {
        return {
          ok: false,
          mensaje: 'Este influencer tiene códigos asociados: no se puede cambiar de país.',
          errores: { country_code: 'Tiene códigos asociados.' },
        };
      }
    }
    const { error } = await cliente.from('influencers').update(fila).eq('id', datos.id);
    if (error) return { ok: false, ...traducirErrorBd(error) };
    await auditarCambio({
      actor,
      accion: 'influencers.actualizado',
      entidad: 'influencers',
      entidadId: datos.id,
      diff: diffCampos(previo, fila),
      ip,
    });
    return { ok: true, id: datos.id };
  }
  const { data, error } = await cliente.from('influencers').insert(fila).select('id').single();
  if (error) return { ok: false, ...traducirErrorBd(error) };
  await auditarCambio({ actor, accion: 'influencers.creado', entidad: 'influencers', entidadId: data.id, diff: { despues: fila }, ip });
  return { ok: true, id: data.id as string };
}

/** Con pedidos atribuidos no se borra (se perdería la atribución histórica): se desactiva. */
export async function eliminarInfluencerBd(args: Ctx & { id: string }): Promise<ResultadoAccion> {
  const { cliente, id, actor, ip } = args;
  const { data: antes } = await cliente.from('influencers').select('*').eq('id', id).maybeSingle();
  if (!antes) return { ok: true };
  const { count } = await cliente.from('orders').select('id', { count: 'exact', head: true }).eq('influencer_id', id);
  if ((count ?? 0) > 0) {
    return { ok: false, mensaje: 'Este influencer tiene pedidos atribuidos: no se puede eliminar. Desactívalo.' };
  }
  const { error } = await cliente.from('influencers').delete().eq('id', id);
  if (error) return { ok: false, ...traducirErrorBd(error) };
  // Los códigos asociados quedan sin influencer (FK `on delete set null`); se deja constancia.
  await auditarCambio({ actor, accion: 'influencers.eliminado', entidad: 'influencers', entidadId: id, diff: { antes }, ip });
  return { ok: true };
}

export type ReporteInfluencers = {
  filas: (FilaReporteInfluencer & { nombre: string; handle: string | null; comisionPct: string | null })[];
  /** Pedidos que se descartaron por método o estado desconocido. */
  descartados: number;
};

/**
 * Reporte por influencer en `[desde, hasta]` (días de Bogotá, ambos incluidos). Pedidos atribuidos por
 * `paid_at`, o `created_at` si no se han pagado (§21.1).
 */
export async function reporteInfluencers(
  cliente: Cliente,
  f: { pais: 'CO' | 'EC'; desde: FechaIso; hasta: FechaIso },
): Promise<ReporteInfluencers> {
  const ini = inicioDiaBogotaUtc(f.desde).toISOString();
  const fin = inicioDiaBogotaUtc(sumarDias(f.hasta, 1)).toISOString();

  const [pagados, sinPagar, ajustes] = await Promise.all([
    cliente
      .from('orders')
      .select(COLUMNAS_PEDIDO_METRICA)
      .eq('country_code', f.pais)
      .not('influencer_id', 'is', null)
      .gte('paid_at', ini)
      .lt('paid_at', fin)
      .limit(20000),
    cliente
      .from('orders')
      .select(COLUMNAS_PEDIDO_METRICA)
      .eq('country_code', f.pais)
      .not('influencer_id', 'is', null)
      .is('paid_at', null)
      .gte('created_at', ini)
      .lt('created_at', fin)
      .limit(20000),
    cliente.from('country_settings').select('shipping_cost_estimate').eq('country_code', f.pais).maybeSingle(),
  ]);
  if (pagados.error) throw new Error(`No se pudo leer el reporte: ${pagados.error.message}`);
  if (sinPagar.error) throw new Error(`No se pudo leer el reporte: ${sinPagar.error.message}`);
  const estimado = (ajustes.data as { shipping_cost_estimate: number | string } | null)?.shipping_cost_estimate ?? 0;

  const filas = [...((pagados.data ?? []) as unknown as FilaPedidoMetrica[]), ...((sinPagar.data ?? []) as unknown as FilaPedidoMetrica[])];
  const pedidos: PedidoInfluencer[] = [];
  let descartados = 0;
  for (const fila of filas) {
    const pedido = aPedidoMetrica(fila, { envioEstimadoPais: estimado });
    if (!pedido || !fila.influencer_id) {
      descartados += 1;
      continue;
    }
    pedidos.push({ influencerId: fila.influencer_id, pedido });
  }

  const ids = [...new Set(pedidos.map((p) => p.influencerId))];
  const { data: fichas } = ids.length
    ? await cliente.from('influencers').select('id, name, handle, commission_pct').in('id', ids)
    : { data: [] };
  const lista = (fichas ?? []) as { id: string; name: string; handle: string | null; commission_pct: number | string | null }[];
  const comisiones = new Map(
    lista.map((i) => [i.id, i.commission_pct === null ? null : Math.round(Number(i.commission_pct) * 100)] as const),
  );
  const porId = new Map(lista.map((i) => [i.id, i]));
  const agregadas = reportePorInfluencer(pedidos, comisiones);
  return {
    descartados,
    filas: agregadas.map((r) => {
      const i = porId.get(r.influencerId);
      const c = comisiones.get(r.influencerId) ?? null;
      return { ...r, nombre: i?.name ?? '(eliminado)', handle: i?.handle ?? null, comisionPct: c === null ? null : centesimasATexto(c) };
    }),
  };
}
