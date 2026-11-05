/**
 * Lectura real de la tienda: RPC `catalog_*` (izao-db) y selects públicos por país.
 * Solo servidor, con el rol de servicio (RLS niega todo a `anon`). Nunca se devuelven costos,
 * stock reservado ni IDs de MasterShop. El contenido se cachea con las etiquetas de §6.5 para que
 * el panel lo invalide con `revalidateTag('content:{país}')` / `catalog:{país}`.
 */
import 'server-only';
import { unstable_cache } from 'next/cache';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';
import { catalogPage, catalogProduct, catalogRelated, catalogSearchPage, catalogSuggest, type CursorCatalogo, type FiltrosCatalogoDb } from '@/lib/db/catalogo';
import type { ConsultaCatalogo, ContenidoHome, TiendaRepo } from './repo';
import { aFiltrosRpc } from './filtros';
import type {
  AjustesTienda,
  Anuncio,
  Banner,
  CategoriaMenu,
  CodigoPais,
  EspacioContenido,
  FichaProducto,
  ItemCatalogo,
  MediaRef,
  OpcionesFiltros,
  PaginaCatalogo,
  PaginaLegal,
  PaginaListada,
  ResenaHome,
  SeccionHome,
  Sugerencias,
  TipoPagina,
} from './types';
import { bannerVigente } from './banners';
import { etiquetasPagina } from './etiquetas';
import { normalizarTipo, ordenarPaginas } from './paginas';

type Fila = Record<string, unknown>;

const MEDIA = 'variants,lqip,alt,width,height';

function db() {
  return crearClienteServicio();
}

function ok<T>(res: { data: T | null; error: { message: string } | null }, ctx: string): T | null {
  if (res.error) throw new Error(`${ctx}: ${res.error.message}`);
  return res.data;
}

const lista = (v: unknown): Fila[] => (Array.isArray(v) ? (v as Fila[]) : []);
const texto = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const media = (v: unknown): MediaRef | null => (v && typeof v === 'object' ? (v as MediaRef) : null);
const upper = (p: CodigoPais) => p.toUpperCase();

function conCache<A extends unknown[], R>(nombre: string, segundos: number, etiquetas: (p: CodigoPais, ...a: NoInfer<A>) => string[], fn: (p: CodigoPais, ...a: A) => Promise<R>) {
  return (p: CodigoPais, ...a: A): Promise<R> =>
    unstable_cache(() => fn(p, ...a), [nombre, p, ...a.map(String)], { revalidate: segundos, tags: etiquetas(p, ...a) })();
}
// El panel invalida con el código de país en MAYÚSCULAS (`content:CO`): las etiquetas distinguen mayúsculas.
const contenido = (p: CodigoPais, ..._a: unknown[]) => [`content:${p.toUpperCase()}`];
const catalogo = (p: CodigoPais, ..._a: unknown[]) => [`catalog:${p.toUpperCase()}`];
// Páginas: `content:{país}` (lo invalida el panel al guardar) y las finas de `etiquetasPagina` (ver lib/store/etiquetas.ts).
const paginasTag = (p: CodigoPais, ..._a: unknown[]) => [...contenido(p), ...etiquetasPagina(p)];

// --- Contenido ----------------------------------------------------------------------------------------------

const leerTema = conCache('tema', 300, contenido, async (p) => {
  const [s, o] = await Promise.all([
    db().from('site_settings').select('color_tokens,typography').maybeSingle(),
    db().from('theme_overrides').select('tokens').eq('country_code', upper(p)).maybeSingle(),
  ]);
  const base = ok(s, 'site_settings') as Fila | null;
  const over = ok(o, 'theme_overrides') as Fila | null;
  return {
    colorTokens: (base?.color_tokens as Record<string, unknown>) ?? {},
    tipografia: (base?.typography as Record<string, unknown>) ?? {},
    overridePais: (over?.tokens as Record<string, unknown>) ?? null,
  };
});

