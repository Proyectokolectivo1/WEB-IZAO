import 'server-only';
/**
 * Reseñas (§9.6, §24.1) con el cliente de servicio: bandeja de moderación, aprobar/rechazar, destacar en el home, crear y
 * editar reseñas de Izao (`source = 'admin'`) y borrar spam. Las de clientes no se reescriben: solo se moderan. Cada
 * escritura se audita e invalida el contenido público del país y, si es de un producto, su ficha.
 */
import { auditarCambio } from '@/lib/admin/auditoria';
import type { Cliente } from '../catalogo/taxonomias-servidor';
import { diffCampos, rangoPagina, type ResultadoAccion } from '../crud/comun';
import { invalidarContenido, invalidarProducto, traducirErrorBd } from '../crud/servidor';
import {
  ESTADOS_RESENA,
  destacadaTrasModerar,
  destacadaValida,
  esEstadoResena,
  resenaAfirmaOriginalidad,
  type DatosResenaAdmin,
  type EstadoResena,
  type FiltrosResena,
} from './resenas';

type Ctx = { cliente: Cliente; actor: string; ip: string | null };
type Pais = 'CO' | 'EC';

export type FilaResena = {
  id: string;
  country_code: Pais;
  product_id: string | null;
  author_name: string;
  city: string | null;
  rating: number;
  body: string | null;
  source: 'customer' | 'admin';
  is_verified_purchase: boolean;
  status: EstadoResena;
  featured_home: boolean;
  created_at: string;
  products: { name: string; slug: string } | null;
  /** Pedido ligado por la tienda (reseña de cliente con celular y pedido coincidentes). */
  order_id: string | null;
  orders: { number: string; status: string } | null;
  /** Hasta 3 fotos que subió quien opinó (públicas una vez aprobada la reseña, como siempre). */
  fotos: { id: string; ruta: string; alt: string }[];
};

const MAX_FOTOS = 3;

