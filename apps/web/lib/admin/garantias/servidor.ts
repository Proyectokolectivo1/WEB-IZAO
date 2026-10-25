import 'server-only';
/**
 * Garantías (§19) con el cliente de servicio: bandeja con filtros, detalle con pedido y fotos, gestión de un caso
 * (estado, solución, costo asumido, notas e historial) y ajustes por país. Toda escritura se audita; el cambio de
 * un caso es una sola sentencia `update` (atómica) condicionada a la versión leída, para no pisar a otra persona.
 */
import { inicioDiaBogotaUtc, sumarDias } from '@izao/core/metrics';
import { auditarCambio } from '@/lib/admin/auditoria';
import type { Cliente } from '../catalogo/taxonomias-servidor';
import { diffCampos, escaparBusqueda, rangoPagina, type ResultadoAccion } from '../crud/comun';
import { invalidarContenido, traducirErrorBd } from '../crud/servidor';
import {
  ESTADOS_GARANTIA,
  estaVencida,
  interpretarBusquedaGarantia,
  leerHistorial,
  limiteRespuesta,
  transicionPermitida,
  ETIQUETA_ESTADO_GARANTIA,
  type DatosAjustesGarantia,
  type DatosGestion,
  type EntradaHistorial,
  type EstadoGarantia,
  type FiltrosGarantia,
} from './garantias';

type Ctx = { cliente: Cliente; actor: string; ip: string | null };
type Monto = number | string | bigint;

export type FilaGarantia = {
  id: string;
  number: string;
  country_code: 'CO' | 'EC';
  customer_name: string;
  phone: string;
  reason: string;
  status: EstadoGarantia;
  resolution: string | null;
  cost_amount: Monto;
  created_at: string;
  resolved_at: string | null;
  order_id: string | null;
  /** Plazo de respuesta vencido (solo casos abiertos). */
  vencida: boolean;
};

const COLUMNAS_LISTA =
  'id, number, country_code, customer_name, phone, reason, status, resolution, cost_amount, created_at, resolved_at, order_id';

const DIAS_RESPUESTA_POR_DEFECTO = 5;

/** Días de respuesta por país (`warranty_settings.response_days`); el valor por defecto de la tabla es 5. */
export async function diasRespuestaPorPais(cliente: Cliente): Promise<Record<'CO' | 'EC', number>> {
  const { data, error } = await cliente.from('warranty_settings').select('country_code, response_days');
  if (error) throw new Error(`No se pudieron leer los ajustes de garantías: ${error.message}`);
  const salida = { CO: DIAS_RESPUESTA_POR_DEFECTO, EC: DIAS_RESPUESTA_POR_DEFECTO };
  for (const f of (data ?? []) as { country_code: 'CO' | 'EC'; response_days: number }[]) {
    if (f.country_code in salida) salida[f.country_code] = f.response_days;
  }
  return salida;
}

export async function listarGarantias(
  cliente: Cliente,
  f: FiltrosGarantia,
  ahora: Date = new Date(),
): Promise<{ filas: FilaGarantia[]; total: number }> {
  const dias = await diasRespuestaPorPais(cliente);
  let consulta = cliente.from('warranty_claims').select(COLUMNAS_LISTA, { count: 'exact' });
  const busqueda = interpretarBusquedaGarantia(f.q);
  if (busqueda) consulta = consulta.ilike(busqueda.campo, `%${escaparBusqueda(busqueda.patron)}%`);
  if (f.estado) consulta = consulta.eq('status', f.estado);
  if (f.pais) consulta = consulta.eq('country_code', f.pais);
  if (f.desde) consulta = consulta.gte('created_at', inicioDiaBogotaUtc(f.desde).toISOString());
  if (f.hasta) consulta = consulta.lt('created_at', inicioDiaBogotaUtc(sumarDias(f.hasta, 1)).toISOString());
  if (f.vencidas) {
    // Abiertas con más antigüedad que los días de respuesta de su país.
    const limite = (pais: 'CO' | 'EC') => {
      const d = new Date(ahora);
      d.setUTCDate(d.getUTCDate() - dias[pais]);
      return d.toISOString();
    };
    consulta = consulta
      .in('status', ['recibida', 'en_revision'])
      .or(`and(country_code.eq.CO,created_at.lt.${limite('CO')}),and(country_code.eq.EC,created_at.lt.${limite('EC')})`);
  }
  const [desde, hasta] = rangoPagina(f.pagina);
  const { data, error, count } = await consulta.order('created_at', { ascending: false }).range(desde, hasta);
  if (error) throw new Error(`No se pudieron listar las garantías: ${error.message}`);
  const filas = ((data ?? []) as unknown as Omit<FilaGarantia, 'vencida'>[]).map((g) => ({
    ...g,
    vencida: estaVencida(g.status, g.created_at, dias[g.country_code] ?? DIAS_RESPUESTA_POR_DEFECTO, ahora),
  }));
  return { filas, total: count ?? 0 };
}

