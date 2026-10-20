import 'server-only';
/**
 * Lectura y escritura de productos del panel. La escritura completa (producto, categorías, países,
 * opciones, variantes, precios, stock e imágenes) la hace la RPC `admin_guardar_producto` en una sola
 * transacción; aquí se arma el payload, se audita y se invalida la caché. El cliente y la función de
 * guardado se inyectan para poder probar sin base de datos.
 */
import { auditarCambio } from '@/lib/admin/auditoria';
import { guardarProducto, type GuardarProductoEntrada, type ResultadoGuardarProducto } from '@/lib/db/admin-catalogo';
import { diffCampos, escaparBusqueda, rangoPagina, type ResultadoAccion } from '../crud/comun';
import { invalidarProducto } from '../crud/servidor';
import type { Cliente } from './taxonomias-servidor';
import {
  aFormulario,
  construirEntrada,
  duplicarForm,
  errorDeMotivo,
  resumenPorPais,
  type EstadoProducto,
  type FiltrosProductos,
  type ProductoBd,
  type ProductoForm,
  type ResumenPais,
  type PaisProducto,
} from './productos';

export type Guardar = (entrada: GuardarProductoEntrada) => Promise<ResultadoGuardarProducto>;
export type Contexto = { cliente: Cliente; actor: string; ip: string | null; guardar?: Guardar };

// ---------------------------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------------------------

export type FilaProducto = {
  id: string;
  name: string;
  slug: string;
  status: EstadoProducto;
  marca: string | null;
  imagen: string | null;
  variantes: number;
  paises: Record<PaisProducto, ResumenPais>;
  actualizado: string;
};

/** Lista paginada en el servidor con filtros de la URL. La búsqueda acepta nombre, URL o SKU. */
export async function listarProductos(
  cliente: Cliente,
  filtros: FiltrosProductos,
): Promise<{ filas: FilaProducto[]; total: number }> {
  // Búsqueda: tres consultas de un solo filtro (nombre, URL, SKU), nunca texto libre dentro de `.or()`.
  let idsBusqueda: string[] | null = null;
  if (filtros.q) {
    const patron = `%${escaparBusqueda(filtros.q)}%`;
    const [porNombre, porUrl, porSku] = await Promise.all([
      cliente.from('products').select('id').ilike('name', patron).limit(200),
      cliente.from('products').select('id').ilike('slug', patron).limit(200),
      cliente.from('product_variants').select('product_id').ilike('sku', patron).limit(200),
    ]);
    const ids = new Set<string>();
    for (const r of (porNombre.data ?? []) as { id: string }[]) ids.add(r.id);
    for (const r of (porUrl.data ?? []) as { id: string }[]) ids.add(r.id);
    for (const r of (porSku.data ?? []) as { product_id: string }[]) ids.add(r.product_id);
    idsBusqueda = [...ids];
    if (idsBusqueda.length === 0) return { filas: [], total: 0 };
  }

  let consulta = cliente
    .from('products')
    .select(
      filtros.pais
        ? 'id, name, slug, status, updated_at, brands(name), product_countries!inner(country_code, is_visible)'
        : 'id, name, slug, status, updated_at, brands(name)',
      { count: 'exact' },
    );
  if (filtros.estado) consulta = consulta.eq('status', filtros.estado);
  if (filtros.marca) consulta = consulta.eq('brand_id', filtros.marca);
  if (filtros.pais) {
    consulta = consulta.eq('product_countries.country_code', filtros.pais).eq('product_countries.is_visible', true);
  }
  if (idsBusqueda) consulta = consulta.in('id', idsBusqueda);
  const [desde, hasta] = rangoPagina(filtros.pagina);
  const { data, error, count } = await consulta.order('updated_at', { ascending: false }).range(desde, hasta);
  if (error) throw new Error(`No se pudo listar productos: ${error.message}`);
  const productos = (data ?? []) as unknown as {
    id: string;
    name: string;
    slug: string;
    status: EstadoProducto;
    updated_at: string;
    brands: { name: string } | null;
  }[];
  if (productos.length === 0) return { filas: [], total: count ?? 0 };

  const ids = productos.map((p) => p.id);
  const [variantes, paises, imagenes] = await Promise.all([
    cliente
      .from('product_variants')
      .select('product_id, variant_countries(country_code, is_active, price, stock)')
      .in('product_id', ids),
    cliente.from('product_countries').select('product_id, country_code, is_visible').in('product_id', ids),
    cliente.from('product_images').select('product_id, media(variants)').in('product_id', ids).eq('role', 'primary'),
  ]);
  if (variantes.error || paises.error) throw new Error('No se pudo leer el detalle de los productos.');

  type V = { product_id: string; variant_countries: { country_code: string; is_active: boolean; price: number | string; stock: number }[] };
  const variantesDe = new Map<string, V[]>();
  for (const v of (variantes.data ?? []) as V[]) variantesDe.set(v.product_id, [...(variantesDe.get(v.product_id) ?? []), v]);
  const paisesDe = new Map<string, { country_code: string; is_visible: boolean }[]>();
  for (const p of (paises.data ?? []) as { product_id: string; country_code: string; is_visible: boolean }[]) {
    paisesDe.set(p.product_id, [...(paisesDe.get(p.product_id) ?? []), p]);
  }
  const imagenDe = new Map<string, string>();
  for (const i of (imagenes.data ?? []) as unknown as { product_id: string; media: { variants: Record<string, string> } | null }[]) {
    const ruta = i.media?.variants?.['400'];
    if (ruta) imagenDe.set(i.product_id, ruta);
  }

  const filas = productos.map((p) => {
    const vs = variantesDe.get(p.id) ?? [];
    return {
      id: p.id,
      name: p.name,
      slug: p.slug,
      status: p.status,
      marca: p.brands?.name ?? null,
      imagen: imagenDe.get(p.id) ?? null,
      variantes: vs.length,
      paises: resumenPorPais(vs.map((v) => ({ countries: v.variant_countries })), paisesDe.get(p.id) ?? []),
      actualizado: p.updated_at,
    };
  });
  return { filas, total: count ?? filas.length };
}

