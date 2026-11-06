import 'server-only';
/** Banners por país: lectura, guardado con destino resuelto, orden, activación y borrado (servicio, sin RLS). */
import { auditarCambio } from '@/lib/admin/auditoria';
import type { crearClienteServicio } from '@/lib/auth/supabase/servicio';
import { diffCampos, escaparBusqueda, type ResultadoAccion } from '../crud/comun';
import { invalidarContenido, traducirErrorBd, type Pais } from '../crud/servidor';
import { moverEnLista } from '../catalogo/colecciones';
import {
  apuntaAOtroPais,
  columnasBanner,
  destinoDeUrl,
  esUrlDestinoValida,
  FOCAL_CENTRO,
  tieneMovilPropia,
  urlDeDestino,
  type DatosBanner,
  type Destino,
  type Ubicacion,
} from './banners';

export type Cliente = ReturnType<typeof crearClienteServicio>;
type Ctx = { cliente: Cliente; actor: string; ip: string | null };

/**
 * `ruta` = la variante más chica (miniatura de la lista); `rutaPrevia` = la primera de 800 px o más, o la mayor
 * (vista previa del formulario); `ancho`/`alto` = dimensiones de la original.
 */
export type MediaMini = {
  id: string;
  ruta: string;
  rutaPrevia: string;
  alt: string;
  lqip: string | null;
  ancho: number | null;
  alto: number | null;
};

export type FilaBanner = {
  id: string;
  country_code: Pais;
  placement: Ubicacion;
  category_id: string | null;
  alt: string;
  title: string | null;
  subtitle: string | null;
  cta_label: string | null;
  link_url: string | null;
  text_position: 'left' | 'center' | 'right';
  text_color: string | null;
  starts_at: string | null;
  ends_at: string | null;
  sort_order: number;
  is_active: boolean;
  desktop: MediaMini | null;
  mobile: MediaMini | null;
  /** `true` solo en banners antiguos con una imagen móvil distinta; los nuevos usan una sola imagen. */
  movil_propia: boolean;
};

const PASO = 10;
const COLUMNAS =
  'id, country_code, placement, category_id, alt, title, subtitle, cta_label, link_url, text_position, text_color, starts_at, ends_at, sort_order, is_active, desktop_media_id, mobile_media_id';

type FilaCruda = Omit<FilaBanner, 'desktop' | 'mobile'> & { desktop_media_id: string; mobile_media_id: string };
type MediaCruda = {
  id: string;
  variants: Record<string, string> | null;
  alt: string | null;
  lqip: string | null;
  width: number | null;
  height: number | null;
};

function aMini(m: MediaCruda | undefined): MediaMini | null {
  if (!m) return null;
  const anchos = Object.keys(m.variants ?? {}).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  const ruta = anchos[0] !== undefined ? (m.variants?.[String(anchos[0])] ?? '') : '';
  const previa = anchos.find((a) => a >= 800) ?? anchos.at(-1);
  const rutaPrevia = previa !== undefined ? (m.variants?.[String(previa)] ?? ruta) : ruta;
  return ruta ? { id: m.id, ruta, rutaPrevia, alt: m.alt ?? '', lqip: m.lqip, ancho: m.width, alto: m.height } : null;
}

async function conImagenes(cliente: Cliente, filas: FilaCruda[]): Promise<FilaBanner[]> {
  const ids = [...new Set(filas.flatMap((f) => [f.desktop_media_id, f.mobile_media_id]))];
  const mapa = new Map<string, MediaCruda>();
  if (ids.length > 0) {
    const { data } = await cliente.from('media').select('id, variants, alt, lqip, width, height').in('id', ids);
    for (const m of (data ?? []) as MediaCruda[]) mapa.set(m.id, m);
  }
  return filas.map(({ desktop_media_id, mobile_media_id, ...resto }) => ({
    ...resto,
    desktop: aMini(mapa.get(desktop_media_id)),
    mobile: aMini(mapa.get(mobile_media_id)),
    movil_propia: tieneMovilPropia(desktop_media_id, mobile_media_id),
  }));
}

export type PuntoFocal = { disponible: boolean; x: number; y: number };

/**
 * Punto focal (D-047). Las columnas `banners.focal_x/focal_y` pueden no existir todavía (migración de izao-db):
 * sin ellas `disponible` es `false` y el formulario no ofrece el selector (la tienda usa el centro).
 * Sin `id` solo comprueba que las columnas existan.
 */