/** Casos por estado (para las pestañas de la bandeja), respetando el filtro de país. */
export async function contarPorEstado(cliente: Cliente, pais: 'CO' | 'EC' | ''): Promise<Record<EstadoGarantia, number>> {
  const cuentas = await Promise.all(
    ESTADOS_GARANTIA.map(async (estado) => {
      let q = cliente.from('warranty_claims').select('id', { count: 'exact', head: true }).eq('status', estado);
      if (pais) q = q.eq('country_code', pais);
      const { count, error } = await q;
      if (error) throw new Error(`No se pudieron contar las garantías: ${error.message}`);
      return [estado, count ?? 0] as const;
    }),
  );
  return Object.fromEntries(cuentas) as Record<EstadoGarantia, number>;
}

export type AdjuntoGarantia = {
  id: string;
  tipo: 'foto' | 'video';
  alt: string;
  /** Variante para la miniatura / vista grande (`video` para el video). */
  miniatura: string;
  grande: string;
};

/** Fila de `media` → adjunto. Un video lleva `variants.video`; una foto, anchos numéricos (400, 800…). */
export function aAdjunto(m: { id: string; variants: Record<string, string> | null; alt: string | null; original_name: string | null }): AdjuntoGarantia | null {
  const v = m.variants ?? {};
  if (typeof v.video === 'string' && v.video !== '') {
    return { id: m.id, tipo: 'video', alt: m.alt ?? 'Video del caso', miniatura: 'video', grande: 'video' };
  }
  const anchos = Object.keys(v).filter((k) => /^\d{2,4}$/.test(k)).sort((a, b) => Number(a) - Number(b));
  if (anchos.length === 0) return null;
  return { id: m.id, tipo: 'foto', alt: m.alt ?? m.original_name ?? 'Foto del caso', miniatura: v['400'] ? '400' : anchos[0]!, grande: anchos[anchos.length - 1]! };
}

export type DetalleGarantia = {
  caso: {
    id: string;
    number: string;
    country_code: 'CO' | 'EC';
    customer_name: string;
    phone: string;
    email: string | null;
    reason: string;
    description: string | null;
    status: EstadoGarantia;
    resolution: string | null;
    cost_amount: Monto;
    admin_notes: string | null;
    resolved_at: string | null;
    created_at: string;
    updated_at: string;
    order_id: string | null;
  };
  pedido: { id: string; number: string; status: string; delivered_at: string | null } | null;
  historial: EntradaHistorial[];
  /** Fotos y video del caso, en orden. Se sirven por una ruta protegida del panel, no por `/media`. */
  adjuntos: AdjuntoGarantia[];
  /** Fecha límite de respuesta y si ya pasó (solo casos abiertos). */
  limite: { fecha: string; vencida: boolean };
};

const COLUMNAS_DETALLE =
  'id, number, country_code, customer_name, phone, email, reason, description, status, resolution, cost_amount, admin_notes, status_history, media_ids, resolved_at, created_at, updated_at, order_id';

export async function obtenerGarantia(cliente: Cliente, id: string, ahora: Date = new Date()): Promise<DetalleGarantia | null> {
  const { data, error } = await cliente.from('warranty_claims').select(COLUMNAS_DETALLE).eq('id', id).maybeSingle();
  if (error) throw new Error(`No se pudo leer la garantía: ${error.message}`);
  if (!data) return null;
  const fila = data as unknown as DetalleGarantia['caso'] & { status_history: unknown; media_ids: string[] | null };
  const ids = (fila.media_ids ?? []).slice(0, 10);
  const [pedido, media, dias] = await Promise.all([
    fila.order_id
      ? cliente.from('orders').select('id, number, status, delivered_at').eq('id', fila.order_id).maybeSingle()
      : Promise.resolve({ data: null }),
    ids.length ? cliente.from('media').select('id, variants, alt, original_name').in('id', ids) : Promise.resolve({ data: [] }),
    diasRespuestaPorPais(cliente),
  ]);
  const filasMedia = new Map(
    ((media.data ?? []) as { id: string; variants: Record<string, string> | null; alt: string | null; original_name: string | null }[]).map((m) => [m.id, m]),
  );
  // En el orden en que el cliente los subió; cada archivo se pide por `/api/admin/garantias/archivo/{id}` (solo con sesión).
  const adjuntos = ids.map((id) => filasMedia.get(id)).filter((m): m is NonNullable<typeof m> => m !== undefined).map(aAdjunto).filter((x): x is AdjuntoGarantia => x !== null);
  const { status_history, media_ids: _media, ...caso } = fila;
  void _media;
  const limite = limiteRespuesta(fila.created_at, dias[fila.country_code] ?? DIAS_RESPUESTA_POR_DEFECTO);
  return {
    caso,
    pedido: (pedido.data as DetalleGarantia['pedido']) ?? null,
    historial: leerHistorial(status_history),
    adjuntos,
    limite: { fecha: limite.toISOString(), vencida: estaVencida(fila.status, fila.created_at, dias[fila.country_code] ?? DIAS_RESPUESTA_POR_DEFECTO, ahora) },
  };
}