const leerAjustes = conCache('ajustes', 300, contenido, async (p): Promise<AjustesTienda> => {
  const [s, c] = await Promise.all([
    db()
      .from('site_settings')
      .select(`store_name,social_links,legal_info,logo:media!logo_media_id(${MEDIA}),og:media!og_image_media_id(${MEDIA})`)
      .maybeSingle(),
    db()
      .from('countries')
      .select('name,currency_code,country_settings(announcement_rotation_seconds,advisor_whatsapp,hide_out_of_stock)')
      .eq('code', upper(p))
      .maybeSingle(),
  ]);
  const site = ok(s, 'site_settings') as Fila | null;
  const pais = ok(c, 'countries') as Fila | null;
  const cs = (Array.isArray(pais?.country_settings) ? pais?.country_settings[0] : pais?.country_settings) as Fila | undefined;
  return {
    nombreTienda: texto(site?.store_name) ?? '',
    logo: media(site?.logo),
    ogImagen: media(site?.og),
    redes: (site?.social_links as Record<string, string>) ?? {},
    rotacionAnunciosSegundos: Number(cs?.announcement_rotation_seconds ?? 4),
    whatsappAsesor: texto(cs?.advisor_whatsapp),
    ocultarAgotados: Boolean(cs?.hide_out_of_stock),
    moneda: pais?.currency_code === 'USD' ? 'USD' : 'COP',
    nombrePais: texto(pais?.name) ?? '',
    legal: (site?.legal_info as Record<string, string>) ?? {},
  };
});

const leerAnuncios = conCache('anuncios', 300, contenido, async (p): Promise<Anuncio[]> => {
  const r = ok(
    await db().from('announcements').select('id,text,link_url,icon').eq('country_code', upper(p)).eq('is_active', true).order('sort_order'),
    'announcements',
  );
  return lista(r) as unknown as Anuncio[];
});

const leerMenu = conCache('menu', 300, contenido, async (p): Promise<CategoriaMenu[]> => {
  const r = ok(
    await db()
      .from('category_countries')
      .select(`sort_order,category:categories!inner(id,parent_id,name,slug,show_in_menu,sort_order,image:media!image_id(${MEDIA}))`)
      .eq('country_code', upper(p))
      .eq('is_visible', true)
      .eq('category.show_in_menu', true),
    'categories',
  );
  const cats = lista(r)
    .map((x): Fila & { orden: number } => ({ ...(x.category as Fila), orden: Number(x.sort_order ?? 0) }))
    .sort((a, b) => a.orden - b.orden || Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0));
  const nodo = (c: Fila): CategoriaMenu => ({
    id: String(c.id),
    name: String(c.name),
    slug: String(c.slug),
    image: media(c.image),
    children: [],
  });
  const raices = cats.filter((c) => !c.parent_id).map(nodo);
  const porId = new Map(raices.map((n) => [n.id, n]));
  for (const c of cats.filter((c) => c.parent_id)) porId.get(String(c.parent_id))?.children.push(nodo(c));
  return raices;
});

/**
 * Marcas con producto visible en el país. PostgREST no agrupa y limita las respuestas (Supabase: 1.000 filas), así que se
 * recorre `catalog_listing` por marca con paginación por clave (`brand_slug` mayor al último visto): no depende de un tope
 * de filas y cada página salta lo que le queda a la última marca.
 */
const PAGINA_MARCAS = 1000;
async function leerMarcas(p: CodigoPais): Promise<Map<string, string>> {
  const marcas = new Map<string, string>();
  let ultimo: string | null = null;
  for (let vuelta = 0; vuelta < 100; vuelta++) {
    let consulta = db()
      .from('catalog_listing')
      .select('brand_slug,brand_name')
      .eq('country_code', upper(p))
      .eq('is_visible', true)
      .not('brand_slug', 'is', null)
      .order('brand_slug')
      .limit(PAGINA_MARCAS);
    if (ultimo !== null) consulta = consulta.gt('brand_slug', ultimo);
    const filas = lista(ok(await consulta, 'marcas'));
    for (const m of filas) marcas.set(String(m.brand_slug), String(m.brand_name));
    if (filas.length < PAGINA_MARCAS) break;
    ultimo = String(filas[filas.length - 1]?.brand_slug);
  }
  return marcas;
}

const leerOpciones = conCache('opciones', 300, catalogo, async (p): Promise<OpcionesFiltros> => {
  const [generos, familias, conc, marcasUnicas, pmin, pmax, cats] = await Promise.all([
    db().from('genders').select('slug,name').order('sort_order'),
    db().from('olfactory_families').select('slug,name').order('sort_order'),
    db().from('concentrations').select('slug,name').order('sort_order'),
    leerMarcas(p),
    // Sin precio (null) no cuenta: en orden descendente Postgres pondría los null primero.
    db().from('catalog_listing').select('min_price').eq('country_code', upper(p)).eq('is_visible', true).not('min_price', 'is', null).order('min_price', { nullsFirst: false }).limit(1),
    db().from('catalog_listing').select('max_price').eq('country_code', upper(p)).eq('is_visible', true).not('max_price', 'is', null).order('max_price', { ascending: false, nullsFirst: false }).limit(1),
    db()
      .from('category_countries')
      .select('category:categories!inner(slug,name,sort_order)')
      .eq('country_code', upper(p))
      .eq('is_visible', true),
  ]);
  const slugName = (r: unknown) => lista(r).map((x) => ({ slug: String(x.slug), name: String(x.name) }));
  return {
    generos: slugName(ok(generos, 'genders')),
    familias: slugName(ok(familias, 'olfactory_families')),
    concentraciones: slugName(ok(conc, 'concentrations')),
    marcas: [...marcasUnicas].map(([slug, name]) => ({ slug, name })).sort((a, b) => a.name.localeCompare(b.name, 'es')),
    categorias: slugName(lista(ok(cats, 'categorias')).map((x) => x.category)),
    precioMin: Number(lista(ok(pmin, 'precio min'))[0]?.min_price ?? 0),
    precioMax: Number(lista(ok(pmax, 'precio max'))[0]?.max_price ?? 0),
  };
});

