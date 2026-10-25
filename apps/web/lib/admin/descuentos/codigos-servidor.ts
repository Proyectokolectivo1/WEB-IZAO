import 'server-only';
/**
 * Códigos de descuento y lotes (§17.1) con el cliente de servicio. Cada escritura valida las referencias
 * (productos por URL, categorías, influencer del mismo país), se audita con el diff y devuelve errores por campo.
 * El uso (`usage_count`, canje y liberación) lo maneja la base; aquí solo se lee para el reporte.
 */
import { auditarCambio } from '@/lib/admin/auditoria';
import { fromDbAmount } from '@izao/core/money';
import type { Cliente } from '../catalogo/taxonomias-servidor';
import { diffCampos, escaparBusqueda, rangoPagina, TAMANO_PAGINA, type ResultadoAccion } from '../crud/comun';
import { traducirErrorBd } from '../crud/servidor';
import {
  generarCodigosLote,
  type DatosCodigo,
  type DatosLote,
  type DatosRegla,
  type FiltrosCodigos,
  type FilaCodigo,
} from './codigos';

type Ctx = { cliente: Cliente; actor: string; ip: string | null };

export const COLUMNAS_CODIGO =
  'id, code, country_code, type, value, max_discount_amount, min_subtotal, starts_at, ends_at, usage_limit_total, usage_limit_per_customer, usage_count, applies_to, target_ids, exclude_ids, applies_to_sale_items, influencer_id, origin, iza_can_offer, is_active, created_at';

export type OpcionCategoria = { id: string; name: string; parent_id: string | null };
export type OpcionInfluencer = { id: string; name: string; handle: string | null; country_code: 'CO' | 'EC'; is_active: boolean };

// ── Lectura ──────────────────────────────────────────────────────────────────────────────────────

export async function listarCodigos(
  cliente: Cliente,
  f: FiltrosCodigos,
  ahora: Date,
): Promise<{ filas: FilaCodigo[]; total: number }> {
  let q = cliente.from('discount_codes').select(COLUMNAS_CODIGO, { count: 'exact' }).eq('country_code', f.pais);
  if (f.origen) q = q.eq('origin', f.origen);
  if (f.q) q = q.ilike('code', `%${escaparBusqueda(f.q)}%`);
  const iso = ahora.toISOString();
  if (f.estado === 'inactivo') q = q.eq('is_active', false);
  else if (f.estado === 'vencido') q = q.eq('is_active', true).lte('ends_at', iso);
  else if (f.estado === 'programado') q = q.eq('is_active', true).gt('starts_at', iso);
  const [desde, hasta] = rangoPagina(f.pagina);
  const { data, error, count } = await q.order('created_at', { ascending: false }).range(desde, hasta);
  if (error) throw new Error(`No se pudieron listar los códigos: ${error.message}`);
  return { filas: (data ?? []) as unknown as FilaCodigo[], total: count ?? 0 };
}

export async function obtenerCodigo(cliente: Cliente, id: string): Promise<FilaCodigo | null> {
  const { data, error } = await cliente.from('discount_codes').select(COLUMNAS_CODIGO).eq('id', id).maybeSingle();
  if (error) throw new Error(`No se pudo leer el código: ${error.message}`);
  return (data as unknown as FilaCodigo | null) ?? null;
}

export async function listarCategoriasOpciones(cliente: Cliente): Promise<OpcionCategoria[]> {
  const { data } = await cliente.from('categories').select('id, name, parent_id').order('name', { ascending: true });
  return (data ?? []) as OpcionCategoria[];
}

export async function listarInfluencersOpciones(cliente: Cliente): Promise<OpcionInfluencer[]> {
  const { data } = await cliente
    .from('influencers')
    .select('id, name, handle, country_code, is_active')
    .order('name', { ascending: true });
  return (data ?? []) as OpcionInfluencer[];
}

/** id → URL de producto (para mostrar las listas del código en el formulario). */
export async function slugsDeProductos(cliente: Cliente, ids: readonly string[]): Promise<Map<string, string>> {
  const unicos = [...new Set(ids)];
  if (unicos.length === 0) return new Map();
  const { data } = await cliente.from('products').select('id, slug').in('id', unicos);
  return new Map(((data ?? []) as { id: string; slug: string }[]).map((p) => [p.id, p.slug]));
}

export type FilaCanje = { status: 'reserved' | 'confirmed' | 'released'; amount: number | string; created_at: string; orders: { number: string; status: string } | null };