/**
 * Cambia estado, solución, costo y notas de un caso. Valida el flujo de estados, anota el cambio en el historial
 * y audita el diff. La actualización exige que nadie haya tocado el caso desde que se leyó.
 */
export async function gestionarGarantiaBd(args: Ctx & { datos: DatosGestion; ahora?: Date }): Promise<ResultadoAccion> {
  const { cliente, datos, actor, ip } = args;
  const ahora = args.ahora ?? new Date();
  const { data: antes, error: errLectura } = await cliente.from('warranty_claims').select('*').eq('id', datos.id).maybeSingle();
  if (errLectura) return { ok: false, ...traducirErrorBd(errLectura) };
  if (!antes) return { ok: false, mensaje: 'Este caso ya no existe.' };
  const previo = antes as Record<string, unknown> & { status: EstadoGarantia; updated_at: string; country_code: 'CO' | 'EC' };

  if (!transicionPermitida(previo.status, datos.status)) {
    return {
      ok: false,
      mensaje: `Un caso «${ETIQUETA_ESTADO_GARANTIA[previo.status]}» no pasa directamente a «${ETIQUETA_ESTADO_GARANTIA[datos.status]}».`,
      errores: { status: 'Ese cambio de estado no está permitido.' },
    };
  }

  const cambioEstado = previo.status !== datos.status;
  const historial = leerHistorial(previo.status_history);
  if (cambioEstado || datos.nota_historial) {
    historial.push({ at: ahora.toISOString(), actor, from: previo.status, to: datos.status, nota: datos.nota_historial });
  }
  const fila = {
    status: datos.status,
    resolution: datos.resolution,
    cost_amount: datos.cost_amount.toString(),
    admin_notes: datos.admin_notes,
    status_history: historial,
    resolved_at: datos.status === 'resuelta' ? (cambioEstado ? ahora.toISOString() : ((previo.resolved_at as string | null) ?? ahora.toISOString())) : null,
  };
  const { data: actualizado, error } = await cliente
    .from('warranty_claims')
    .update(fila)
    .eq('id', datos.id)
    .eq('updated_at', previo.updated_at)
    .select('id');
  if (error) return { ok: false, ...traducirErrorBd(error) };
  if (!actualizado || (actualizado as unknown[]).length === 0) {
    return { ok: false, mensaje: 'Alguien más modificó este caso mientras lo editabas. Recarga la página y vuelve a intentarlo.' };
  }
  await auditarCambio({
    actor,
    accion: cambioEstado ? 'garantias.estado_cambiado' : 'garantias.actualizada',
    entidad: 'warranty_claims',
    entidadId: datos.id,
    // El historial ya queda dentro de la fila; el diff solo lleva lo que cambió en los campos editables.
    diff: diffCampos(previo, { status: fila.status, resolution: fila.resolution, cost_amount: fila.cost_amount, admin_notes: fila.admin_notes, resolved_at: fila.resolved_at }),
    ip,
  });
  return { ok: true, id: datos.id };
}

// ── Ajustes por país ─────────────────────────────────────────────────────────────────────────────

export type AjustesGarantia = {
  country_code: 'CO' | 'EC';
  period_days: number;
  response_days: number;
  reasons: string[];
  instructions_html: string;
  conditions_html: string;
};

export async function leerAjustesGarantia(cliente: Cliente, pais: 'CO' | 'EC'): Promise<AjustesGarantia | null> {
  const { data, error } = await cliente
    .from('warranty_settings')
    .select('country_code, period_days, response_days, reasons, instructions_html, conditions_html')
    .eq('country_code', pais)
    .maybeSingle();
  if (error) throw new Error(`No se pudieron leer los ajustes de garantías: ${error.message}`);
  return (data as unknown as AjustesGarantia | null) ?? null;
}

export async function guardarAjustesGarantiaBd(args: Ctx & { datos: DatosAjustesGarantia }): Promise<ResultadoAccion> {
  const { cliente, datos, actor, ip } = args;
  const fila = {
    country_code: datos.country_code,
    period_days: datos.period_days,
    response_days: datos.response_days,
    reasons: datos.reasons,
    instructions_html: datos.instructions_html,
    conditions_html: datos.conditions_html,
  };
  const { data: antes } = await cliente.from('warranty_settings').select('*').eq('country_code', datos.country_code).maybeSingle();
  const { error } = await cliente.from('warranty_settings').upsert(fila, { onConflict: 'country_code' });
  if (error) return { ok: false, ...traducirErrorBd(error) };
  await auditarCambio({
    actor,
    accion: 'garantias.ajustes_guardados',
    entidad: 'warranty_settings',
    entidadId: datos.country_code,
    diff: antes ? diffCampos(antes as Record<string, unknown>, fila) : { despues: fila },
    ip,
  });
  // La página pública /{pais}/garantias lee los motivos y textos con la etiqueta de contenido del país.
  invalidarContenido([datos.country_code]);
  return { ok: true, id: datos.country_code };
}