export async function leerFocal(cliente: Cliente, id: string | null): Promise<PuntoFocal> {
  const consulta = cliente.from('banners').select('focal_x, focal_y');
  const { data, error } = id ? await consulta.eq('id', id).maybeSingle() : await consulta.limit(1);
  if (error) return { disponible: false, x: FOCAL_CENTRO, y: FOCAL_CENTRO };
  const fila = (Array.isArray(data) ? data[0] : data) as { focal_x?: number | null; focal_y?: number | null } | null | undefined;
  return { disponible: true, x: fila?.focal_x ?? FOCAL_CENTRO, y: fila?.focal_y ?? FOCAL_CENTRO };
}

export async function listarBanners(cliente: Cliente, pais: Pais, ubicacion: Ubicacion): Promise<FilaBanner[]> {
  const { data, error } = await cliente
    .from('banners')
    .select(COLUMNAS)
    .eq('country_code', pais)
    .eq('placement', ubicacion)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw new Error(`No se pudo listar los banners: ${error.message}`);
  return conImagenes(cliente, (data ?? []) as unknown as FilaCruda[]);
}

export async function conteoPorUbicacion(cliente: Cliente, pais: Pais): Promise<Record<Ubicacion, number>> {
  const { data } = await cliente.from('banners').select('placement').eq('country_code', pais);
  const salida: Record<Ubicacion, number> = { hero: 0, mid: 0, category: 0 };
  for (const f of (data ?? []) as { placement: Ubicacion }[]) salida[f.placement] += 1;
  return salida;
}

export async function obtenerBanner(cliente: Cliente, id: string): Promise<FilaBanner | null> {
  const { data, error } = await cliente.from('banners').select(COLUMNAS).eq('id', id).maybeSingle();
  if (error) throw new Error(`No se pudo leer el banner: ${error.message}`);
  if (!data) return null;
  return (await conImagenes(cliente, [data as unknown as FilaCruda]))[0] ?? null;
}

// ── Selector de productos y destino ──────────────────────────────────────────────────────────────

export type ProductoVisible = { id: string; slug: string; name: string; brand: string | null; ruta: string | null };
export type VarianteDestino = { id: string; sku: string; etiqueta: string };

/** `Aventús` → `aventus`: `name_unaccent` está en minúsculas y sin tildes. */
export function normalizarBusqueda(q: string): string {
  return q.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

/** Productos VISIBLES en el país (catalog_listing), por nombre o marca. */
export async function buscarProductosVisibles(cliente: Cliente, pais: Pais, q: string, limite = 8): Promise<ProductoVisible[]> {
  const texto = normalizarBusqueda(q).slice(0, 80);
  if (texto.length < 2) return [];
  const { data } = await cliente
    .from('catalog_listing')
    .select('product_id, slug, name, brand_name, img_primary')
    .eq('country_code', pais)
    .eq('is_visible', true)
    .ilike('name_unaccent', `%${escaparBusqueda(texto)}%`)
    .order('sales_30d', { ascending: false })
    .limit(limite);
  type Fila = { product_id: string; slug: string; name: string; brand_name: string | null; img_primary: { variants?: Record<string, string> } | null };
  return ((data ?? []) as unknown as Fila[]).map((f) => {
    const anchos = Object.keys(f.img_primary?.variants ?? {}).map(Number).sort((a, b) => a - b);
    const ruta = anchos[0] !== undefined ? (f.img_primary?.variants?.[String(anchos[0])] ?? null) : null;
    return { id: f.product_id, slug: f.slug, name: f.name, brand: f.brand_name, ruta };
  });
}

/** Un producto visible en el país por su slug (para precargar el editor). */
export async function productoVisiblePorSlug(cliente: Cliente, pais: Pais, slug: string): Promise<ProductoVisible | null> {
  const { data } = await cliente
    .from('catalog_listing')
    .select('product_id, slug, name, brand_name')
    .eq('country_code', pais)
    .eq('slug', slug)
    .maybeSingle();
  const f = data as { product_id: string; slug: string; name: string; brand_name: string | null } | null;
  return f ? { id: f.product_id, slug: f.slug, name: f.name, brand: f.brand_name, ruta: null } : null;
}

/** Variantes activas del producto en el país, con sus opciones (p. ej. «100 ml · AVT-100»). */
export async function variantesDeProducto(cliente: Cliente, productId: string, pais: Pais): Promise<VarianteDestino[]> {
  const { data } = await cliente
    .from('product_variants')
    .select('id, sku, option_value_ids, sort_order, variant_countries!inner(country_code, is_active)')
    .eq('product_id', productId)
    .eq('variant_countries.country_code', pais)
    .eq('variant_countries.is_active', true)
    .order('sort_order', { ascending: true });
  type Fila = { id: string; sku: string; option_value_ids: string[] };
  const filas = (data ?? []) as unknown as Fila[];
  const ids = [...new Set(filas.flatMap((f) => f.option_value_ids ?? []))];
  const valores = new Map<string, string>();
  if (ids.length > 0) {
    const r = await cliente.from('product_option_values').select('id, value').in('id', ids);
    for (const v of (r.data ?? []) as { id: string; value: string }[]) valores.set(v.id, v.value);
  }
  return filas.map((f) => {
    const opciones = (f.option_value_ids ?? []).map((i) => valores.get(i)).filter(Boolean);
    return { id: f.id, sku: f.sku, etiqueta: `${opciones.length > 0 ? `${opciones.join(' · ')} — ` : ''}${f.sku}` };
  });
}

export type CategoriaOpcion = { id: string; slug: string; name: string };

/** Categorías visibles en el país, para el selector del destino y del banner de categoría. */
export async function categoriasVisibles(cliente: Cliente, pais: Pais): Promise<CategoriaOpcion[]> {
  const { data } = await cliente
    .from('category_countries')
    .select('categories(id, slug, name, sort_order)')
    .eq('country_code', pais)
    .eq('is_visible', true);
  type Fila = { categories: { id: string; slug: string; name: string; sort_order: number } | null };
  return ((data ?? []) as unknown as Fila[])
    .map((f) => f.categories)
    .filter((c): c is NonNullable<Fila['categories']> => c !== null)
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'es'))
    .map(({ id, slug, name }) => ({ id, slug, name }));
}

