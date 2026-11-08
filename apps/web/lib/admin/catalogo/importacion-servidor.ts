import 'server-only';
/**
 * Importar, exportar y cargar imágenes por SKU. Simulación y aplicación usan la RPC `admin_importar_catalogo`
 * (atómica por producto; un producto con error se reporta y no detiene el lote). El cliente y las funciones
 * externas se inyectan para poder probar sin base de datos ni disco.
 */
import { auditarCambio } from '@/lib/admin/auditoria';
import {
  guardarProducto,
  importarCatalogo,
  type FilaImportacion,
  type GuardarProductoEntrada,
  type ResultadoGuardarProducto,
  type ResultadoImportarCatalogo,
} from '@/lib/db/admin-catalogo';
import { subirImagen, type ResultadoSubida } from '@/lib/admin/media/registrar';
import { invalidarCatalogo, invalidarProducto } from '../crud/servidor';
import {
  construirImportacion,
  crearCatalogos,
  filasDeExportacion,
  fusionarImagenes,
  parsearNombreImagen,
  tablaAFilas,
  type Catalogos,
  type ErrorImportacion,
  type ProductoExportable,
} from './importacion';
import { errorDeMotivo, type ProductoBd } from './productos';
import type { Cliente } from './taxonomias-servidor';

const LOTE = 200;

export type ReporteImportacion = {
  modo: 'simular' | 'aplicar';
  productos: number;
  creados: number;
  actualizados: number;
  sin_cambios: number;
  omitidos: number;
  errores: ErrorImportacion[];
  cambios: { slug: string; filas: number[]; tipo: 'crear' | 'actualizar'; campos: string[] }[];
  ignoradas: string[];
};

export type Importar = (modo: 'simular' | 'aplicar', filas: FilaImportacion[]) => Promise<ResultadoImportarCatalogo>;

export async function cargarCatalogos(cliente: Cliente): Promise<Catalogos> {
  const leer = async (tabla: string, extra = '') => {
    const { data, error } = await cliente.from(tabla).select(`id, name, slug${extra}`);
    if (error) throw new Error(`No se pudo leer ${tabla}: ${error.message}`);
    return (data ?? []) as unknown as { id: string; name: string; slug: string; parent_id: string | null }[];
  };
  const [marcas, generos, familias, concentraciones, categorias] = await Promise.all([
    leer('brands'),
    leer('genders'),
    leer('olfactory_families'),
    leer('concentrations'),
    leer('categories', ', parent_id'),
  ]);
  return crearCatalogos({ marcas, generos, familias, concentraciones, categorias });
}

/** Lee la tabla, valida, y simula o aplica en lotes. `aplicar` audita e invalida la caché. */
export async function procesarImportacion(args: {
  modo: 'simular' | 'aplicar';
  tabla: readonly (readonly string[])[];
  cliente: Cliente;
  actor: string;
  ip: string | null;
  importar?: Importar;
}): Promise<ReporteImportacion | { error: string }> {
  const { modo, cliente } = args;
  const importar = args.importar ?? importarCatalogo;
  const leida = tablaAFilas(args.tabla);
  if (leida.error) return { error: leida.error };
  if (leida.filas.length === 0) return { error: 'El archivo no tiene filas de productos.' };

  const { productos, errores, omitidos } = construirImportacion(leida.filas, await cargarCatalogos(cliente));
  const reporte: ReporteImportacion = {
    modo, productos: productos.length, creados: 0, actualizados: 0, sin_cambios: 0, omitidos,
    errores: [...errores], cambios: [], ignoradas: leida.ignoradas,
  };

  for (let desde = 0; desde < productos.length; desde += LOTE) {
    const lote = productos.slice(desde, desde + LOTE);
    let r: ResultadoImportarCatalogo;
    try {
      r = await importar(modo, lote.map((p) => p.payload));
    } catch (e) {
      console.error('[panel] admin_importar_catalogo falló:', e instanceof Error ? e.message : 'error');
      for (const p of lote) reporte.errores.push({ fila: p.filas[0] ?? null, sku: p.skus[0] ?? null, mensaje: 'No se pudo procesar este producto. Inténtalo de nuevo.' });
      reporte.omitidos += lote.length;
      continue;
    }
    if (!r.ok) {
      for (const p of lote) reporte.errores.push({ fila: p.filas[0] ?? null, sku: p.skus[0] ?? null, mensaje: errorDeMotivo(r.motivo, r.detalle, { variants: [] }).mensaje });
      reporte.omitidos += lote.length;
      continue;
    }
    reporte.creados += r.creados;
    reporte.actualizados += r.actualizados;
    reporte.sin_cambios += r.sin_cambios;
    reporte.omitidos += r.errores.length;
    for (const e of r.errores) {
      const p = lote[e.indice];
      const texto = errorDeMotivo(e.motivo, e.detalle, { variants: [] }, e.paises).mensaje;
      reporte.errores.push({
        fila: p?.filas[0] ?? null,
        sku: e.sku ?? p?.skus[0] ?? null,
        mensaje: e.detalle && !texto.includes(e.detalle) ? `${texto} (${e.detalle})` : texto,
      });
    }
    for (const c of r.cambios) {
      const p = lote[c.indice];
      if (p) reporte.cambios.push({ slug: p.slug, filas: p.filas, tipo: c.tipo, campos: c.campos });
    }
  }
  reporte.errores.sort((a, b) => (a.fila ?? 0) - (b.fila ?? 0));

  if (modo === 'aplicar') {
    await auditarCambio({
      actor: args.actor,
      accion: 'catalogo.importado',
      entidad: 'products',
      diff: { despues: { creados: reporte.creados, actualizados: reporte.actualizados, sin_cambios: reporte.sin_cambios, con_errores: reporte.errores.length } },
      ip: args.ip,
    });
    await invalidarTrasImportar(cliente, productos.map((p) => p.slug));
  }
  return reporte;
}