export type ReporteUsoCodigo = {
  canjes: Record<'reserved' | 'confirmed' | 'released', { cantidad: number; monto: bigint }>;
  recientes: { numero: string | null; estadoPedido: string | null; estado: FilaCanje['status']; monto: bigint; fecha: string }[];
};

/** Reporte de uso de un código (§24.1): canjes por estado, monto descontado y los últimos pedidos. */
export async function reporteUsoCodigo(cliente: Cliente, codigoId: string): Promise<ReporteUsoCodigo> {
  const { data, error } = await cliente
    .from('discount_redemptions')
    .select('status, amount, created_at, orders(number, status)')
    .eq('discount_code_id', codigoId)
    .order('created_at', { ascending: false })
    .limit(1000);
  if (error) throw new Error(`No se pudo leer el uso del código: ${error.message}`);
  const filas = (data ?? []) as unknown as FilaCanje[];
  const canjes = {
    reserved: { cantidad: 0, monto: 0n },
    confirmed: { cantidad: 0, monto: 0n },
    released: { cantidad: 0, monto: 0n },
  };
  for (const c of filas) {
    canjes[c.status].cantidad += 1;
    canjes[c.status].monto += fromDbAmount(c.amount);
  }
  return {
    canjes,
    recientes: filas.slice(0, 20).map((c) => ({
      numero: c.orders?.number ?? null,
      estadoPedido: c.orders?.status ?? null,
      estado: c.status,
      monto: fromDbAmount(c.amount),
      fecha: c.created_at,
    })),
  };
}

// ── Escritura ────────────────────────────────────────────────────────────────────────────────────

type ResolucionRefs = { ok: true; targetIds: string[]; excludeIds: string[] } | { ok: false; resultado: ResultadoAccion };

/**
 * Resuelve las URL de producto a ids y comprueba categorías e influencer. Un producto o categoría que no existe,
 * o un influencer de otro país, se devuelve como error del campo (nunca se guarda un id colgante).
 */
async function resolverReferencias(cliente: Cliente, d: DatosRegla): Promise<ResolucionRefs> {
  const errores: Record<string, string> = {};
  const slugs = [...new Set([...d.target_product_slugs, ...d.exclude_product_slugs])];
  const idPorSlug = new Map<string, string>();
  if (slugs.length > 0) {
    const { data } = await cliente.from('products').select('id, slug').in('slug', slugs);
    for (const p of (data ?? []) as { id: string; slug: string }[]) idPorSlug.set(p.slug, p.id);
  }
  const faltan = (lista: readonly string[]) => lista.filter((s) => !idPorSlug.has(s));
  if (faltan(d.target_product_slugs).length > 0) {
    errores.target_products = `No encontramos estos productos: ${faltan(d.target_product_slugs).slice(0, 5).join(', ')}.`;
  }
  if (faltan(d.exclude_product_slugs).length > 0) {
    errores.exclude_products = `No encontramos estos productos: ${faltan(d.exclude_product_slugs).slice(0, 5).join(', ')}.`;
  }
  const categorias = [...new Set([...d.target_category_ids, ...d.exclude_category_ids])];
  if (categorias.length > 0) {
    const { data } = await cliente.from('categories').select('id').in('id', categorias);
    const existentes = new Set(((data ?? []) as { id: string }[]).map((c) => c.id));
    if (d.target_category_ids.some((c) => !existentes.has(c))) errores.target_categories = 'Una categoría elegida ya no existe.';
    if (d.exclude_category_ids.some((c) => !existentes.has(c))) errores.exclude_categories = 'Una categoría excluida ya no existe.';
  }
  if (d.influencer_id) {
    const { data } = await cliente.from('influencers').select('id, country_code').eq('id', d.influencer_id).maybeSingle();
    if (!data) errores.influencer_id = 'Ese influencer ya no existe.';
    else if ((data as { country_code: string }).country_code !== d.country_code) {
      errores.influencer_id = 'El influencer debe ser del mismo país que el código.';
    }
  }
  if (Object.keys(errores).length > 0) return { ok: false, resultado: { ok: false, mensaje: 'Revisa los campos marcados.', errores } };
  const aId = (s: string) => idPorSlug.get(s) as string;
  return {
    ok: true,
    targetIds: d.applies_to === 'categories' ? d.target_category_ids : d.applies_to === 'products' ? d.target_product_slugs.map(aId) : [],
    excludeIds: [...d.exclude_category_ids, ...d.exclude_product_slugs.map(aId)],
  };
}

