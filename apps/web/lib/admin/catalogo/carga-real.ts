/**
 * Carga del catálogo real (Excel de MasterShop) en Izao. Código puro: convierte la tabla del Excel en productos
 * normalizados (una variante por producto, SKU del Excel), limpia los textos (regla 7: sin emojis, sin
 * afirmaciones de originalidad/certificados/afiliación, sin menciones de otra tienda) y genera el SQL idempotente.
 *
 * Reglas del mapeo:
 *  - Dinero: COP en pesos enteros (`bigint`, exponente 0). Nunca decimales.
 *  - Género y categoría de Izao por prefijo del SKU: `MEN` -> hombre, `WOM` -> mujer.
 *  - Solo Colombia (CO). Ecuador sin precio: no se crea nada para EC.
 *  - Stock 0 y producto NO visible: el stock y la publicación son decisión del dueño ([COMPLETAR]).
 *  - Nunca se borra ni se pisan ediciones del panel: solo se insertan los SKU que aún no existen.
 */
import { slugificar } from '../crud/comun';

export const PAIS_CARGA = 'CO';

export const COLUMNAS_EXCEL = {
  nombre: 'Nombre_del_Producto*',
  descripcion: 'Descripción*',
  variable: 'Producto_Variable (SI/NO)*',
  precio: 'Precio*',
  peso: 'Peso_kg*',
  sku: 'SKU',
} as const;

export type AvisoTexto = {
  tipo: 'tienda' | 'imitacion' | 'afirmacion' | 'palabra' | 'truncada' | 'truncada_sin_corte' | 'texto_corto';
  detalle: string;
};

export type ProductoCarga = {
  fila: number;
  sku: string;
  nombre: string;
  nombreOriginal: string;
  slug: string;
  generoSlug: 'hombre' | 'mujer';
  categoriaSlug: 'hombre' | 'mujer';
  precioCo: number;
  pesoKg: number;
  descripcionHtml: string;
  descripcionCorta: string;
  /** `active` (se publica luego) o `draft` (fila de ejemplo/duplicado que el dueño decide). */
  estado: 'active' | 'draft';
  avisos: AvisoTexto[];
  /** Motivos por los que conviene que una persona lo revise. */
  revisar: string[];
  /** Sugerencia del texto (no cambia el género asignado por prefijo). */
  generoSegunTexto: 'hombre' | 'mujer' | null;
};

export type ProblemaFila = { fila: number; sku: string | null; mensaje: string };

export type ResultadoCarga = {
  productos: ProductoCarga[];
  problemas: ProblemaFila[];
  duplicadosNombre: { nombre: string; skus: string[] }[];
};

// ---------------------------------------------------------------------------------------------------------------
// Limpieza de texto
// ---------------------------------------------------------------------------------------------------------------

const EMOJI = '[\\p{Extended_Pictographic}\\p{Emoji_Presentation}\\p{Regional_Indicator}\\u{1F3FB}-\\u{1F3FF}\\uFE0F\\u200D\\u20E3]';
// eslint-disable-next-line no-misleading-character-class -- los selectores y uniones de emoji van en la clase a propósito
const RE_EMOJI_RACHA = new RegExp(`(?:\\s*${EMOJI})+\\s*`, 'gu');
const MARCA = '\u0001';

const RE_TIENDA = /ameli[eé]|\bstore\b|nuestra tienda|en tienda\b|tienda oficial/i;
const RE_IMITACION = /\bdupe\b|\bclon(?:es)?\b|r[eé]plica|imitaci[oó]n|equivalente a|alternativa a|igual al? (?:original|perfume)/i;
const RE_AFIRMACION =
  /\boriginal(?:es|idad)?\b|certificad|certificaci[oó]n|\boficial(?:es)?\b|licencia|licenciad|afiliad|distribuidor|autorizad[oa]|garantiz|garant[ií]a de|marca registrada|\b100\s?%/i;