export type OpcionesFormulario = {
  marcas: { valor: string; etiqueta: string }[];
  generos: { valor: string; etiqueta: string }[];
  familias: { valor: string; etiqueta: string }[];
  concentraciones: { valor: string; etiqueta: string }[];
  categorias: { valor: string; etiqueta: string; nivel: 0 | 1 }[];
};

/** Listas para los selectores del formulario (taxonomías y categorías en árbol de 2 niveles). */
export async function opcionesFormulario(cliente: Cliente): Promise<OpcionesFormulario> {
  const nombres = async (tabla: string) => {
    const { data, error } = await cliente.from(tabla).select('id, name').order('name');
    if (error) throw new Error(`No se pudo leer ${tabla}: ${error.message}`);
    return ((data ?? []) as { id: string; name: string }[]).map((r) => ({ valor: r.id, etiqueta: r.name }));
  };
  const [marcas, generos, familias, concentraciones, cats] = await Promise.all([
    nombres('brands'),
    nombres('genders'),
    nombres('olfactory_families'),
    nombres('concentrations'),
    cliente.from('categories').select('id, parent_id, name, sort_order'),
  ]);
  const filas = (cats.data ?? []) as { id: string; parent_id: string | null; name: string; sort_order: number }[];
  const orden = (a: { sort_order: number; name: string }, b: { sort_order: number; name: string }) =>
    a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'es');
  const categorias: OpcionesFormulario['categorias'] = [];
  for (const raiz of filas.filter((c) => !c.parent_id).sort(orden)) {
    categorias.push({ valor: raiz.id, etiqueta: raiz.name, nivel: 0 });
    for (const hija of filas.filter((c) => c.parent_id === raiz.id).sort(orden)) {
      categorias.push({ valor: hija.id, etiqueta: hija.name, nivel: 1 });
    }
  }
  return { marcas, generos, familias, concentraciones, categorias };
}

/** Lee el producto completo y lo deja en la forma del formulario. `null` si no existe. */
export async function obtenerProductoForm(cliente: Cliente, id: string): Promise<ProductoForm | null> {
  const prod = await cliente.from('products').select('*').eq('id', id).maybeSingle();
  if (prod.error) throw new Error(`No se pudo leer el producto: ${prod.error.message}`);
  if (!prod.data) return null;
  const [cats, paises, opciones, variantes, imagenes] = await Promise.all([
    cliente.from('product_categories').select('category_id').eq('product_id', id),
    cliente.from('product_countries').select('country_code, is_visible, is_featured, featured_rank, badges').eq('product_id', id),
    cliente
      .from('product_options')
      .select('id, name, sort_order, product_option_values(id, value, sort_order)')
      .eq('product_id', id),
    cliente
      .from('product_variants')
      .select(
        'id, sku, option_value_ids, weight_kg, is_default, mastershop_product_id, mastershop_variant_id, image_id, sort_order, variant_countries(country_code, is_active, price, compare_at_price, cost, stock, low_stock_threshold)',
      )
      .eq('product_id', id),
    cliente.from('product_images').select('media_id, role, sort_order, media(variants, alt)').eq('product_id', id),
  ]);
  for (const r of [cats, paises, opciones, variantes, imagenes]) {
    if (r.error) throw new Error(`No se pudo leer el detalle del producto: ${r.error.message}`);
  }
  const p = prod.data as ProductoBd['product'];
  const bd: ProductoBd = {
    product: p,
    categoryIds: ((cats.data ?? []) as { category_id: string }[]).map((c) => c.category_id),
    countries: (paises.data ?? []) as ProductoBd['countries'],
    options: ((opciones.data ?? []) as unknown as (Omit<ProductoBd['options'][number], 'values'> & {
      product_option_values: ProductoBd['options'][number]['values'];
    })[]).map(({ product_option_values, ...o }) => ({ ...o, values: product_option_values ?? [] })),
    variants: ((variantes.data ?? []) as unknown as (Omit<ProductoBd['variants'][number], 'countries'> & {
      variant_countries: ProductoBd['variants'][number]['countries'];
    })[]).map(({ variant_countries, ...v }) => ({ ...v, countries: variant_countries ?? [] })),
    images: ((imagenes.data ?? []) as unknown as {
      media_id: string;
      role: ProductoBd['images'][number]['role'];
      sort_order: number;
      media: { variants: Record<string, string>; alt: string } | null;
    }[]).map((m) => ({ media_id: m.media_id, role: m.role, sort_order: m.sort_order, ruta: m.media?.variants?.['400'] ?? '', alt: m.media?.alt ?? '' })),
  };
  return aFormulario(bd);
}

