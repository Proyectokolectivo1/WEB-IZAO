#!/usr/bin/env node
// Cargador idempotente de los datos de prueba de Izao (packages/db/seed/data/, formato en data/FORMATO.md).
//
// No se conecta a la base: valida los JSON y genera SQL por la salida estándar. Aplicarlo con
//   node packages/db/seed/build-data-sql.mjs > /tmp/izao-data.sql && psql "$SUPABASE_DB_URL" -f /tmp/izao-data.sql
// o pegarlo en el editor SQL / MCP de Supabase. Requiere que el seed base (supabase/seed.sql) ya esté aplicado.
//
// Idempotencia: todos los INSERT usan ON CONFLICT ... DO UPDATE ... WHERE (...) IS DISTINCT FROM (...), así
// que una segunda corrida con los mismos archivos no modifica ninguna fila. catalog_listing solo se refresca
// para los productos que cambiaron. Por defecto no borra nada; con --prune elimina vínculos (países,
// categorías, precios por país) que ya no estén en los archivos, nunca productos.
//
// Opciones:
//   --check                 solo valida y muestra un resumen (código de salida 1 si hay errores)
//   --only=geo,taxonomias,productos   secciones a generar (por defecto todas)
//   --offset=N --limit=N    rebanada de productos (para aplicar por lotes)
//   --prune                 sincroniza vínculos eliminando los que ya no existen en los archivos
//   --data=RUTA             carpeta de datos (por defecto ./data junto a este script)

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const COUNTRIES = ['co', 'ec'];
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const LEVELS = ['baja', 'media', 'alta', 'muy_alta'];
const STATUSES = ['draft', 'active', 'archived'];
// Regla 7 (CLAUDE.md): ningún texto afirma originalidad, autenticidad, certificados ni afiliación.
const FORBIDDEN_RE = /original|aut[ée]ntic|certific|genuin|r[ée]plica|inspirad|clon|oficial/i;
const DOLLAR_TAG = '$izao_json$';