const RE_PALABRA = /\b(?:aut[eé]ntic[oa]s?|genuin[oa]s?)\b\s*/gi;
/** Comprobación final: nada de esto puede quedar en el texto publicado. */
export const RE_PROHIBIDO_FINAL = /original|aut[eé]ntic|genuin|certific|oficial|afiliad|licencia|dupe|r[eé]plica|ameli[eé]|\bstore\b/i;

function escaparHtml(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function normalizarClave(t: string): string {
  return t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function esTitulo(titulo: string, nombre: string, estricto = false): boolean {
  const t = normalizarClave(titulo);
  const n = normalizarClave(nombre);
  if (t.length === 0) return true;
  if (t.includes(n) || n.includes(t)) return true;
  if (estricto) return false;
  return /\d\s*ml\b/i.test(titulo) && titulo.length <= 100;
}

/** Corta un texto en oraciones (sin perder la puntuación). */
function oraciones(parrafo: string): string[] {
  return parrafo.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 0);
}

export type TextoLimpio = {
  parrafos: string[];
  html: string;
  corta: string;
  avisos: AvisoTexto[];
};

/** Limpia una descripción del Excel (regla 7). Conserva aroma, notas e «ideal para». */
export function limpiarDescripcion(bruto: string, nombre: string): TextoLimpio {
  const avisos: AvisoTexto[] = [];
  let t = bruto.replace(/\u00a0/g, ' ').replace(/\r/g, '').replace(/\\n/g, '\n');

  // Rachas de emojis -> marca. El encabezado «🌹 NOMBRE 100ML 🌹» se descarta si repite el nombre.
  t = t.replace(RE_EMOJI_RACHA, MARCA);
  t = t.replace(new RegExp(`^\\s*${MARCA}([^${MARCA}\\n]{3,100})${MARCA}`), (m, titulo: string) => (esTitulo(titulo, nombre) ? ' ' : m));
  t = t.replace(new RegExp(`([\\p{Ll}\\p{N})])\\s*${MARCA}\\s*(?=[\\p{Lu}])`, 'gu'), '$1. ');
  t = t.replace(new RegExp(MARCA, 'g'), ' ');
  // Encabezado sin emoji de cierre («Nombre – Marca 100ML Una fragancia…»): se descarta si repite el nombre.
  t = t.replace(/^\s*([^.!?\n]{3,110}?\b\d+\s*ml\b\)?)\s*/i, (m, titulo: string) => (esTitulo(titulo, nombre, true) ? '' : m));

  t = t
    .replace(/[ \t]+/g, ' ')
    .replace(/ ([.,;:!?])/g, '$1')
    .replace(/([\p{Ll}\p{N}])\.(?=\p{Lu})/gu, '$1. ')
    .replace(/ *\n */g, '\n')
    .trim();

  // Texto cortado por el origen («...» al final): se recorta a la última oración completa.
  if (/(?:\.{3}|…)\s*$/.test(t)) {
    const sinPuntos = t.replace(/(?:\.{3}|…)\s*$/, '').trimEnd();
    const corte = Math.max(sinPuntos.lastIndexOf('. '), sinPuntos.lastIndexOf('! '), sinPuntos.lastIndexOf('? '), sinPuntos.lastIndexOf('\n'));
    if (/[.!?]$/.test(sinPuntos)) {
      t = sinPuntos;
      avisos.push({ tipo: 'truncada', detalle: 'Texto cortado en el origen; ya terminaba en una oración completa.' });
    } else if (corte >= 0) {
      t = sinPuntos.slice(0, corte + 1).trimEnd();
      avisos.push({ tipo: 'truncada', detalle: 'Texto cortado en el origen; se recortó a la última oración completa.' });
    } else {
      const coma = sinPuntos.lastIndexOf(',');
      t = (coma >= 40 ? sinPuntos.slice(0, coma) : sinPuntos).replace(/[,;:\s]+$/, '') + '.';
      avisos.push({ tipo: 'truncada_sin_corte', detalle: 'Texto cortado en el origen y sin oración completa: se recortó a la última coma; revisar.' });
    }
  }

  // Etiquetas «Aroma:», «Ideal para:», «Notas…:» abren párrafo.
  t = t.replace(/\s*(?=\b(?:Aroma|Ideal para|Perfecta? para|Notas? (?:de (?:salida|coraz[oó]n|fondo|base|cabeza)|principales|olfativas)?)\s*:)/g, '\n');

  const parrafos: string[] = [];
  for (const linea of t.split('\n')) {
    const guardadas: string[] = [];
    for (const original of oraciones(linea)) {
      let o = original;
      if (RE_TIENDA.test(o)) {
        avisos.push({ tipo: 'tienda', detalle: o.slice(0, 80) });
        continue;
      }
      if (RE_IMITACION.test(o)) {
        avisos.push({ tipo: 'imitacion', detalle: o.slice(0, 80) });
        continue;
      }
      if (RE_AFIRMACION.test(o)) {
        avisos.push({ tipo: 'afirmacion', detalle: o.slice(0, 80) });
        continue;
      }
      if (RE_PALABRA.test(o)) {
        RE_PALABRA.lastIndex = 0;
        avisos.push({ tipo: 'palabra', detalle: o.slice(0, 80) });
        o = o.replace(RE_PALABRA, '');
      }
      RE_PALABRA.lastIndex = 0;
      o = o.replace(/\s{2,}/g, ' ').trim();
      if (o.replace(/[^\p{L}\p{N}]/gu, '').length >= 3) guardadas.push(o);
    }
    if (guardadas.length > 0) parrafos.push(guardadas.join(' '));
  }

  const plano = parrafos.join(' ');
  if (plano.length < 80) avisos.push({ tipo: 'texto_corto', detalle: `Quedaron ${plano.length} caracteres.` });

  // Descripción corta: oraciones completas del primer párrafo hasta ~200 caracteres.
  let corta = '';
  for (const o of oraciones(parrafos[0] ?? '')) {
    if ((corta + ' ' + o).trim().length > 200) break;
    corta = (corta + ' ' + o).trim();
  }
  if (corta === '' && parrafos[0]) corta = parrafos[0].slice(0, 197).replace(/\s+\S*$/, '') + '…';

  const html = parrafos.map((p) => `<p>${escaparHtml(p)}</p>`).join('');
  return { parrafos, html, corta, avisos };
}