// ---------------------------------------------------------------------------------------------
// Escritura
// ---------------------------------------------------------------------------------------------

async function guardarYAuditar(args: { entrada: GuardarProductoEntrada; form: Pick<ProductoForm, 'variants'> } & Contexto): Promise<ResultadoAccion> {
  const { entrada, form, cliente, actor, ip } = args;
  const guardar = args.guardar ?? guardarProducto;
  let antes: Record<string, unknown> | null = null;
  const idPrevio = entrada.product.id;
  if (idPrevio) {
    const previo = await cliente.from('products').select('*').eq('id', idPrevio).maybeSingle();
    antes = (previo.data as Record<string, unknown> | null) ?? null;
  }

  let resultado: ResultadoGuardarProducto;
  try {
    resultado = await guardar(entrada);
  } catch (e) {
    console.error('[panel] admin_guardar_producto falló:', e instanceof Error ? e.message : 'error');
    return { ok: false, mensaje: 'No se pudo guardar el producto. Inténtalo de nuevo.' };
  }
  if (!resultado.ok) {
    const { mensaje, errores } = errorDeMotivo(resultado.motivo, resultado.detalle, form);
    return { ok: false, mensaje, errores };
  }

  const resumen = {
    variantes: (entrada.variants ?? []).map((v) => v.sku),
    paises: (entrada.countries ?? []).filter((c) => c.is_visible).map((c) => c.country_code),
    categorias: (entrada.category_ids ?? []).length,
    imagenes: (entrada.images ?? []).length,
  };
  await auditarCambio({
    actor,
    accion: resultado.creado ? 'productos.creado' : 'productos.actualizado',
    entidad: 'products',
    entidadId: resultado.product_id,
    diff: resultado.creado
      ? { despues: { ...entrada.product, ...resumen } }
      : { ...diffCampos(antes, { ...entrada.product }), resumen },
    ip,
  });
  invalidarProducto(resultado.product_id);
  return { ok: true, id: resultado.product_id };
}

/** Valida el formulario, guarda de forma atómica, audita e invalida la caché. */
export async function guardarProductoPanel(args: { form: ProductoForm } & Contexto): Promise<ResultadoAccion> {
  const construido = construirEntrada(args.form);
  if (!construido.ok) return { ok: false, mensaje: 'Revisa los campos marcados.', errores: construido.errores };
  return guardarYAuditar({ ...args, entrada: construido.entrada });
}

/** Archiva: el producto deja de mostrarse en la tienda sin perder pedidos ni historial. */
export async function archivarProductoBd(args: { id: string } & Contexto): Promise<ResultadoAccion> {
  const { cliente, id } = args;
  const { data } = await cliente.from('products').select('id, name, slug, status').eq('id', id).maybeSingle();
  if (!data) return { ok: false, mensaje: 'Ese producto ya no existe.' };
  const fila = data as { name: string; slug: string; status: EstadoProducto };
  if (fila.status === 'archived') return { ok: true, id };
  const entrada: GuardarProductoEntrada = { product: { id, name: fila.name, slug: fila.slug, status: 'archived' } };
  const resultado = await guardarYAuditar({
    ...args,
    entrada,
    form: { variants: [] },
  });
  return resultado;
}

/** Crea una copia como borrador (invisible, sin vínculo MasterShop). Reintenta con otro sufijo si choca la URL o el SKU. */
export async function duplicarProductoBd(args: { id: string; nuevoId: () => string } & Contexto): Promise<ResultadoAccion> {
  const original = await obtenerProductoForm(args.cliente, args.id);
  if (!original) return { ok: false, mensaje: 'Ese producto ya no existe.' };
  let ultimo: ResultadoAccion = { ok: false, mensaje: 'No se pudo duplicar el producto.' };
  for (let intento = 1; intento <= 5; intento += 1) {
    const copia = duplicarForm(original, args.nuevoId, intento);
    ultimo = await guardarProductoPanel({ ...args, form: copia });
    if (ultimo.ok) return ultimo;
    const choque = ultimo.errores?.slug || Object.keys(ultimo.errores ?? {}).some((k) => k.endsWith('.sku')) || /SKU/.test(ultimo.mensaje ?? '');
    if (!choque) return ultimo;
  }
  return ultimo;
}