/**
 * Convierte la elección del formulario en la ruta que seguirá la tienda y comprueba, en el servidor, que el
 * producto (y la variante) o la categoría existen y están visibles en el país: nunca se confía en el navegador.
 */
export async function resolverDestinoBd(
  cliente: Cliente,
  d: Pick<DatosBanner, 'country_code' | 'destino_tipo' | 'destino_producto_id' | 'destino_variante_id' | 'destino_categoria_id' | 'destino_url'>,
): Promise<{ ok: true; url: string | null } | { ok: false; errores: Record<string, string> }> {
  const pais = d.country_code;
  const nombrePais = pais === 'CO' ? 'Colombia' : 'Ecuador';
  switch (d.destino_tipo) {
    case 'ninguno':
      return { ok: true, url: null };
    case 'url': {
      if (!esUrlDestinoValida(d.destino_url)) return { ok: false, errores: { destino_url: 'La dirección no es válida.' } };
      if (apuntaAOtroPais(d.destino_url, pais)) {
        return { ok: false, errores: { destino_url: `Este banner es de ${nombrePais}: no puede llevar a una página de otro país.` } };
      }
      // Una ruta de categoría o producto escrita a mano se comprueba igual que la elegida en el selector.
      const escrito = destinoDeUrl(d.destino_url);
      if (escrito.tipo === 'categoria') {
        const cats = await categoriasVisibles(cliente, pais);
        if (!cats.some((x) => x.slug === escrito.slug)) {
          return { ok: false, errores: { destino_url: `Esa categoría no está visible en ${nombrePais}.` } };
        }
      } else if (escrito.tipo === 'producto') {
        const { data } = await cliente.from('catalog_listing').select('is_visible').eq('slug', escrito.slug).eq('country_code', pais).maybeSingle();
        if (!(data as { is_visible: boolean } | null)?.is_visible) {
          return { ok: false, errores: { destino_url: `Ese producto no está visible en ${nombrePais}.` } };
        }
      }
      return { ok: true, url: urlDeDestino({ tipo: 'url', url: d.destino_url }, pais) };
    }
    case 'producto': {
      const { data } = await cliente
        .from('catalog_listing')
        .select('slug, is_visible')
        .eq('product_id', d.destino_producto_id ?? '')
        .eq('country_code', pais)
        .maybeSingle();
      const fila = data as { slug: string; is_visible: boolean } | null;
      if (!fila?.is_visible) {
        return { ok: false, errores: { destino_producto_id: `Ese producto no está visible en ${nombrePais}.` } };
      }
      let sku: string | null = null;
      if (d.destino_variante_id) {
        const variantes = await variantesDeProducto(cliente, d.destino_producto_id ?? '', pais);
        const v = variantes.find((x) => x.id === d.destino_variante_id);
        if (!v) return { ok: false, errores: { destino_variante_id: `Esa variante no está activa en ${nombrePais}.` } };
        sku = v.sku;
      }
      return { ok: true, url: urlDeDestino({ tipo: 'producto', slug: fila.slug, sku }, pais) };
    }
    case 'categoria': {
      const cats = await categoriasVisibles(cliente, pais);
      const c = cats.find((x) => x.id === d.destino_categoria_id);
      if (!c) return { ok: false, errores: { destino_categoria_id: `Esa categoría no está visible en ${nombrePais}.` } };
      return { ok: true, url: urlDeDestino({ tipo: 'categoria', slug: c.slug }, pais) };
    }
  }
}