// ---------------------------------------------------------------------------------------------------------------
// Nombre
// ---------------------------------------------------------------------------------------------------------------

const SIGLAS = new Set(["EDP", "EDT", "EDC", "VIP", "XS", "XL", "XO"]);
const MINUSCULAS = new Set(['de', 'del', 'la', 'el', 'y', 'en', 'para', 'pour', 'by', 'and', 'for']);

/** Espacios normalizados; «100ML» -> «100 ml»; si todo está en mayúsculas pasa a «Título». */
export function normalizarNombre(bruto: string): string {
  let n = bruto.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  const letras = n.replace(/\d+\s*ml\b/gi, '').replace(/[^\p{L}]/gu, '');
  n = n.replace(/(\d)\s*ml\b/gi, '$1 ml');
  if (letras.length > 0 && letras === letras.toUpperCase()) {
    n = n.replace(/\p{L}[\p{L}']*/gu, (w: string, pos: number) => {
      if (w === 'ml' || SIGLAS.has(w)) return w;
      if (w.length === 1 || !/[aeiouáéíóú]/i.test(w)) return w; // D&G, EDP, DKNY, YSL
      const bajo = w.toLowerCase();
      if (pos > 0 && MINUSCULAS.has(bajo)) return bajo;
      return bajo.replace(/(^|')(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase());
    });
  }
  return n;
}

// ---------------------------------------------------------------------------------------------------------------
// Construcción del lote
// ---------------------------------------------------------------------------------------------------------------

function generoDeTexto(texto: string): 'hombre' | 'mujer' | null {
  const f = /\b(?:mujer(?:es)?|femenin[oa]s?)\b/i.test(texto);
  const m = /\b(?:hombres?|masculin[oa]s?)\b/i.test(texto);
  if (f && !m) return 'mujer';
  if (m && !f) return 'hombre';
  return null;
}

export type OpcionesCarga = {
  /** SKU que se cargan como borrador (no se publican solos) y el motivo. */
  borradores?: Readonly<Record<string, string>>;
};

export function construirCarga(tabla: readonly (readonly string[])[], opciones: OpcionesCarga = {}): ResultadoCarga {
  const problemas: ProblemaFila[] = [];
  const productos: ProductoCarga[] = [];
  const encabezado = (tabla[0] ?? []).map((h) => h.trim());
  const idx = (nombre: string): number => encabezado.indexOf(nombre);
  const col = Object.fromEntries(Object.entries(COLUMNAS_EXCEL).map(([k, v]) => [k, idx(v)])) as Record<keyof typeof COLUMNAS_EXCEL, number>;
  for (const [k, i] of Object.entries(col)) {
    if (i < 0) {
      problemas.push({ fila: 1, sku: null, mensaje: `Falta la columna «${COLUMNAS_EXCEL[k as keyof typeof COLUMNAS_EXCEL]}».` });
    }
  }
  if (problemas.length > 0) return { productos, problemas, duplicadosNombre: [] };

  const vistos = new Map<string, number>();
  const slugs = new Set<string>();
  for (let i = 1; i < tabla.length; i++) {
    const f = tabla[i] ?? [];
    if (f.every((c) => (c ?? '').trim() === '')) continue;
    const fila = i + 1;
    const celda = (k: keyof typeof COLUMNAS_EXCEL): string => (f[col[k]] ?? '').trim();
    const sku = celda('sku').toUpperCase().replace(/\s+/g, '');
    const err = (mensaje: string): void => void problemas.push({ fila, sku: sku || null, mensaje });

    const m = /^IZAO-(MEN|WOM)-(\d{3})$/.exec(sku);
    if (!m) {
      err(`SKU «${celda('sku')}» no tiene el formato IZAO-MEN-NNN / IZAO-WOM-NNN.`);
      continue;
    }
    if (vistos.has(sku)) {
      err(`SKU repetido (ya aparece en la fila ${vistos.get(sku)}).`);
      continue;
    }
    vistos.set(sku, fila);
    if (celda('variable').toUpperCase() !== 'NO') {
      err('Producto_Variable distinto de NO: esta carga solo admite una variante por producto.');
      continue;
    }
    const precioTxt = celda('precio');
    if (!/^\d{1,12}$/.test(precioTxt) || Number(precioTxt) <= 0) {
      err(`Precio «${precioTxt}» no es un entero positivo en COP.`);
      continue;
    }
    const peso = Number(celda('peso').replace(',', '.'));
    if (!Number.isFinite(peso) || peso <= 0 || peso >= 100000) {
      err(`Peso «${celda('peso')}» inválido.`);
      continue;
    }
    const nombreOriginal = celda('nombre');
    if (nombreOriginal === '') {
      err('Nombre vacío.');
      continue;
    }
    const nombre = normalizarNombre(nombreOriginal);
    const generoSlug = m[1] === 'MEN' ? 'hombre' : 'mujer';

    const texto = limpiarDescripcion(celda('descripcion'), nombre);
    if (RE_PROHIBIDO_FINAL.test(texto.html) || RE_PROHIBIDO_FINAL.test(nombre)) {
      err('Quedó una palabra prohibida (original, auténtico, certificado, oficial, afiliado…) tras la limpieza.');
      continue;
    }

    const revisar: string[] = [];
    if (texto.avisos.some((a) => a.tipo === 'truncada_sin_corte')) revisar.push('texto cortado en el origen sin oración completa');
    if (texto.avisos.some((a) => a.tipo === 'texto_corto')) revisar.push('descripción muy corta tras la limpieza');
    const segunTexto = generoDeTexto(`${nombre} ${texto.parrafos.join(' ')}`);
    if (segunTexto !== null && segunTexto !== generoSlug) revisar.push(`el texto habla de ${segunTexto}, el SKU es ${m[1]}`);
    const motivoBorrador = opciones.borradores?.[sku];
    if (motivoBorrador) revisar.push(motivoBorrador);

    productos.push({
      fila,
      sku,
      nombre,
      nombreOriginal,
      slug: '',
      generoSlug,
      categoriaSlug: generoSlug,
      precioCo: Number(precioTxt),
      pesoKg: peso,
      descripcionHtml: texto.html,
      descripcionCorta: texto.corta,
      estado: motivoBorrador ? 'draft' : 'active',
      avisos: texto.avisos,
      revisar,
      generoSegunTexto: segunTexto,
    });
  }

  // Slugs únicos: primero los activos (los borradores y repetidos reciben el sufijo del SKU).
  for (const p of [...productos].sort((a, b) => Number(a.estado === 'draft') - Number(b.estado === 'draft'))) {
    let slug = slugificar(p.nombre) || slugificar(p.sku);
    if (slugs.has(slug)) slug = `${slug}-${slugificar(p.sku.replace(/^IZAO-/, ''))}`;
    slugs.add(slug);
    p.slug = slug;
  }

  const porNombre = new Map<string, string[]>();
  for (const p of productos) {
    const k = normalizarClave(p.nombre);
    porNombre.set(k, [...(porNombre.get(k) ?? []), p.sku]);
  }
  const duplicadosNombre: ResultadoCarga['duplicadosNombre'] = [];
  for (const [k, skus] of porNombre) {
    if (skus.length > 1) {
      duplicadosNombre.push({ nombre: productos.find((p) => normalizarClave(p.nombre) === k)?.nombre ?? k, skus });
      for (const p of productos) if (skus.includes(p.sku)) p.revisar.push(`mismo nombre que ${skus.filter((s) => s !== p.sku).join(', ')}`);
    }
  }
  return { productos, problemas, duplicadosNombre };
}

// ---------------------------------------------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------------------------------------------

export function literal(t: string | null): string {
  return t === null ? 'null' : `'${t.replace(/'/g, "''").split('\u0000').join('')}'`;
}

export const ACCION_AUDITORIA = 'catalogo.carga_real';

const ENCABEZADO_SQL = (titulo: string, lineas: string[]): string =>
  [`-- ${titulo}`, ...lineas.map((l) => `-- ${l}`), '-- Generado por apps/web/scripts/carga-catalogo-real.ts. No editar a mano: vuelve a generarlo.', ''].join('\n');

/** 1) Carga: inserta solo los SKU que no existen. Idempotente; no borra ni pisa nada. */
export function sqlCarga(productos: readonly ProductoCarga[]): string {
  const filas = productos
    .map(
      (p) =>
        `  (${[literal(p.sku), literal(p.nombre), literal(p.slug), literal(p.descripcionCorta || null), literal(p.descripcionHtml || null), literal(p.generoSlug), literal(p.categoriaSlug), p.pesoKg.toString(), String(p.precioCo), literal(p.estado)].join(', ')})`,
    )
    .join(',\n');
  return `${ENCABEZADO_SQL('01 · Carga del catálogo real (Excel de MasterShop)', [
    `${productos.length} productos, una variante por producto con el SKU del Excel. Solo Colombia (COP enteros).`,
    'Idempotente por SKU: si el SKU ya existe no se toca (no pisa ediciones del panel). Nunca borra.',
    'Los productos quedan SIN visibilidad en CO y con stock 0: se publican con 03-publicar-co.sql (necesita vínculo MasterShop) y el stock lo define el dueño.',
    'Sin marcas ni notas inventadas. Sin imágenes (el Excel no las trae).',
  ])}
begin;
select set_config('izao.skip_catalog_refresh', 'on', true);

create temp table _carga (
  sku text primary key, nombre text not null, slug text not null, corta text, descripcion_html text,
  genero_slug text not null, categoria_slug text not null, peso_kg numeric(8,3) not null,
  precio_co bigint not null check (precio_co > 0), estado text not null check (estado in ('active','draft'))
) on commit drop;

insert into _carga (sku, nombre, slug, corta, descripcion_html, genero_slug, categoria_slug, peso_kg, precio_co, estado) values
${filas};

do $$
begin
  if (select count(*) from public.genders where slug in ('hombre','mujer')) <> 2 then
    raise exception 'Faltan los géneros hombre/mujer';
  end if;
  if (select count(*) from public.categories where slug in ('hombre','mujer')) <> 2 then
    raise exception 'Faltan las categorías hombre/mujer';
  end if;
  if not exists (select 1 from public.countries where code = 'CO') then
    raise exception 'Falta el país CO';
  end if;
end $$;

create temp table _nuevos on commit drop as
select c.*, gen_random_uuid() as pid,
       case when exists (select 1 from public.products p where p.slug = c.slug)
            then c.slug || '-' || lower(regexp_replace(c.sku, '^IZAO-', ''))
            else c.slug end as slug_final
  from _carga c
 where not exists (select 1 from public.product_variants v where v.sku = c.sku);

insert into public.products (id, name, slug, short_description, description_html, gender_id, status)
select n.pid, n.nombre, n.slug_final, n.corta, n.descripcion_html,
       (select g.id from public.genders g where g.slug = n.genero_slug), n.estado
  from _nuevos n;

insert into public.product_variants (product_id, sku, weight_kg, is_default, sort_order)
select n.pid, n.sku, n.peso_kg, true, 0 from _nuevos n;

insert into public.product_categories (product_id, category_id)
select n.pid, (select c.id from public.categories c where c.slug = n.categoria_slug) from _nuevos n
on conflict do nothing;

insert into public.product_countries (product_id, country_code, is_visible)
select n.pid, 'CO', false from _nuevos n
on conflict do nothing;

insert into public.variant_countries (variant_id, country_code, is_active, price, stock)
select v.id, 'CO', true, n.precio_co, 0
  from _nuevos n join public.product_variants v on v.sku = n.sku
on conflict do nothing;

insert into public.audit_log (actor, action, entity, entity_id, diff)
select 'sistema:carga-catalogo-real', '${ACCION_AUDITORIA}', 'products', null,
       jsonb_build_object('productos_nuevos', (select count(*) from _nuevos), 'skus_en_archivo', (select count(*) from _carga))
 where exists (select 1 from _nuevos);

select set_config('izao.skip_catalog_refresh', 'off', true);
select public.refresh_catalog_listing_many(array(select pid from _nuevos));

select (select count(*) from _carga) as skus_en_archivo,
       (select count(*) from _nuevos) as productos_creados,
       (select count(*) from _carga) - (select count(*) from _nuevos) as ya_existian;
commit;
`;
}

/** 2) Archiva el catálogo de prueba del seed (SKU `IZ-NNNN-…`). Reversible con sqlRestaurarSeed. */
export function sqlArchivarSeed(): string {
  return `${ENCABEZADO_SQL('02 · Archivar el catálogo de prueba del seed (NO borra)', [
    'Productos cuyas variantes son todas del seed (SKU IZ-NNNN-…) pasan a status archived.',
    'Guarda el estado anterior en products.attributes.archivado_por_carga_real para poder revertir (02b-restaurar-seed.sql).',
    'Los pedidos existentes siguen apuntando a sus variantes: no se toca ninguna fila de variantes ni de pedidos.',
  ])}
begin;
select set_config('izao.skip_catalog_refresh', 'on', true);

create temp table _seed on commit drop as
select p.id as pid, p.status as estado_anterior
  from public.products p
 where p.status <> 'archived'
   and exists (select 1 from public.product_variants v where v.product_id = p.id)
   and not exists (select 1 from public.product_variants v where v.product_id = p.id and v.sku !~ '^IZ-[0-9]+-')
   and not (p.attributes ? 'archivado_por_carga_real');

update public.products p
   set status = 'archived',
       attributes = p.attributes || jsonb_build_object('archivado_por_carga_real',
                      jsonb_build_object('estado_anterior', s.estado_anterior, 'fecha', to_char(now() at time zone 'America/Bogota', 'YYYY-MM-DD"T"HH24:MI:SS')))
  from _seed s
 where p.id = s.pid;

insert into public.audit_log (actor, action, entity, entity_id, diff)
select 'sistema:carga-catalogo-real', 'catalogo.archivar_seed', 'products', null,
       jsonb_build_object('productos_archivados', (select count(*) from _seed))
 where exists (select 1 from _seed);

select set_config('izao.skip_catalog_refresh', 'off', true);
select public.refresh_catalog_listing_many(array(select pid from _seed));

select count(*) as productos_archivados from _seed;
commit;
`;
}

/** 2b) Revierte sqlArchivarSeed. */
export function sqlRestaurarSeed(): string {
  return `${ENCABEZADO_SQL('02b · Restaurar el catálogo de prueba del seed (revierte el 02)', [
    'Devuelve cada producto archivado por la carga real a su estado anterior y quita la marca. No toca nada más.',
  ])}
begin;
select set_config('izao.skip_catalog_refresh', 'on', true);

create temp table _restaurar on commit drop as
select p.id as pid, p.attributes -> 'archivado_por_carga_real' ->> 'estado_anterior' as estado_anterior
  from public.products p
 where p.attributes ? 'archivado_por_carga_real';

update public.products p
   set status = r.estado_anterior,
       attributes = p.attributes - 'archivado_por_carga_real'
  from _restaurar r
 where p.id = r.pid and r.estado_anterior in ('draft','active');

insert into public.audit_log (actor, action, entity, entity_id, diff)
select 'sistema:carga-catalogo-real', 'catalogo.restaurar_seed', 'products', null,
       jsonb_build_object('productos_restaurados', (select count(*) from _restaurar))
 where exists (select 1 from _restaurar);

select set_config('izao.skip_catalog_refresh', 'off', true);
select public.refresh_catalog_listing_many(array(select pid from _restaurar));

select count(*) as productos_restaurados from _restaurar;
commit;
`;
}

/**
 * 3) Publica en Colombia los productos de la carga que ya tienen vínculo con MasterShop (regla del panel: un producto
 * visible en CO necesita `variant_countries.mastershop_product_id` de CO en cada variante activa, D-052). Idempotente. Se corre DESPUÉS de la
 * vinculación por SKU (D-050). No publica borradores.
 */
export function sqlPublicarCo(): string {
  return `${ENCABEZADO_SQL('03 · Publicar en Colombia los productos de la carga con vínculo MasterShop', [
    'Ejecutar DESPUÉS de aplicar la vinculación por SKU (D-050).',
    'Publica solo productos active de la carga cuyas variantes activas tienen el vínculo de CO (variant_countries.mastershop_product_id). Los que no lo tengan quedan ocultos.',
    'El stock sigue en 0: con stock 0 la tienda muestra «Agotado». Define el stock en el panel (Productos) o en la importación.',
  ])}
begin;
select set_config('izao.skip_catalog_refresh', 'on', true);

create temp table _publicar on commit drop as
select p.id as pid
  from public.products p
 where p.status = 'active'
   and exists (select 1 from public.product_variants v where v.product_id = p.id and v.sku ~ '^IZAO-(MEN|WOM)-[0-9]{3}$')
   and not exists (select 1 from public.product_variants v where v.product_id = p.id and v.sku !~ '^IZAO-(MEN|WOM)-[0-9]{3}$')
   and not exists (
         select 1 from public.product_variants v
           join public.variant_countries vc on vc.variant_id = v.id and vc.country_code = 'CO' and vc.is_active
          where v.product_id = p.id and vc.mastershop_product_id is null)
   and exists (select 1 from public.product_countries pc where pc.product_id = p.id and pc.country_code = 'CO' and not pc.is_visible);

update public.product_countries pc
   set is_visible = true, published_at = coalesce(pc.published_at, now())
  from _publicar x
 where pc.product_id = x.pid and pc.country_code = 'CO';

insert into public.audit_log (actor, action, entity, entity_id, diff)
select 'sistema:carga-catalogo-real', 'catalogo.publicar_co', 'products', null,
       jsonb_build_object('productos_publicados', (select count(*) from _publicar))
 where exists (select 1 from _publicar);

select set_config('izao.skip_catalog_refresh', 'off', true);
select public.refresh_catalog_listing_many(array(select pid from _publicar));

select (select count(*) from _publicar) as productos_publicados,
       (select count(*) from public.products p join public.product_countries pc on pc.product_id = p.id and pc.country_code = 'CO' and not pc.is_visible
         where p.status = 'active' and exists (select 1 from public.product_variants v where v.product_id = p.id and v.sku like 'IZAO-%')) as siguen_ocultos;
commit;
`;
}

// ---------------------------------------------------------------------------------------------------------------
// Vista previa
// ---------------------------------------------------------------------------------------------------------------

export function resumen(r: ResultadoCarga): Record<string, number> {
  const conAviso = (t: AvisoTexto['tipo']): number => r.productos.filter((p) => p.avisos.some((a) => a.tipo === t)).length;
  return {
    filas_validas: r.productos.length,
    problemas: r.problemas.length,
    hombre: r.productos.filter((p) => p.generoSlug === 'hombre').length,
    mujer: r.productos.filter((p) => p.generoSlug === 'mujer').length,
    borradores: r.productos.filter((p) => p.estado === 'draft').length,
    con_tienda_retirada: conAviso('tienda'),
    con_imitacion_retirada: conAviso('imitacion'),
    con_afirmacion_retirada: conAviso('afirmacion'),
    con_palabra_retirada: conAviso('palabra'),
    truncadas_recortadas: conAviso('truncada'),
    truncadas_sin_corte: conAviso('truncada_sin_corte'),
    texto_corto: conAviso('texto_corto'),
    a_revisar: r.productos.filter((p) => p.revisar.length > 0).length,
  };
}

export function vistaPreviaMarkdown(r: ResultadoCarga): string {
  const s = resumen(r);
  const L: string[] = ['# Vista previa · carga del catálogo real', '', '## Conteos', ''];
  for (const [k, v] of Object.entries(s)) L.push(`- ${k.replace(/_/g, ' ')}: ${v}`);
  L.push('', '## Problemas de fila', '');
  L.push(...(r.problemas.length ? r.problemas.map((p) => `- fila ${p.fila} (${p.sku ?? 's/n'}): ${p.mensaje}`) : ['- ninguno']));
  L.push('', '## Nombres duplicados', '');
  L.push(...(r.duplicadosNombre.length ? r.duplicadosNombre.map((d) => `- ${d.nombre}: ${d.skus.join(', ')}`) : ['- ninguno']));
  L.push('', '## Productos a revisar', '');
  for (const p of r.productos.filter((x) => x.revisar.length > 0)) L.push(`- ${p.sku} · ${p.nombre} · ${p.revisar.join('; ')}`);
  L.push('', '## Cinco ejemplos', '');
  for (const p of [0, 20, 60, 100, 150].map((i) => r.productos[i]).filter((x): x is ProductoCarga => !!x)) {
    L.push(`### ${p.sku} · ${p.nombre}`, '', `- slug: ${p.slug}`, `- género/categoría: ${p.generoSlug}`, `- precio CO: ${p.precioCo} COP · peso: ${p.pesoKg} kg · estado: ${p.estado}`, `- corta: ${p.descripcionCorta}`, `- descripción: ${p.descripcionHtml}`, `- avisos: ${p.avisos.map((a) => a.tipo).join(', ') || 'ninguno'}`, '');
  }
  L.push('## Retiros de texto (regla 7)', '');
  for (const p of r.productos) for (const a of p.avisos.filter((x) => ['tienda', 'imitacion', 'afirmacion', 'palabra'].includes(x.tipo))) L.push(`- ${p.sku} [${a.tipo}] ${a.detalle}`);
  return L.join('\n') + '\n';
}