async function invalidarTrasImportar(cliente: Cliente, slugs: string[]): Promise<void> {
  invalidarCatalogo();
  for (let i = 0; i < slugs.length; i += LOTE) {
    const { data } = await cliente.from('products').select('id').in('slug', slugs.slice(i, i + LOTE));
    for (const p of (data ?? []) as { id: string }[]) invalidarProducto(p.id);
  }
}

// ---------------------------------------------------------------------------------------------
// Exportación
// ---------------------------------------------------------------------------------------------

export const MAX_EXPORTAR = 5000;

/** Todas las variantes del catálogo en el formato de importación (hasta 5000 productos). */
export async function exportarCatalogo(cliente: Cliente): Promise<string[][]> {
  const nombres = async (tabla: string) => {
    const { data } = await cliente.from(tabla).select('id, name');
    return new Map(((data ?? []) as { id: string; name: string }[]).map((r) => [r.id, r.name]));
  };
  const [marcas, generos, familias, concentraciones, categorias] = await Promise.all([
    nombres('brands'), nombres('genders'), nombres('olfactory_families'), nombres('concentrations'), nombres('categories'),
  ]);
  const salida: ProductoExportable[] = [];
  for (let desde = 0; desde < MAX_EXPORTAR; desde += LOTE) {
    const { data, error } = await cliente.from('products').select('*').order('created_at').order('id').range(desde, desde + LOTE - 1);
    if (error) throw new Error(`No se pudo exportar: ${error.message}`);
    const productos = (data ?? []) as ProductoBd['product'][];
    if (productos.length === 0) break;
    const ids = productos.map((p) => p.id);
    const [cats, paises, opciones, variantes] = await Promise.all([
      cliente.from('product_categories').select('product_id, category_id').in('product_id', ids),
      cliente.from('product_countries').select('product_id, country_code, is_visible, is_featured, featured_rank, badges').in('product_id', ids),
      cliente.from('product_options').select('id, product_id, name, sort_order, product_option_values(id, value, sort_order)').in('product_id', ids),
      cliente
        .from('product_variants')
        .select('id, product_id, sku, option_value_ids, weight_kg, is_default, image_id, sort_order, variant_countries(country_code, is_active, price, compare_at_price, cost, stock, low_stock_threshold, mastershop_product_id, mastershop_variant_id)')
        .in('product_id', ids),
    ]);
    for (const r of [cats, paises, opciones, variantes]) if (r.error) throw new Error(`No se pudo exportar: ${r.error.message}`);
    const de = <T extends { product_id: string }>(filas: unknown): Map<string, T[]> => {
      const m = new Map<string, T[]>();
      for (const f of (filas ?? []) as T[]) m.set(f.product_id, [...(m.get(f.product_id) ?? []), f]);
      return m;
    };
    const cDe = de<{ product_id: string; category_id: string }>(cats.data);
    const pDe = de<ProductoBd['countries'][number] & { product_id: string }>(paises.data);
    const oDe = de<{ product_id: string; id: string; name: string; sort_order: number; product_option_values: ProductoBd['options'][number]['values'] }>(opciones.data);
    const vDe = de<{ product_id: string; variant_countries: ProductoBd['variants'][number]['countries'] } & Omit<ProductoBd['variants'][number], 'countries'>>(variantes.data);
    for (const p of productos) {
      const bd: ProductoBd = {
        product: p,
        categoryIds: (cDe.get(p.id) ?? []).map((c) => c.category_id),
        countries: pDe.get(p.id) ?? [],
        options: (oDe.get(p.id) ?? []).map(({ product_option_values, ...o }) => ({ ...o, values: product_option_values ?? [] })),
        variants: (vDe.get(p.id) ?? []).map(({ variant_countries, ...v }) => ({ ...v, countries: variant_countries ?? [] })),
        images: [],
      };
      salida.push({
        bd,
        marca: marcas.get(p.brand_id ?? '') ?? '',
        genero: generos.get(p.gender_id ?? '') ?? '',
        familia: familias.get(p.family_id ?? '') ?? '',
        concentracion: concentraciones.get(p.concentration_id ?? '') ?? '',
        categorias: bd.categoryIds.map((id) => categorias.get(id) ?? '').filter(Boolean),
      });
    }
    if (productos.length < LOTE) break;
  }
  return filasDeExportacion(salida);
}