function readJson(dir, rel, errors, required = true) {
  const path = join(dir, rel);
  if (!existsSync(path)) {
    if (required) errors.push(`${rel}: no existe`);
    return null;
  }
  try {
    const text = readFileSync(path, 'utf8');
    return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch (e) {
    errors.push(`${rel}: JSON inválido (${e.message})`);
    return null;
  }
}

/** Lee todos los archivos de datos. Devuelve { data, errors }. */
export function loadData(dir) {
  const errors = [];
  const data = { regions: {}, cities: {}, taxonomias: {}, productos: [] };
  for (const c of COUNTRIES) {
    data.regions[c] = readJson(dir, `${c}/regions.json`, errors) ?? [];
    data.cities[c] = readJson(dir, `${c}/cities.json`, errors) ?? [];
  }
  for (const t of ['genders', 'concentrations', 'olfactory_families', 'brands', 'categories']) {
    data.taxonomias[t] = readJson(dir, `taxonomias/${t}.json`, errors) ?? [];
  }
  data.productos = readJson(dir, 'productos.json', errors) ?? [];
  return { data, errors };
}

const isMoney = (v) => Number.isSafeInteger(v) && v >= 0;
const isNullableMoney = (v) => v === null || v === undefined || isMoney(v);
const isStrArray = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');

function checkUnique(list, key, label, errors) {
  const seen = new Set();
  for (const item of list) {
    const k = key(item);
    if (seen.has(k)) errors.push(`${label}: duplicado "${k}"`);
    seen.add(k);
  }
}

/** Valida forma, dominios, referencias, dinero entero y la regla 7. Devuelve lista de errores. */
export function validate(data) {
  const errors = [];

  for (const c of COUNTRIES) {
    const regions = data.regions[c];
    const cities = data.cities[c];
    const codes = new Set();
    regions.forEach((r, i) => {
      if (typeof r.code !== 'string' || !r.code) errors.push(`${c}/regions[${i}]: code requerido`);
      if (typeof r.name !== 'string' || !r.name) errors.push(`${c}/regions[${i}]: name requerido`);
      codes.add(r.code);
    });
    checkUnique(regions, (r) => r.code, `${c}/regions`, errors);
    cities.forEach((x, i) => {
      if (typeof x.code !== 'string' || !x.code) errors.push(`${c}/cities[${i}]: code requerido`);
      if (typeof x.name !== 'string' || !x.name) errors.push(`${c}/cities[${i}]: name requerido`);
      if (!codes.has(x.region_code)) errors.push(`${c}/cities[${i}]: region_code "${x.region_code}" no existe`);
      if (typeof x.is_capital !== 'boolean') errors.push(`${c}/cities[${i}]: is_capital debe ser booleano`);
    });
    checkUnique(cities, (x) => `${x.region_code}|${x.code}`, `${c}/cities`, errors);
  }

  const tax = data.taxonomias;
  const slugSets = {};
  for (const [t, list] of Object.entries(tax)) {
    list.forEach((x, i) => {
      if (!SLUG_RE.test(x.slug ?? '')) errors.push(`taxonomias/${t}[${i}]: slug inválido "${x.slug}"`);
      if (typeof x.name !== 'string' || !x.name) errors.push(`taxonomias/${t}[${i}]: name requerido`);
      if (x.sort_order !== undefined && !Number.isInteger(x.sort_order)) errors.push(`taxonomias/${t}[${i}]: sort_order entero`);
    });
    checkUnique(list, (x) => x.slug, `taxonomias/${t}`, errors);
    slugSets[t] = new Set(list.map((x) => x.slug));
  }
  const parentOf = new Map(tax.categories.map((c) => [c.slug, c.parent_slug ?? null]));
  for (const c of tax.categories) {
    const parent = c.parent_slug ?? null;
    if (parent !== null) {
      if (!parentOf.has(parent)) errors.push(`categories/${c.slug}: parent_slug "${parent}" no existe`);
      else if (parentOf.get(parent) !== null) errors.push(`categories/${c.slug}: máximo 2 niveles`);
    }
    for (const k of Object.keys(c.countries ?? {})) {
      if (!COUNTRIES.includes(k)) errors.push(`categories/${c.slug}: país "${k}" no soportado`);
    }
  }

  const skus = new Set();
  data.productos.forEach((p, i) => {
    const at = `productos[${i}] ${p.slug ?? ''}`;
    if (!SLUG_RE.test(p.slug ?? '')) errors.push(`${at}: slug inválido`);
    if (typeof p.name !== 'string' || !p.name) errors.push(`${at}: name requerido`);
    for (const f of ['name', 'short_description', 'description_html']) {
      if (typeof p[f] === 'string' && FORBIDDEN_RE.test(p[f])) errors.push(`${at}: ${f} infringe la regla 7 ("${p[f].match(FORBIDDEN_RE)[0]}")`);
    }
    for (const [f, set] of [['brand_slug', 'brands'], ['gender_slug', 'genders'], ['family_slug', 'olfactory_families'], ['concentration_slug', 'concentrations']]) {
      if (p[f] != null && !slugSets[set].has(p[f])) errors.push(`${at}: ${f} "${p[f]}" no existe`);
    }
    for (const s of p.category_slugs ?? []) if (!slugSets.categories.has(s)) errors.push(`${at}: categoría "${s}" no existe`);
    for (const f of ['notes_top', 'notes_heart', 'notes_base', 'occasion', 'season', 'category_slugs']) {
      if (p[f] !== undefined && !isStrArray(p[f])) errors.push(`${at}: ${f} debe ser lista de textos`);
    }
    for (const f of ['longevity', 'sillage']) if (p[f] != null && !LEVELS.includes(p[f])) errors.push(`${at}: ${f} fuera de dominio`);
    if (!STATUSES.includes(p.status ?? 'draft')) errors.push(`${at}: status fuera de dominio`);
    for (const [k, c] of Object.entries(p.countries ?? {})) {
      if (!COUNTRIES.includes(k)) errors.push(`${at}: país "${k}" no soportado`);
      if (typeof c.visible !== 'boolean') errors.push(`${at}: countries.${k}.visible debe ser booleano`);
      if (c.featured_rank != null && !(Number.isInteger(c.featured_rank) && c.featured_rank >= 1 && c.featured_rank <= 999999)) errors.push(`${at}: countries.${k}.featured_rank 1–999999`);
      if (c.badges !== undefined && !isStrArray(c.badges)) errors.push(`${at}: countries.${k}.badges debe ser lista`);
    }
    const options = p.options ?? [];
    const optionValues = new Map(options.map((o) => [o.name, new Set(o.values ?? [])]));
    const variants = p.variants ?? [];
    if (variants.length === 0) errors.push(`${at}: sin variantes`);
    if (variants.filter((v) => v.is_default).length > 1) errors.push(`${at}: más de una variante por defecto`);
    variants.forEach((v, j) => {
      const vat = `${at} variants[${j}] ${v.sku ?? ''}`;
      if (typeof v.sku !== 'string' || !v.sku) errors.push(`${vat}: sku requerido`);
      if (skus.has(v.sku)) errors.push(`${vat}: sku duplicado`);
      skus.add(v.sku);
      for (const [name, value] of Object.entries(v.option_values ?? {})) {
        if (!optionValues.get(name)?.has(value)) errors.push(`${vat}: opción ${name}="${value}" no está en options`);
      }
      if (v.weight_kg != null && !(typeof v.weight_kg === 'number' && v.weight_kg > 0)) errors.push(`${vat}: weight_kg > 0`);
      for (const [k, c] of Object.entries(v.countries ?? {})) {
        if (!COUNTRIES.includes(k)) errors.push(`${vat}: país "${k}" no soportado`);
        if (!isMoney(c.price)) errors.push(`${vat}: ${k}.price debe ser entero ≥ 0 en unidad menor`);
        if (!isNullableMoney(c.compare_at_price)) errors.push(`${vat}: ${k}.compare_at_price entero o null`);
        if (!isNullableMoney(c.cost)) errors.push(`${vat}: ${k}.cost entero o null`);
        if (!(Number.isInteger(c.stock) && c.stock >= 0)) errors.push(`${vat}: ${k}.stock entero ≥ 0`);
      }
    });
  });
  checkUnique(data.productos, (p) => p.slug, 'productos', errors);
  return errors;
}

function jsonLiteral(value) {
  const text = JSON.stringify(value);
  if (text.includes(DOLLAR_TAG)) throw new Error(`Los datos contienen el delimitador ${DOLLAR_TAG}`);
  return `${DOLLAR_TAG}${text}${DOLLAR_TAG}::jsonb`;
}

function geoSql(data) {
  const regions = COUNTRIES.map((c) => `  ('${c.toUpperCase()}', ${jsonLiteral(data.regions[c])})`).join(',\n');
  const cities = COUNTRIES.map((c) => `  ('${c.toUpperCase()}', ${jsonLiteral(data.cities[c])})`).join(',\n');
  return `-- Regiones y ciudades (nombres tal cual DANE / INEC)
with d(country_code, j) as (values
${regions})
insert into public.regions (country_code, code, name)
select d.country_code, r->>'code', r->>'name' from d cross join lateral jsonb_array_elements(d.j) r
on conflict (country_code, code) do update set name = excluded.name
where public.regions.name is distinct from excluded.name;

with d(country_code, j) as (values
${cities})
insert into public.cities (region_id, code, name, is_capital)
select rg.id, c->>'code', c->>'name', coalesce((c->>'is_capital')::boolean, false)
from d cross join lateral jsonb_array_elements(d.j) c
join public.regions rg on rg.country_code = d.country_code and rg.code = c->>'region_code'
on conflict (region_id, code) do update set name = excluded.name, is_capital = excluded.is_capital
where (public.cities.name, public.cities.is_capital) is distinct from (excluded.name, excluded.is_capital);
`;
}

function taxonomiasSql(data, prune) {
  const t = data.taxonomias;
  return `-- Taxonomías
create temp table _tax on commit drop as select ${jsonLiteral(t)} as j;

insert into public.genders (slug, name, sort_order)
select x->>'slug', x->>'name', coalesce((x->>'sort_order')::int, o::int) from _tax, jsonb_array_elements(j->'genders') with ordinality as t(x, o)
on conflict (slug) do update set name = excluded.name, sort_order = excluded.sort_order
where (public.genders.name, public.genders.sort_order) is distinct from (excluded.name, excluded.sort_order);

insert into public.concentrations (slug, name, sort_order)
select x->>'slug', x->>'name', coalesce((x->>'sort_order')::int, o::int) from _tax, jsonb_array_elements(j->'concentrations') with ordinality as t(x, o)
on conflict (slug) do update set name = excluded.name, sort_order = excluded.sort_order
where (public.concentrations.name, public.concentrations.sort_order) is distinct from (excluded.name, excluded.sort_order);

insert into public.olfactory_families (slug, name, description, sort_order)
select x->>'slug', x->>'name', x->>'description', coalesce((x->>'sort_order')::int, o::int) from _tax, jsonb_array_elements(j->'olfactory_families') with ordinality as t(x, o)
on conflict (slug) do update set name = excluded.name, description = excluded.description, sort_order = excluded.sort_order
where (public.olfactory_families.name, public.olfactory_families.description, public.olfactory_families.sort_order)
  is distinct from (excluded.name, excluded.description, excluded.sort_order);

insert into public.brands (slug, name, description)
select x->>'slug', x->>'name', x->>'description' from _tax, jsonb_array_elements(j->'brands') x
on conflict (slug) do update set name = excluded.name, description = excluded.description
where (public.brands.name, public.brands.description) is distinct from (excluded.name, excluded.description);

insert into public.categories (slug, name, description, seo_title, seo_description, sort_order, show_in_menu)
select x->>'slug', x->>'name', x->>'description', x->>'seo_title', x->>'seo_description',
       coalesce((x->>'sort_order')::int, o::int), coalesce((x->>'show_in_menu')::boolean, true)
from _tax, jsonb_array_elements(j->'categories') with ordinality as t(x, o)
on conflict (slug) do update set name = excluded.name, description = excluded.description, seo_title = excluded.seo_title,
  seo_description = excluded.seo_description, sort_order = excluded.sort_order, show_in_menu = excluded.show_in_menu
where (public.categories.name, public.categories.description, public.categories.seo_title, public.categories.seo_description,
       public.categories.sort_order, public.categories.show_in_menu)
  is distinct from (excluded.name, excluded.description, excluded.seo_title, excluded.seo_description, excluded.sort_order, excluded.show_in_menu);

update public.categories c set parent_id = p.id
from _tax, jsonb_array_elements(j->'categories') x
left join public.categories p on p.slug = x->>'parent_slug'
where c.slug = x->>'slug' and c.parent_id is distinct from p.id;

insert into public.category_countries (category_id, country_code, is_visible, sort_order)
select c.id, upper(k.key), coalesce((k.value->>'is_visible')::boolean, true), coalesce((k.value->>'sort_order')::int, c.sort_order)
from _tax, jsonb_array_elements(j->'categories') x
join public.categories c on c.slug = x->>'slug'
cross join lateral jsonb_each(coalesce(x->'countries', '{"co":{},"ec":{}}'::jsonb)) k
on conflict (category_id, country_code) do update set is_visible = excluded.is_visible, sort_order = excluded.sort_order
where (public.category_countries.is_visible, public.category_countries.sort_order) is distinct from (excluded.is_visible, excluded.sort_order);
${prune ? `
delete from public.category_countries cc using _tax, jsonb_array_elements(j->'categories') x, public.categories c
where c.slug = x->>'slug' and cc.category_id = c.id and x ? 'countries' and not (x->'countries' ? lower(cc.country_code));
` : ''}`;
}

function productosSql(productos, prune) {
  return `-- Productos (${productos.length})
create temp table _p on commit drop as select x as p from jsonb_array_elements(${jsonLiteral(productos)}) as x;
create temp table _touched (product_id uuid) on commit drop;

with up as (
  insert into public.products (slug, name, short_description, description_html, brand_id, gender_id, family_id, concentration_id,
    notes_top, notes_heart, notes_base, occasion, season, longevity, sillage, attributes, seo_title, seo_description, status)
  select p->>'slug', p->>'name', p->>'short_description', p->>'description_html', b.id, g.id, f.id, c.id,
    array(select jsonb_array_elements_text(coalesce(p->'notes_top', '[]'))),
    array(select jsonb_array_elements_text(coalesce(p->'notes_heart', '[]'))),
    array(select jsonb_array_elements_text(coalesce(p->'notes_base', '[]'))),
    array(select jsonb_array_elements_text(coalesce(p->'occasion', '[]'))),
    array(select jsonb_array_elements_text(coalesce(p->'season', '[]'))),
    p->>'longevity', p->>'sillage', coalesce(p->'attributes', '{}'::jsonb), p->>'seo_title', p->>'seo_description',
    coalesce(p->>'status', 'draft')
  from _p
  left join public.brands b on b.slug = p->>'brand_slug'
  left join public.genders g on g.slug = p->>'gender_slug'
  left join public.olfactory_families f on f.slug = p->>'family_slug'
  left join public.concentrations c on c.slug = p->>'concentration_slug'
  on conflict (slug) do update set
    name = excluded.name, short_description = excluded.short_description, description_html = excluded.description_html,
    brand_id = excluded.brand_id, gender_id = excluded.gender_id, family_id = excluded.family_id,
    concentration_id = excluded.concentration_id, notes_top = excluded.notes_top, notes_heart = excluded.notes_heart,
    notes_base = excluded.notes_base, occasion = excluded.occasion, season = excluded.season, longevity = excluded.longevity,
    sillage = excluded.sillage, attributes = excluded.attributes, seo_title = excluded.seo_title,
    seo_description = excluded.seo_description, status = excluded.status
  where (public.products.name, public.products.short_description, public.products.description_html, public.products.brand_id,
         public.products.gender_id, public.products.family_id, public.products.concentration_id, public.products.notes_top,
         public.products.notes_heart, public.products.notes_base, public.products.occasion, public.products.season,
         public.products.longevity, public.products.sillage, public.products.attributes, public.products.seo_title,
         public.products.seo_description, public.products.status)
    is distinct from (excluded.name, excluded.short_description, excluded.description_html, excluded.brand_id,
         excluded.gender_id, excluded.family_id, excluded.concentration_id, excluded.notes_top, excluded.notes_heart,
         excluded.notes_base, excluded.occasion, excluded.season, excluded.longevity, excluded.sillage, excluded.attributes,
         excluded.seo_title, excluded.seo_description, excluded.status)
  returning id)
insert into _touched select id from up;

create temp table _pid on commit drop as select _p.p, pr.id as product_id from _p join public.products pr on pr.slug = _p.p->>'slug';

with up as (
  insert into public.product_countries (product_id, country_code, is_visible, is_featured, featured_rank, badges, published_at)
  select x.product_id, upper(k.key), coalesce((k.value->>'visible')::boolean, false), coalesce((k.value->>'is_featured')::boolean, false),
         (k.value->>'featured_rank')::int, array(select jsonb_array_elements_text(coalesce(k.value->'badges', '[]'))),
         (k.value->>'published_at')::timestamptz
  from _pid x cross join lateral jsonb_each(coalesce(x.p->'countries', '{}')) k
  on conflict (product_id, country_code) do update set is_visible = excluded.is_visible, is_featured = excluded.is_featured,
    featured_rank = excluded.featured_rank, badges = excluded.badges, published_at = excluded.published_at
  where (public.product_countries.is_visible, public.product_countries.is_featured, public.product_countries.featured_rank,
         public.product_countries.badges, public.product_countries.published_at)
    is distinct from (excluded.is_visible, excluded.is_featured, excluded.featured_rank, excluded.badges, excluded.published_at)
  returning product_id)
insert into _touched select product_id from up;

with up as (
  insert into public.product_categories (product_id, category_id)
  select x.product_id, c.id from _pid x cross join lateral jsonb_array_elements_text(coalesce(x.p->'category_slugs', '[]')) s(slug)
  join public.categories c on c.slug = s.slug
  on conflict do nothing
  returning product_id)
insert into _touched select product_id from up;

insert into public.product_options (product_id, name, sort_order)
select x.product_id, o->>'name', (n - 1)::int
from _pid x cross join lateral jsonb_array_elements(coalesce(x.p->'options', '[]')) with ordinality as t(o, n)
on conflict (product_id, name) do update set sort_order = excluded.sort_order
where public.product_options.sort_order is distinct from excluded.sort_order;

insert into public.product_option_values (option_id, value, sort_order)
select po.id, v.value, (v.n - 1)::int
from _pid x cross join lateral jsonb_array_elements(coalesce(x.p->'options', '[]')) o
join public.product_options po on po.product_id = x.product_id and po.name = o->>'name'
cross join lateral jsonb_array_elements_text(coalesce(o->'values', '[]')) with ordinality as v(value, n)
on conflict (option_id, value) do update set sort_order = excluded.sort_order
where public.product_option_values.sort_order is distinct from excluded.sort_order;

with up as (
  insert into public.product_variants (product_id, sku, option_value_ids, weight_kg, is_default, mastershop_product_id, mastershop_variant_id, sort_order)
  select x.product_id, v->>'sku',
    array(select ov.id
            from jsonb_each_text(coalesce(v->'option_values', '{}')) e
            join public.product_options po on po.product_id = x.product_id and po.name = e.key
            join public.product_option_values ov on ov.option_id = po.id and ov.value = e.value
           order by po.sort_order),
    coalesce((v->>'weight_kg')::numeric, 0.5), coalesce((v->>'is_default')::boolean, false),
    (v->>'mastershop_product_id')::int, (v->>'mastershop_variant_id')::int, (n - 1)::int
  from _pid x cross join lateral jsonb_array_elements(coalesce(x.p->'variants', '[]')) with ordinality as t(v, n)
  on conflict (sku) do update set product_id = excluded.product_id, option_value_ids = excluded.option_value_ids,
    weight_kg = excluded.weight_kg, is_default = excluded.is_default, mastershop_product_id = excluded.mastershop_product_id,
    mastershop_variant_id = excluded.mastershop_variant_id, sort_order = excluded.sort_order
  where (public.product_variants.product_id, public.product_variants.option_value_ids, public.product_variants.weight_kg,
         public.product_variants.is_default, public.product_variants.mastershop_product_id,
         public.product_variants.mastershop_variant_id, public.product_variants.sort_order)
    is distinct from (excluded.product_id, excluded.option_value_ids, excluded.weight_kg, excluded.is_default,
         excluded.mastershop_product_id, excluded.mastershop_variant_id, excluded.sort_order)
  returning product_id)
insert into _touched select product_id from up;

with up as (
  insert into public.variant_countries (variant_id, country_code, is_active, price, compare_at_price, cost, stock)
  select pv.id, upper(k.key), coalesce((k.value->>'active')::boolean, true), (k.value->>'price')::bigint,
         (k.value->>'compare_at_price')::bigint, (k.value->>'cost')::bigint, coalesce((k.value->>'stock')::int, 0)
  from _pid x cross join lateral jsonb_array_elements(coalesce(x.p->'variants', '[]')) v
  join public.product_variants pv on pv.sku = v->>'sku'
  cross join lateral jsonb_each(coalesce(v->'countries', '{}')) k
  on conflict (variant_id, country_code) do update set is_active = excluded.is_active, price = excluded.price,
    compare_at_price = excluded.compare_at_price, cost = excluded.cost, stock = excluded.stock
  where (public.variant_countries.is_active, public.variant_countries.price, public.variant_countries.compare_at_price,
         public.variant_countries.cost, public.variant_countries.stock)
    is distinct from (excluded.is_active, excluded.price, excluded.compare_at_price, excluded.cost, excluded.stock)
  returning variant_id)
insert into _touched select pv.product_id from up join public.product_variants pv on pv.id = up.variant_id;
${prune ? `
-- --prune: elimina vínculos que ya no están en los archivos (nunca productos ni variantes)
with del as (
  delete from public.product_countries pc using _pid x
  where pc.product_id = x.product_id and not (coalesce(x.p->'countries', '{}') ? lower(pc.country_code))
  returning pc.product_id)
insert into _touched select product_id from del;
with del as (
  delete from public.product_categories pcat using _pid x
  where pcat.product_id = x.product_id
    and not exists (select 1 from jsonb_array_elements_text(coalesce(x.p->'category_slugs', '[]')) s(slug)
                    join public.categories c on c.slug = s.slug where c.id = pcat.category_id)
  returning pcat.product_id)
insert into _touched select product_id from del;
with del as (
  delete from public.variant_countries vc
  using _pid x cross join lateral jsonb_array_elements(coalesce(x.p->'variants', '[]')) v, public.product_variants pv
  where pv.sku = v->>'sku' and vc.variant_id = pv.id and not (coalesce(v->'countries', '{}') ? lower(vc.country_code))
  returning pv.product_id)
insert into _touched select product_id from del;
` : ''}
select set_config('izao.skip_catalog_refresh', 'off', true);
select count(distinct product_id) as productos_modificados, public.refresh_catalog_listing_many(array(select distinct product_id from _touched)) as listados_refrescados
from _touched;
`;
}

/** Genera el SQL completo (una transacción). */
export function buildSql(data, { only = ['geo', 'taxonomias', 'productos'], offset = 0, limit, prune = false } = {}) {
  const parts = [
    '-- Generado por packages/db/seed/build-data-sql.mjs — no editar a mano.',
    'begin;',
    "select set_config('izao.skip_catalog_refresh', 'on', true);",
  ];
  if (only.includes('geo')) parts.push(geoSql(data));
  if (only.includes('taxonomias')) parts.push(taxonomiasSql(data, prune));
  if (only.includes('productos')) {
    const slice = data.productos.slice(offset, limit === undefined ? undefined : offset + limit);
    parts.push(productosSql(slice, prune));
  } else {
    parts.push("select set_config('izao.skip_catalog_refresh', 'off', true);");
  }
  parts.push('commit;');
  return parts.join('\n') + '\n';
}

function parseArgs(argv) {
  const opts = { check: false, prune: false, offset: 0, limit: undefined, only: undefined, dir: undefined };
  for (const a of argv) {
    if (a === '--check') opts.check = true;
    else if (a === '--prune') opts.prune = true;
    else if (a.startsWith('--offset=')) opts.offset = Number(a.slice(9));
    else if (a.startsWith('--limit=')) opts.limit = Number(a.slice(8));
    else if (a.startsWith('--only=')) opts.only = a.slice(7).split(',');
    else if (a.startsWith('--data=')) opts.dir = a.slice(7);
    else throw new Error(`Opción desconocida: ${a}`);
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const dir = opts.dir ?? join(dirname(fileURLToPath(import.meta.url)), 'data');
  const { data, errors: readErrors } = loadData(dir);
  const errors = [...readErrors, ...validate(data)];
  if (errors.length) {
    process.stderr.write(`Datos inválidos (${errors.length}):\n${errors.slice(0, 50).map((e) => `  - ${e}`).join('\n')}\n`);
    process.exit(1);
  }
  if (opts.check) {
    const variants = data.productos.reduce((n, p) => n + (p.variants?.length ?? 0), 0);
    const visible = (c) => data.productos.filter((p) => p.countries?.[c]?.visible).length;
    process.stdout.write(
      `OK · regiones co=${data.regions.co.length} ec=${data.regions.ec.length} · ciudades co=${data.cities.co.length} ec=${data.cities.ec.length}` +
        ` · productos=${data.productos.length} variantes=${variants} visibles co=${visible('co')} ec=${visible('ec')}\n`,
    );
    return;
  }
  process.stdout.write(buildSql(data, { only: opts.only, offset: opts.offset, limit: opts.limit, prune: opts.prune }));
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  main();
}
