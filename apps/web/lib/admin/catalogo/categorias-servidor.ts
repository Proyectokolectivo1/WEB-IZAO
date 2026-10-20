import 'server-only';
/** Lectura y escritura de categorías y su visibilidad por país (servicio, sin RLS). */
import { auditarCambio } from '@/lib/admin/auditoria';
import { diffCampos, type ResultadoAccion } from '../crud/comun';
import { invalidarCatalogo, traducirErrorBd } from '../crud/servidor';
import {
  columnasCategoria,
  validarJerarquia,
  visibilidadPorPais,
  type DatosCategoria,
  type FilaArbol,
  type PaisCatalogo,
} from './categorias';
import type { Cliente } from './taxonomias-servidor';

export type FilaCategoria = FilaArbol & {
  slug: string;
  show_in_menu: boolean;
  paises: Record<PaisCatalogo, { is_visible: boolean; sort_order: number } | undefined>;
};

export type CategoriaCompleta = {
  id: string;
  parent_id: string | null;
  name: string;
  slug: string;
  description: string | null;
  seo_title: string | null;
  seo_description: string | null;
  image_id: string | null;
  banner_image_id: string | null;
  sort_order: number;
  show_in_menu: boolean;
  paises: Record<PaisCatalogo, { is_visible: boolean; sort_order: number }>;
  imagen: { id: string; ruta: string; alt: string } | null;
  banner: { id: string; ruta: string; alt: string } | null;
  tieneHijos: boolean;
};

const UNICOS = { slug: 'Ese identificador de URL ya está en uso.' };

/** Todas las categorías (son pocas: decenas) con su visibilidad por país. */
export async function listarCategorias(cliente: Cliente): Promise<FilaCategoria[]> {
  const [cats, pais] = await Promise.all([
    cliente.from('categories').select('id, parent_id, name, slug, sort_order, show_in_menu'),
    cliente.from('category_countries').select('category_id, country_code, is_visible, sort_order'),
  ]);
  if (cats.error) throw new Error(`No se pudo listar categorías: ${cats.error.message}`);
  const porCategoria = new Map<string, FilaCategoria['paises']>();
  for (const p of pais.data ?? []) {
    const m = porCategoria.get(p.category_id) ?? { CO: undefined, EC: undefined };
    m[p.country_code as PaisCatalogo] = { is_visible: p.is_visible, sort_order: p.sort_order };
    porCategoria.set(p.category_id, m);
  }
  return (cats.data ?? []).map((c) => ({
    ...c,
    paises: porCategoria.get(c.id) ?? { CO: undefined, EC: undefined },
  }));
}

async function imagenDe(cliente: Cliente, id: string | null) {
  if (!id) return null;
  const { data } = await cliente.from('media').select('variants, alt').eq('id', id).maybeSingle();
  const ruta = (data?.variants as Record<string, string> | undefined)?.['400'];
  return ruta ? { id, ruta, alt: data?.alt ?? '' } : null;
}

export async function obtenerCategoria(cliente: Cliente, id: string): Promise<CategoriaCompleta | null> {
  const { data, error } = await cliente.from('categories').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`No se pudo leer la categoría: ${error.message}`);
  if (!data) return null;
  const [pais, hijos, imagen, banner] = await Promise.all([
    cliente.from('category_countries').select('country_code, is_visible, sort_order').eq('category_id', id),
    cliente.from('categories').select('id', { count: 'exact', head: true }).eq('parent_id', id),
    imagenDe(cliente, data.image_id),
    imagenDe(cliente, data.banner_image_id),
  ]);
  const paises: CategoriaCompleta['paises'] = {
    CO: { is_visible: false, sort_order: 0 },
    EC: { is_visible: false, sort_order: 0 },
  };
  for (const p of pais.data ?? []) {
    paises[p.country_code as PaisCatalogo] = { is_visible: p.is_visible, sort_order: p.sort_order };
  }
  return { ...(data as Omit<CategoriaCompleta, 'paises' | 'imagen' | 'banner' | 'tieneHijos'>), paises, imagen, banner, tieneHijos: (hijos.count ?? 0) > 0 };
}