// ---------------------------------------------------------------------------------------------
// Imágenes masivas por SKU
// ---------------------------------------------------------------------------------------------

export type ReporteImagenes = {
  asignadas: { sku: string; posicion: number }[];
  errores: { archivo: string; mensaje: string }[];
};

export async function adjuntarImagenesPorSku(args: {
  archivos: readonly { nombre: string; datos: Buffer }[];
  cliente: Cliente;
  actor: string;
  ip: string | null;
  subir?: typeof subirImagen;
  guardar?: (e: GuardarProductoEntrada) => Promise<ResultadoGuardarProducto>;
}): Promise<ReporteImagenes> {
  const { cliente } = args;
  const subir = args.subir ?? subirImagen;
  const guardar = args.guardar ?? guardarProducto;
  const reporte: ReporteImagenes = { asignadas: [], errores: [] };

  const analizados: { nombre: string; datos: Buffer; sku: string; posicion: number }[] = [];
  for (const a of args.archivos) {
    const p = parsearNombreImagen(a.nombre);
    if (!p) reporte.errores.push({ archivo: a.nombre, mensaje: 'El nombre debe ser SKU_numero.jpg (por ejemplo AVT-100_1.jpg).' });
    else analizados.push({ ...a, ...p });
  }
  if (analizados.length === 0) return reporte;

  const skus = [...new Set(analizados.map((a) => a.sku))];
  const { data } = await cliente.from('product_variants').select('sku, product_id, products(name, slug)').in('sku', skus);
  const productoDe = new Map<string, { id: string; name: string; slug: string }>();
  for (const v of (data ?? []) as unknown as { sku: string; product_id: string; products: { name: string; slug: string } | null }[]) {
    if (v.products) productoDe.set(v.sku, { id: v.product_id, ...v.products });
  }

  const porProducto = new Map<string, { producto: { id: string; name: string; slug: string }; items: typeof analizados }>();
  for (const a of analizados) {
    const producto = productoDe.get(a.sku);
    if (!producto) {
      reporte.errores.push({ archivo: a.nombre, mensaje: `No existe ningún SKU "${a.sku}" (se respetan mayúsculas).` });
      continue;
    }
    const g = porProducto.get(producto.id) ?? { producto, items: [] };
    g.items.push(a);
    porProducto.set(producto.id, g);
  }

  for (const { producto, items } of porProducto.values()) {
    const subidas: { media_id: string; posicion: number; sku: string }[] = [];
    for (const it of items) {
      const r: ResultadoSubida = await subir({
        buffer: it.datos,
        nombre: it.nombre,
        datos: { kind: 'product', alt: producto.name.slice(0, 200), recorte45: true },
        actor: args.actor,
        ip: args.ip,
      });
      if (!r.ok) reporte.errores.push({ archivo: it.nombre, mensaje: r.error });
      else subidas.push({ media_id: r.media.id, posicion: it.posicion, sku: it.sku });
    }
    if (subidas.length === 0) continue;
    const { data: existentes } = await cliente.from('product_images').select('media_id, role, sort_order').eq('product_id', producto.id);
    const imagenes = fusionarImagenes(
      (existentes ?? []) as { media_id: string; role: 'primary' | 'hover' | 'gallery'; sort_order: number }[],
      subidas,
    );
    let r: ResultadoGuardarProducto;
    try {
      r = await guardar({ product: { id: producto.id, name: producto.name, slug: producto.slug }, images: imagenes });
    } catch {
      r = { ok: false, motivo: 'datos_invalidos', detalle: null };
    }
    if (!r.ok) {
      for (const s of subidas) reporte.errores.push({ archivo: `${s.sku}_${s.posicion}`, mensaje: 'No se pudieron asociar las imágenes al producto.' });
      continue;
    }
    for (const s of subidas) reporte.asignadas.push({ sku: s.sku, posicion: s.posicion });
    await auditarCambio({
      actor: args.actor,
      accion: 'productos.imagenes_masivas',
      entidad: 'products',
      entidadId: producto.id,
      diff: { despues: { imagenes: imagenes.length, cargadas: subidas.length } },
      ip: args.ip,
    });
    invalidarProducto(producto.id);
  }
  return reporte;
}