export type DestinoEditable = {
  tipo: Destino['tipo'];
  producto: ProductoVisible | null;
  varianteId: string | null;
  categoriaId: string | null;
  url: string;
};

/** Reconstruye lo elegido a partir de `link_url` (el esquema aún no guarda el destino por separado). */
export async function destinoEditable(cliente: Cliente, pais: Pais, linkUrl: string | null): Promise<DestinoEditable> {
  const d = destinoDeUrl(linkUrl);
  const vacio: DestinoEditable = { tipo: d.tipo, producto: null, varianteId: null, categoriaId: null, url: '' };
  if (d.tipo === 'url') return { ...vacio, url: d.url };
  if (d.tipo === 'producto') {
    const producto = await productoVisiblePorSlug(cliente, pais, d.slug);
    if (!producto) return { ...vacio, tipo: 'url', url: linkUrl ?? '' }; // ya no está visible: se conserva la ruta tal cual
    const variantes = d.sku ? await variantesDeProducto(cliente, producto.id, pais) : [];
    return { ...vacio, producto, varianteId: variantes.find((v) => v.sku === d.sku)?.id ?? null };
  }
  if (d.tipo === 'categoria') {
    const c = (await categoriasVisibles(cliente, pais)).find((x) => x.slug === d.slug);
    return c ? { ...vacio, categoriaId: c.id } : { ...vacio, tipo: 'url', url: linkUrl ?? '' };
  }
  return vacio;
}

// ── Escritura ────────────────────────────────────────────────────────────────────────────────────

async function mediaExiste(cliente: Cliente, ids: string[]): Promise<boolean> {
  // Solo imágenes subidas como banner: no se enlaza una foto de garantía o de reseña (privadas) a una pieza pública.
  const { data } = await cliente.from('media').select('id, kind').in('id', ids);
  const validas = (data ?? []).filter((m) => (m as { kind: string }).kind === 'banner');
  return new Set(validas.map((m) => (m as { id: string }).id)).size === new Set(ids).size;
}

export async function guardarBannerBd(args: Ctx & { datos: DatosBanner }): Promise<ResultadoAccion> {
  const { cliente, datos, actor, ip } = args;
  if (!(await mediaExiste(cliente, [datos.desktop_media_id, datos.mobile_media_id ?? datos.desktop_media_id]))) {
    return { ok: false, mensaje: 'Revisa los campos marcados.', errores: { desktop_media_id: 'La imagen ya no existe. Vuelve a subirla.' } };
  }
  const destino = await resolverDestinoBd(cliente, datos);
  if (!destino.ok) return { ok: false, mensaje: 'Revisa los campos marcados.', errores: destino.errores };
  const fila = columnasBanner(datos, destino.url);

  if (datos.id) {
    const { data: antes } = await cliente.from('banners').select('*').eq('id', datos.id).maybeSingle();
    if (!antes) return { ok: false, mensaje: 'Ese banner ya no existe.' };
    const previo = antes as Record<string, unknown>;
    // Cambiar de país o de ubicación lo manda al final de su nueva lista.
    const cambioLista = previo.country_code !== fila.country_code || previo.placement !== fila.placement;
    const cambios = cambioLista ? { ...fila, sort_order: (await siguienteOrden(cliente, datos.country_code, datos.placement)) } : fila;
    const { error } = await cliente.from('banners').update(cambios).eq('id', datos.id);
    if (error) return { ok: false, ...traducirErrorBd(error) };
    await auditarCambio({ actor, accion: 'banners.actualizado', entidad: 'banners', entidadId: datos.id, diff: diffCampos(previo, cambios), ip });
    invalidarContenido([datos.country_code, previo.country_code as Pais]);
    return { ok: true, id: datos.id };
  }

  const nueva = { ...fila, sort_order: await siguienteOrden(cliente, datos.country_code, datos.placement) };
  const { data, error } = await cliente.from('banners').insert(nueva).select('id').single();
  if (error) return { ok: false, ...traducirErrorBd(error) };
  await auditarCambio({ actor, accion: 'banners.creado', entidad: 'banners', entidadId: data.id as string, diff: { despues: nueva }, ip });
  invalidarContenido([datos.country_code]);
  return { ok: true, id: data.id as string };
}