const leerPopulares = conCache('populares', 300, contenido, async (p): Promise<string[]> => {
  const r = ok(
    await db().from('content_slots').select('body').eq('key', 'busquedas_populares').eq('is_active', true).or(`country_code.eq.${upper(p)},country_code.is.null`).order('country_code', { nullsFirst: false }).limit(1),
    'busquedas_populares',
  );
  const body = texto(lista(r)[0]?.body);
  return body ? body.split(/[\n,]/).map((s) => s.trim()).filter(Boolean).slice(0, 8) : [];
});

const leerEspacios = conCache('espacios', 300, contenido, async (p): Promise<EspacioContenido[]> => {
  const r = ok(
    await db()
      .from('content_slots')
      .select(`key,country_code,title,body,link_url,media:media!media_id(${MEDIA}),mobile_media:media!mobile_media_id(${MEDIA})`)
      .eq('is_active', true)
      .or(`country_code.eq.${upper(p)},country_code.is.null`),
    'content_slots',
  );
  // Si existe el espacio del país y el global, gana el del país.
  const porClave = new Map<string, Fila>();
  for (const e of lista(r)) {
    const previo = porClave.get(String(e.key));
    if (!previo || (previo.country_code === null && e.country_code !== null)) porClave.set(String(e.key), e);
  }
  return [...porClave.values()] as unknown as EspacioContenido[];
});

const leerHome = conCache('home', 300, (p: CodigoPais, ..._a: unknown[]) => [...contenido(p), ...catalogo(p)], async (p): Promise<ContenidoHome> => {
  const ahora = new Date();
  const [sec, ban, espacios, col, res, fam, menu] = await Promise.all([
    db().from('home_sections').select('id,type,config').eq('country_code', upper(p)).eq('is_active', true).order('sort_order'),
    db()
      .from('banners')
      .select(
        `id,placement,alt,title,subtitle,cta_label,link_url,text_position,text_color,starts_at,ends_at,desktop:media!desktop_media_id(${MEDIA}),mobile:media!mobile_media_id(${MEDIA})`,
      )
      .eq('country_code', upper(p))
      .eq('is_active', true)
      .order('sort_order'),
    leerEspacios(p),
    db().from('collections').select('id,name,slug,sort_order').eq('country_code', upper(p)).eq('is_active', true).eq('show_in_home_tabs', true).order('sort_order'),
    db().from('reviews').select('id,author_name,city,rating,body').eq('country_code', upper(p)).eq('status', 'approved').eq('featured_home', true).order('created_at', { ascending: false }).limit(12),
    db().from('olfactory_families').select(`slug,name`).order('sort_order'),
    leerMenu(p),
  ]);
  const secciones = lista(ok(sec, 'home_sections')) as unknown as SeccionHome[];
  const banners = lista(ok(ban, 'banners'))
    .filter((b) => bannerVigente({ starts_at: b.starts_at as string | null, ends_at: b.ends_at as string | null }, ahora))
    .filter((b) => b.desktop && b.mobile) as unknown as Banner[];
  const colecciones: ContenidoHome['colecciones'] = await Promise.all(
    lista(ok(col, 'collections')).map(async (c) => {
      const pagina = await catalogPage(p, { filtros: { collection: String(c.slug) }, limite: 8 }).catch(() => null);
      return { id: String(c.id), name: String(c.name), slug: String(c.slug), items: (pagina?.items ?? []) as unknown as ItemCatalogo[] };
    }),
  ).then((t) => t.filter((c) => c.items.length > 0));
  return {
    secciones,
    banners,
    espacios,
    colecciones,
    resenas: lista(ok(res, 'reviews')) as unknown as ResenaHome[],
    familias: lista(ok(fam, 'families')).map((f) => ({ slug: String(f.slug), name: String(f.name), image: null })),
    categorias: menu,
  };
});