/** Columnas de la regla en la forma de la base (montos como texto para `bigint`). */
export function columnasRegla(d: DatosRegla, targetIds: string[], excludeIds: string[]): Record<string, unknown> {
  return {
    country_code: d.country_code,
    type: d.type,
    value: d.value.toString(),
    max_discount_amount: d.max_discount_amount === null ? null : d.max_discount_amount.toString(),
    min_subtotal: d.min_subtotal.toString(),
    starts_at: d.starts_at,
    ends_at: d.ends_at,
    usage_limit_total: d.usage_limit_total,
    usage_limit_per_customer: d.usage_limit_per_customer,
    applies_to: d.applies_to,
    target_ids: targetIds,
    exclude_ids: excludeIds,
    applies_to_sale_items: d.applies_to_sale_items,
    influencer_id: d.influencer_id,
    iza_can_offer: d.iza_can_offer,
    is_active: d.is_active,
  };
}

/**
 * La fila guardada en la forma de la que se escribe (montos como texto, instantes en ISO UTC) para que el
 * diff de auditoría no marque como cambiados campos que solo difieren en la representación.
 */
export function comparable(fila: Record<string, unknown>): Record<string, unknown> {
  const salida = { ...fila };
  for (const k of ['value', 'max_discount_amount', 'min_subtotal']) {
    if (k in salida) salida[k] = salida[k] === null || salida[k] === undefined ? null : String(salida[k]);
  }
  for (const k of ['starts_at', 'ends_at']) {
    const v = salida[k];
    if (typeof v === 'string' && !Number.isNaN(Date.parse(v))) salida[k] = new Date(v).toISOString();
  }
  return salida;
}

const MENSAJE_CODIGO_REPETIDO = 'Ya existe un código con ese texto (en cualquiera de los países).';

export async function guardarCodigoBd(args: Ctx & { datos: DatosCodigo }): Promise<ResultadoAccion> {
  const { cliente, datos, actor, ip } = args;
  const refs = await resolverReferencias(cliente, datos);
  if (!refs.ok) return refs.resultado;
  const fila = { code: datos.code, ...columnasRegla(datos, refs.targetIds, refs.excludeIds) };

  if (datos.id) {
    const { data: antes } = await cliente.from('discount_codes').select('*').eq('id', datos.id).maybeSingle();
    if (!antes) return { ok: false, mensaje: 'Ese código ya no existe.' };
    const previo = antes as Record<string, unknown>;
    if (previo.country_code !== datos.country_code && Number(previo.usage_count ?? 0) > 0) {
      return { ok: false, mensaje: 'Este código ya se usó: no se puede cambiar de país.', errores: { country_code: 'Ya tiene usos.' } };
    }
    const { error } = await cliente.from('discount_codes').update(fila).eq('id', datos.id);
    if (error) return errorGuardado(error);
    await auditarCambio({
      actor,
      accion: 'discount_codes.actualizado',
      entidad: 'discount_codes',
      entidadId: datos.id,
      diff: diffCampos(comparable(previo), fila),
      ip,
    });
    return { ok: true, id: datos.id };
  }

  const { data, error } = await cliente
    .from('discount_codes')
    .insert({ ...fila, origin: 'manual' })
    .select('id')
    .single();
  if (error) return errorGuardado(error);
  await auditarCambio({ actor, accion: 'discount_codes.creado', entidad: 'discount_codes', entidadId: data.id, diff: { despues: fila }, ip });
  return { ok: true, id: data.id as string };
}

function errorGuardado(error: { code?: string | undefined; message: string; details?: string | undefined }): ResultadoAccion {
  if (error.code === '23505') {
    return { ok: false, mensaje: MENSAJE_CODIGO_REPETIDO, errores: { code: MENSAJE_CODIGO_REPETIDO } };
  }
  return { ok: false, ...traducirErrorBd(error) };
}

export async function alternarCodigoBd(args: Ctx & { id: string; activo: boolean }): Promise<ResultadoAccion> {
  const { cliente, id, activo, actor, ip } = args;
  const { data: antes } = await cliente.from('discount_codes').select('id, is_active').eq('id', id).maybeSingle();
  if (!antes) return { ok: false, mensaje: 'Ese código ya no existe.' };
  const { error } = await cliente.from('discount_codes').update({ is_active: activo }).eq('id', id);
  if (error) return { ok: false, ...traducirErrorBd(error) };
  await auditarCambio({
    actor,
    accion: activo ? 'discount_codes.activado' : 'discount_codes.desactivado',
    entidad: 'discount_codes',
    entidadId: id,
    diff: { antes: { is_active: (antes as { is_active: boolean }).is_active }, despues: { is_active: activo } },
    ip,
  });
  return { ok: true };
}