async function siguienteOrden(cliente: Cliente, pais: Pais, ubicacion: Ubicacion): Promise<number> {
  const { data } = await cliente
    .from('banners')
    .select('sort_order')
    .eq('country_code', pais)
    .eq('placement', ubicacion)
    .order('sort_order', { ascending: false })
    .limit(1);
  const max = (data as { sort_order: number }[] | null)?.[0]?.sort_order ?? 0;
  return max + PASO;
}

export async function alternarBannerBd(args: Ctx & { id: string; activo: boolean }): Promise<ResultadoAccion> {
  const { cliente, id, activo, actor, ip } = args;
  const { data: antes } = await cliente.from('banners').select('country_code, is_active').eq('id', id).maybeSingle();
  if (!antes) return { ok: false, mensaje: 'Ese banner ya no existe.' };
  const { error } = await cliente.from('banners').update({ is_active: activo }).eq('id', id);
  if (error) return { ok: false, ...traducirErrorBd(error) };
  await auditarCambio({
    actor,
    accion: activo ? 'banners.activado' : 'banners.desactivado',
    entidad: 'banners',
    entidadId: id,
    diff: { antes: { is_active: (antes as { is_active: boolean }).is_active }, despues: { is_active: activo } },
    ip,
  });
  invalidarContenido([(antes as { country_code: Pais }).country_code]);
  return { ok: true };
}

/** Sube o baja un banner una posición dentro de su país y ubicación; renumera 10, 20, 30… solo lo que cambia. */
export async function moverBannerBd(args: Ctx & { id: string; direccion: 'arriba' | 'abajo' }): Promise<ResultadoAccion> {
  const { cliente, id, direccion, actor, ip } = args;
  const { data: actual } = await cliente.from('banners').select('country_code, placement').eq('id', id).maybeSingle();
  if (!actual) return { ok: false, mensaje: 'Ese banner ya no existe.' };
  const { country_code: pais, placement } = actual as { country_code: Pais; placement: Ubicacion };
  const { data } = await cliente
    .from('banners')
    .select('id, sort_order')
    .eq('country_code', pais)
    .eq('placement', placement)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  const filas = (data ?? []) as { id: string; sort_order: number }[];
  const orden = moverEnLista(filas.map((f) => f.id), id, direccion);
  for (const [i, bid] of orden.entries()) {
    const nuevo = (i + 1) * PASO;
    if (filas.find((f) => f.id === bid)?.sort_order === nuevo) continue;
    const { error } = await cliente.from('banners').update({ sort_order: nuevo }).eq('id', bid);
    if (error) return { ok: false, ...traducirErrorBd(error) };
  }
  await auditarCambio({ actor, accion: 'banners.movido', entidad: 'banners', entidadId: id, diff: { despues: { direccion, country_code: pais, placement } }, ip });
  invalidarContenido([pais]);
  return { ok: true };
}

export async function eliminarBannerBd(args: Ctx & { id: string }): Promise<ResultadoAccion> {
  const { cliente, id, actor, ip } = args;
  const { data: antes } = await cliente.from('banners').select('*').eq('id', id).maybeSingle();
  if (!antes) return { ok: true };
  const { error } = await cliente.from('banners').delete().eq('id', id);
  if (error) return { ok: false, ...traducirErrorBd(error) };
  // Las imágenes quedan en `media` (huérfanas): hoy ningún job las limpia. Borrarlas del disco exige que
  // `media_file_deletions` admita ese motivo (izao-db; su `reason` solo acepta 'anonimizacion'). Pendiente en la bitácora.
  await auditarCambio({ actor, accion: 'banners.eliminado', entidad: 'banners', entidadId: id, diff: { antes }, ip });
  invalidarContenido([(antes as { country_code: Pais }).country_code]);
  return { ok: true };
}