export async function guardarCategoriaBd(args: {
  cliente: Cliente;
  datos: DatosCategoria;
  actor: string;
  ip: string | null;
}): Promise<ResultadoAccion> {
  const { cliente, datos, actor, ip } = args;

  // Jerarquía de 2 niveles con mensaje claro (el trigger de la base es la red de seguridad).
  let padre: { id: string; parent_id: string | null } | null = null;
  if (datos.parent_id) {
    const { data } = await cliente.from('categories').select('id, parent_id').eq('id', datos.parent_id).maybeSingle();
    padre = data;
  }
  let tieneHijos = false;
  if (datos.id) {
    const { count } = await cliente.from('categories').select('id', { count: 'exact', head: true }).eq('parent_id', datos.id);
    tieneHijos = (count ?? 0) > 0;
  }
  const errorJerarquia = validarJerarquia({ id: datos.id, parentId: datos.parent_id, padre, tieneHijos });
  if (errorJerarquia) return { ok: false, mensaje: errorJerarquia, errores: { parent_id: errorJerarquia } };

  const fila = columnasCategoria(datos);
  const paises = visibilidadPorPais(datos);
  let id = datos.id;
  let antes: Record<string, unknown> | null = null;

  if (id) {
    const previo = await cliente.from('categories').select('*').eq('id', id).maybeSingle();
    if (!previo.data) return { ok: false, mensaje: 'Esa categoría ya no existe.' };
    antes = previo.data as Record<string, unknown>;
    const { error } = await cliente.from('categories').update(fila).eq('id', id);
    if (error) return { ok: false, ...traducirErrorBd(error, UNICOS) };
  } else {
    const { data, error } = await cliente.from('categories').insert(fila).select('id').single();
    if (error) return { ok: false, ...traducirErrorBd(error, UNICOS) };
    id = data.id as string;
  }

  const { error: errPaises } = await cliente
    .from('category_countries')
    .upsert(paises.map((p) => ({ category_id: id, ...p })), { onConflict: 'category_id,country_code' });
  if (errPaises) {
    return { ok: false, ...traducirErrorBd(errPaises) };
  }

  await auditarCambio({
    actor,
    accion: datos.id ? 'categories.actualizado' : 'categories.creado',
    entidad: 'categories',
    entidadId: id,
    diff: datos.id
      ? { ...diffCampos(antes, { ...fila }), paises }
      : { despues: { ...fila, paises } },
    ip,
  });
  invalidarCatalogo();
  return { ok: true, id: id as string };
}

/** No se elimina con subcategorías, productos o banners de categoría (el banner se borraría en cascada). */
export async function eliminarCategoriaBd(args: {
  cliente: Cliente;
  id: string;
  actor: string;
  ip: string | null;
}): Promise<ResultadoAccion> {
  const { cliente, id, actor, ip } = args;
  const cuenta = (tabla: string, columna: string) =>
    cliente.from(tabla).select(columna, { count: 'exact', head: true }).eq(columna, id);
  const [hijos, productos, banners] = await Promise.all([
    cuenta('categories', 'parent_id'),
    cuenta('product_categories', 'category_id'),
    cuenta('banners', 'category_id'),
  ]);
  if (hijos.error || productos.error || banners.error) {
    return { ok: false, mensaje: 'No se pudo verificar si la categoría está en uso.' };
  }
  if ((hijos.count ?? 0) > 0) return { ok: false, mensaje: 'Tiene subcategorías: elimínalas o muévelas primero.' };
  if ((productos.count ?? 0) > 0) {
    return { ok: false, mensaje: `${productos.count} producto(s) están en esta categoría. Quítalos de ella primero.` };
  }
  if ((banners.count ?? 0) > 0) {
    return { ok: false, mensaje: `${banners.count} banner(s) apuntan a esta categoría. Cámbialos primero.` };
  }
  const { data: antes } = await cliente.from('categories').select('*').eq('id', id).maybeSingle();
  if (!antes) return { ok: true };
  const { error } = await cliente.from('categories').delete().eq('id', id);
  if (error) return { ok: false, ...traducirErrorBd(error) };
  await auditarCambio({ actor, accion: 'categories.eliminado', entidad: 'categories', entidadId: id, diff: { antes }, ip });
  invalidarCatalogo();
  return { ok: true };
}