const COLUMNAS_PAGINA = 'slug,kind,title,content_html,version,updated_at,seo_title,seo_description';

function aPaginaLegal(r: unknown): PaginaLegal | null {
  if (!r || typeof r !== 'object') return null;
  return { ...(r as Omit<PaginaLegal, 'kind'>), kind: normalizarTipo((r as Fila).kind) };
}

const leerLegal = conCache(
  'legal',
  300,
  (p, slug: string) => [...paginasTag(p), ...etiquetasPagina(p, undefined, slug)],
  async (p, slug: string): Promise<PaginaLegal | null> =>
    aPaginaLegal(ok(await db().from('pages').select(COLUMNAS_PAGINA).eq('country_code', upper(p)).eq('slug', slug).eq('status', 'published').maybeSingle(), 'pages')),
);

/** Una sola publicada por país y tipo (índice único parcial de izao-db): se elige por `kind`, nunca por slug ni título. */
const leerPaginaPorTipo = conCache(
  'legal-tipo',
  300,
  (p, kind: Exclude<TipoPagina, 'general'>) => [...paginasTag(p), ...etiquetasPagina(p, kind)],
  async (p, kind: Exclude<TipoPagina, 'general'>): Promise<PaginaLegal | null> =>
    aPaginaLegal(ok(await db().from('pages').select(COLUMNAS_PAGINA).eq('country_code', upper(p)).eq('kind', kind).eq('status', 'published').maybeSingle(), 'pages')),
);

const leerColeccion = conCache('coleccion', 300, catalogo, async (p, slug: string): Promise<{ slug: string; name: string } | null> => {
  const r = ok(await db().from('collections').select('slug,name').eq('country_code', upper(p)).eq('slug', slug).eq('is_active', true).maybeSingle(), 'collections');
  return r ? { slug: String((r as Fila).slug), name: String((r as Fila).name) } : null;
});

const leerPaginas = conCache('paginas', 300, paginasTag, async (p): Promise<PaginaListada[]> => {
  const r = ok(await db().from('pages').select('slug,title,kind').eq('country_code', upper(p)).eq('status', 'published').order('title'), 'pages');
  return ordenarPaginas(lista(r).map((x) => ({ slug: String(x.slug), title: String(x.title), kind: normalizarTipo(x.kind) })));
});

// --- Catálogo (RPC) -----------------------------------------------------------------------------------------

export const repoSupabase: TiendaRepo = {
  tema: leerTema,
  ajustes: leerAjustes,
  anuncios: leerAnuncios,
  menu: leerMenu,
  opcionesFiltros: leerOpciones,
  busquedasPopulares: leerPopulares,
  home: leerHome,
  espacios: leerEspacios,
  paginaLegal: leerLegal,
  paginaPorTipo: leerPaginaPorTipo,
  coleccion: leerColeccion,
  paginas: leerPaginas,

  catalogo(pais, c: ConsultaCatalogo) {
    const filtros = { ...aFiltrosRpc(c.filtros), ...(c.conTotal ? { with_total: true } : {}) } as FiltrosCatalogoDb;
    const cursor = c.cursor as CursorCatalogo | null;
    const consulta = async () =>
      (c.q
        ? await catalogSearchPage(pais, { q: c.q, filtros, orden: c.orden, cursor, limite: c.limite })
        : await catalogPage(pais, { filtros, orden: c.orden === 'relevance' ? 'featured' : c.orden, cursor, limite: c.limite })) as unknown as PaginaCatalogo;
    // Redis (60 s) llega con el worker; mientras tanto, caché de Next por clave normalizada.
    return unstable_cache(consulta, ['catalogo', pais, JSON.stringify({ filtros, o: c.orden, cursor, l: c.limite, q: c.q ?? '' })], {
      revalidate: 60,
      tags: catalogo(pais),
    })();
  },

  async sugerencias(pais, q, limite) {
    return (await catalogSuggest(pais, q, limite)) as unknown as Sugerencias;
  },

  producto(pais, slug) {
    return unstable_cache(async () => (await catalogProduct(pais, slug)) as unknown as FichaProducto | null, ['producto', pais, slug], {
      revalidate: 300,
      tags: catalogo(pais),
    })();
  },

  relacionados(pais, productoId, limite) {
    return unstable_cache(
      async () => (await catalogRelated(pais, productoId, limite)) as unknown as ItemCatalogo[],
      ['relacionados', pais, productoId, String(limite)],
      { revalidate: 300, tags: catalogo(pais) },
    )();
  },
};