/** Un código con canjes (aunque estén liberados) no se borra: el historial de pedidos lo referencia. Se desactiva. */
export async function eliminarCodigoBd(args: Ctx & { id: string }): Promise<ResultadoAccion> {
  const { cliente, id, actor, ip } = args;
  const { data: antes } = await cliente.from('discount_codes').select('*').eq('id', id).maybeSingle();
  if (!antes) return { ok: true };
  const { count } = await cliente
    .from('discount_redemptions')
    .select('id', { count: 'exact', head: true })
    .eq('discount_code_id', id);
  if ((count ?? 0) > 0 || Number((antes as { usage_count?: number }).usage_count ?? 0) > 0) {
    return { ok: false, mensaje: 'Este código ya se usó: no se puede eliminar. Desactívalo para que deje de aplicarse.' };
  }
  const { error } = await cliente.from('discount_codes').delete().eq('id', id);
  if (error) return { ok: false, ...traducirErrorBd(error) };
  await auditarCambio({ actor, accion: 'discount_codes.eliminado', entidad: 'discount_codes', entidadId: id, diff: { antes }, ip });
  return { ok: true };
}

const REINTENTOS_LOTE = 3;

/**
 * Lote de campañas (§17.1): `PREFIJO-XXXXXX`, todos con la misma regla y `origin = 'batch'`. Se insertan en una
 * sola sentencia (todos o ninguno); si alguno choca con un código existente se vuelve a generar el lote
 * (máx. 3 intentos).
 */
export async function crearLoteBd(
  args: Ctx & { datos: DatosLote; azar: (n: number) => number },
): Promise<ResultadoAccion & { codigos?: string[] }> {
  const { cliente, datos, azar } = args;
  const refs = await resolverReferencias(cliente, datos);
  if (!refs.ok) return refs.resultado;
  const regla = columnasRegla(datos, refs.targetIds, refs.excludeIds);

  const { data: previos } = await cliente
    .from('discount_codes')
    .select('code')
    .ilike('code', `${escaparBusqueda(datos.prefix)}-%`)
    .limit(5000);
  const ocupados = new Set(((previos ?? []) as { code: string }[]).map((c) => c.code.toUpperCase()));

  for (let intento = 0; intento < REINTENTOS_LOTE; intento += 1) {
    let codigos: string[];
    try {
      codigos = generarCodigosLote(datos.prefix, datos.quantity, azar, ocupados);
    } catch {
      return {
        ok: false,
        mensaje: 'No se pudieron generar códigos únicos. Usa otro prefijo.',
        errores: { prefix: 'Prefijo con pocos códigos libres.' },
      };
    }
    const { error } = await cliente.from('discount_codes').insert(codigos.map((code) => ({ code, ...regla, origin: 'batch' })));
    if (!error) {
      await auditarLote(args, codigos.length, regla);
      return { ok: true, codigos };
    }
    if (error.code !== '23505') return { ok: false, ...traducirErrorBd(error) };
    for (const c of codigos) ocupados.add(c);
  }
  return { ok: false, mensaje: 'No se pudo generar el lote sin repetir códigos. Inténtalo de nuevo o usa otro prefijo.' };
}

async function auditarLote(a: Ctx & { datos: DatosLote }, cantidad: number, regla: Record<string, unknown>): Promise<void> {
  await auditarCambio({
    actor: a.actor,
    accion: 'discount_codes.lote',
    entidad: 'discount_codes',
    entidadId: a.datos.prefix,
    diff: { despues: { prefijo: a.datos.prefix, cantidad, regla } },
    ip: a.ip,
  });
}

/** Códigos de un prefijo para exportar el lote a CSV (código, estado de uso). */
export async function codigosDeLote(cliente: Cliente, pais: 'CO' | 'EC', prefijo: string): Promise<FilaCodigo[]> {
  const { data, error } = await cliente
    .from('discount_codes')
    .select(COLUMNAS_CODIGO)
    .eq('country_code', pais)
    .eq('origin', 'batch')
    .ilike('code', `${escaparBusqueda(prefijo)}-%`)
    .order('code', { ascending: true })
    .limit(5000);
  if (error) throw new Error(`No se pudo leer el lote: ${error.message}`);
  return (data ?? []) as unknown as FilaCodigo[];
}

export { TAMANO_PAGINA };