const COLUMNAS = 'id, country_code, product_id, author_name, city, rating, body, source, is_verified_purchase, status, featured_home, created_at, order_id, media_ids, products(name, slug), orders(number, status)';
const MENSAJE_ORIGINALIDAD = 'Esta reseña afirma originalidad o autenticidad: no se puede publicar ni destacar (regla de la tienda). Recházala.';
const unico = <T>(v: T[] | T | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
type FilaCruda = Omit<FilaResena, 'fotos' | 'products' | 'orders'> & { products: unknown; orders: unknown; media_ids: string[] | null };

function normal(f: FilaCruda): FilaResena & { media_ids: string[] } {
  const { media_ids, ...resto } = f;
  return {
    ...resto,
    products: unico(f.products as FilaResena['products'] | FilaResena['products'][]),
    orders: unico(f.orders as FilaResena['orders'] | FilaResena['orders'][]),
    fotos: [],
    media_ids: (media_ids ?? []).slice(0, MAX_FOTOS),
  };
}

/** Pone las fotos (una sola consulta a `media` para toda la página). */
async function conFotos(cliente: Cliente, filas: (FilaResena & { media_ids: string[] })[]): Promise<FilaResena[]> {
  const ids = [...new Set(filas.flatMap((f) => f.media_ids))];
  const porId = new Map<string, { ruta: string; alt: string }>();
  if (ids.length > 0) {
    const { data, error } = await cliente.from('media').select('id, variants, alt').in('id', ids).eq('kind', 'review');
    if (error) throw new Error(`No se pudieron leer las fotos de las reseñas: ${error.message}`);
    for (const m of (data ?? []) as { id: string; variants: Record<string, string> | null; alt: string | null }[]) {
      const v = m.variants ?? {};
      const ruta = v['400'] ?? Object.values(v)[0];
      if (ruta) porId.set(m.id, { ruta, alt: m.alt ?? 'Foto de la reseña' });
    }
  }
  return filas.map(({ media_ids, ...f }) => ({
    ...f,
    fotos: media_ids.flatMap((id) => {
      const m = porId.get(id);
      return m ? [{ id, ...m }] : [];
    }),
  }));
}

export async function listarResenas(cliente: Cliente, f: FiltrosResena): Promise<{ filas: FilaResena[]; total: number }> {
  let q = cliente.from('reviews').select(COLUMNAS, { count: 'exact' });
  if (f.estado !== 'todas') q = q.eq('status', f.estado);
  if (f.pais) q = q.eq('country_code', f.pais);
  if (f.fuente) q = q.eq('source', f.fuente);
  if (f.soloDestacadas) q = q.eq('featured_home', true);
  const [desde, hasta] = rangoPagina(f.pagina);
  const { data, error, count } = await q.order('created_at', { ascending: false }).range(desde, hasta);
  if (error) throw new Error(`No se pudieron listar las reseñas: ${error.message}`);
  return { filas: await conFotos(cliente, ((data ?? []) as unknown as FilaCruda[]).map(normal)), total: count ?? 0 };
}

/** Reseñas por estado (pestañas de la bandeja), respetando el país elegido. */
export async function contarResenas(cliente: Cliente, pais: Pais | ''): Promise<Record<EstadoResena, number>> {
  const cuentas = await Promise.all(
    ESTADOS_RESENA.map(async (estado) => {
      let q = cliente.from('reviews').select('id', { count: 'exact', head: true }).eq('status', estado);
      if (pais) q = q.eq('country_code', pais);
      const { count, error } = await q;
      if (error) throw new Error(`No se pudieron contar las reseñas: ${error.message}`);
      return [estado, count ?? 0] as const;
    }),
  );
  return Object.fromEntries(cuentas) as Record<EstadoResena, number>;
}

export async function obtenerResena(cliente: Cliente, id: string): Promise<FilaResena | null> {
  const { data, error } = await cliente.from('reviews').select(COLUMNAS).eq('id', id).maybeSingle();
  if (error) throw new Error(`No se pudo leer la reseña: ${error.message}`);
  if (!data) return null;
  return (await conFotos(cliente, [normal(data as unknown as FilaCruda)]))[0] ?? null;
}

function invalidar(r: { country_code: Pais; product_id: string | null }): void {
  if (r.product_id) invalidarProducto(r.product_id, [r.country_code]);
  invalidarContenido([r.country_code]);
}

/** Aprobar, rechazar o devolver a revisión. Rechazar o devolver quita el destacado del home. */
export async function moderarResenaBd(args: Ctx & { id: string; estado: EstadoResena }): Promise<ResultadoAccion> {
  const { cliente, id, estado, actor, ip } = args;
  if (!esEstadoResena(estado)) return { ok: false, mensaje: 'Estado no válido.' };
  const antes = await obtenerResena(cliente, id);
  if (!antes) return { ok: false, mensaje: 'Esa reseña ya no existe.' };
  if (estado === 'approved' && resenaAfirmaOriginalidad(antes)) return { ok: false, mensaje: MENSAJE_ORIGINALIDAD };
  const fila = { status: estado, featured_home: destacadaTrasModerar(estado, antes.featured_home) };
  const { error } = await cliente.from('reviews').update(fila).eq('id', id);
  if (error) return { ok: false, ...traducirErrorBd(error) };
  await auditarCambio({ actor, accion: `resenas.${estado === 'approved' ? 'aprobada' : estado === 'rejected' ? 'rechazada' : 'devuelta_a_revision'}`, entidad: 'reviews', entidadId: id, diff: diffCampos(antes as unknown as Record<string, unknown>, fila), ip });
  invalidar(antes);
  return { ok: true, id };
}

/** Destacar o quitar del home; solo las aprobadas pueden destacarse. */
export async function destacarResenaBd(args: Ctx & { id: string; destacada: boolean }): Promise<ResultadoAccion> {
  const { cliente, id, destacada, actor, ip } = args;
  const antes = await obtenerResena(cliente, id);
  if (!antes) return { ok: false, mensaje: 'Esa reseña ya no existe.' };
  if (destacada && resenaAfirmaOriginalidad(antes)) return { ok: false, mensaje: MENSAJE_ORIGINALIDAD };
  if (!destacadaValida(antes.status, destacada)) return { ok: false, mensaje: 'Solo una reseña aprobada puede destacarse en el home.' };
  const { error } = await cliente.from('reviews').update({ featured_home: destacada }).eq('id', id);
  if (error) return { ok: false, ...traducirErrorBd(error) };
  await auditarCambio({ actor, accion: destacada ? 'resenas.destacada' : 'resenas.destacado_quitado', entidad: 'reviews', entidadId: id, ip });
  invalidar(antes);
  return { ok: true, id };
}

/** Crea o edita una reseña de Izao. Una reseña de cliente no se edita (solo se modera). */
export async function guardarResenaAdminBd(args: Ctx & { datos: DatosResenaAdmin }): Promise<ResultadoAccion> {
  const { cliente, datos, actor, ip } = args;
  let productId: string | null = null;
  if (datos.product_slug) {
    const { data } = await cliente.from('products').select('id').eq('slug', datos.product_slug).maybeSingle();
    if (!data) return { ok: false, mensaje: 'No encontramos ese producto.', errores: { product_slug: 'No encontramos ese producto.' } };
    productId = (data as { id: string }).id;
  }
  const fila = {
    country_code: datos.country_code,
    product_id: productId,
    author_name: datos.author_name,
    city: datos.city,
    rating: datos.rating,
    body: datos.body,
    status: datos.status,
    featured_home: datos.featured_home,
  };
  if (datos.id) {
    const antes = await obtenerResena(cliente, datos.id);
    if (!antes) return { ok: false, mensaje: 'Esa reseña ya no existe.' };
    if (antes.source !== 'admin') return { ok: false, mensaje: 'Las reseñas de clientes no se editan: solo se aprueban o rechazan.' };
    const { error } = await cliente.from('reviews').update(fila).eq('id', datos.id).eq('source', 'admin');
    if (error) return { ok: false, ...traducirErrorBd(error) };
    await auditarCambio({ actor, accion: 'resenas.actualizada', entidad: 'reviews', entidadId: datos.id, diff: diffCampos(antes as unknown as Record<string, unknown>, fila), ip });
    invalidar(antes);
    invalidar({ country_code: datos.country_code, product_id: productId });
    return { ok: true, id: datos.id };
  }
  const { data, error } = await cliente.from('reviews').insert({ ...fila, source: 'admin', is_verified_purchase: false }).select('id').single();
  if (error) return { ok: false, ...traducirErrorBd(error) };
  await auditarCambio({ actor, accion: 'resenas.creada', entidad: 'reviews', entidadId: data.id, diff: { despues: fila }, ip });
  invalidar({ country_code: datos.country_code, product_id: productId });
  return { ok: true, id: data.id as string };
}

/** Borra una reseña (spam o error). El registro completo queda en la auditoría. */
export async function eliminarResenaBd(args: Ctx & { id: string }): Promise<ResultadoAccion> {
  const { cliente, id, actor, ip } = args;
  const antes = await obtenerResena(cliente, id);
  if (!antes) return { ok: true };
  const { error } = await cliente.from('reviews').delete().eq('id', id);
  if (error) return { ok: false, ...traducirErrorBd(error) };
  await auditarCambio({ actor, accion: 'resenas.eliminada', entidad: 'reviews', entidadId: id, diff: { antes }, ip });
  invalidar(antes);
  return { ok: true };
}
