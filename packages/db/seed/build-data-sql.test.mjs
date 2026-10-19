// Pruebas del cargador de datos de seed (node --test).
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildSql, loadData, validate } from './build-data-sql.mjs';

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), 'data');

function sampleData() {
  return {
    regions: { co: [{ code: '05', name: 'Antioquia' }], ec: [{ code: '01', name: 'Azuay' }] },
    cities: {
      co: [{ code: '05001', region_code: '05', name: 'MEDELLÍN', is_capital: true }],
      ec: [{ code: '0101', region_code: '01', name: 'CUENCA', is_capital: true }],
    },
    taxonomias: {
      genders: [{ slug: 'mujer', name: 'Mujer', sort_order: 1 }],
      concentrations: [{ slug: 'edp', name: 'EDP' }],
      olfactory_families: [{ slug: 'floral', name: 'Floral', description: null, sort_order: 1 }],
      brands: [{ slug: 'casa-prueba', name: 'Casa Prueba', description: null }],
      categories: [{ slug: 'mujer', name: 'Mujer', parent_slug: null }],
    },
    productos: [
      {
        slug: 'rosa-prueba',
        name: 'Rosa Prueba',
        brand_slug: 'casa-prueba',
        gender_slug: 'mujer',
        family_slug: 'floral',
        concentration_slug: 'edp',
        category_slugs: ['mujer'],
        status: 'active',
        countries: { co: { visible: true, badges: [] } },
        options: [{ name: 'Presentación', values: ['50 ml'] }],
        variants: [
          {
            sku: 'T-50',
            option_values: { Presentación: '50 ml' },
            weight_kg: 0.4,
            is_default: true,
            countries: { co: { active: true, price: 90000, compare_at_price: null, cost: 40000, stock: 3 } },
          },
        ],
      },
    ],
  };
}

test('los archivos reales de packages/db/seed/data son válidos', () => {
  const { data, errors } = loadData(DATA_DIR);
  assert.deepEqual(errors, []);
  assert.deepEqual(validate(data), []);
  assert.ok(data.productos.length > 0);
});

test('ningún producto real infringe la regla 7', () => {
  const { data } = loadData(DATA_DIR);
  const forbidden = /original|aut[ée]ntic|certific|genuin|r[ée]plica|inspirad|clon|oficial/i;
  const bad = data.productos.filter((p) => forbidden.test(`${p.name} ${p.short_description ?? ''} ${p.description_html ?? ''}`));
  assert.deepEqual(bad.map((p) => p.slug), []);
});

test('un conjunto mínimo válido no tiene errores', () => {
  assert.deepEqual(validate(sampleData()), []);
});

test('rechaza montos con decimales (dinero en unidad menor entera)', () => {
  const data = sampleData();
  data.productos[0].variants[0].countries.co.price = 49.9;
  assert.ok(validate(data).some((e) => e.includes('price')));
});

test('rechaza textos que afirman originalidad (regla 7)', () => {
  const data = sampleData();
  data.productos[0].name = 'Rosa Original';
  assert.ok(validate(data).some((e) => e.includes('regla 7')));
});

test('rechaza referencias inexistentes y SKU duplicados', () => {
  const data = sampleData();
  data.productos[0].brand_slug = 'no-existe';
  data.productos.push({ ...structuredClone(data.productos[0]), slug: 'otra-rosa', brand_slug: 'casa-prueba' });
  const errors = validate(data);
  assert.ok(errors.some((e) => e.includes('brand_slug')));
  assert.ok(errors.some((e) => e.includes('sku duplicado')));
});

test('rechaza categorías de más de 2 niveles y ciudades sin región', () => {
  const data = sampleData();
  data.taxonomias.categories.push({ slug: 'hija', name: 'Hija', parent_slug: 'mujer' }, { slug: 'nieta', name: 'Nieta', parent_slug: 'hija' });
  data.cities.co.push({ code: '99999', region_code: '99', name: 'X', is_capital: false });
  const errors = validate(data);
  assert.ok(errors.some((e) => e.includes('máximo 2 niveles')));
  assert.ok(errors.some((e) => e.includes('region_code')));
});

test('el SQL generado es una transacción idempotente sin borrados por defecto', () => {
  const sql = buildSql(sampleData());
  assert.match(sql, /^-- Generado/);
  assert.match(sql, /\nbegin;\n/);
  assert.match(sql, /\ncommit;\n$/);
  assert.match(sql, /izao\.skip_catalog_refresh', 'on'/);
  assert.match(sql, /refresh_catalog_listing_many/);
  assert.doesNotMatch(sql, /\bdelete\b/i);
  assert.doesNotMatch(sql, /\btruncate\b/i);
  const upserts = sql.match(/on conflict/g) ?? [];
  const guarded = sql.match(/is distinct from/g) ?? [];
  assert.ok(upserts.length >= 10);
  assert.ok(guarded.length >= upserts.length - 1, 'cada upsert con do update compara antes de escribir');
});

test('--prune agrega borrados solo de vínculos, nunca de productos o variantes', () => {
  const sql = buildSql(sampleData(), { prune: true });
  assert.match(sql, /delete from public\.product_countries/);
  assert.doesNotMatch(sql, /delete from public\.products\b/);
  assert.doesNotMatch(sql, /delete from public\.product_variants\b/);
});

test('los lotes de productos respetan offset y limit', () => {
  const data = sampleData();
  data.productos.push({ ...structuredClone(data.productos[0]), slug: 'segunda', variants: [] });
  const sql = buildSql(data, { only: ['productos'], offset: 1, limit: 1 });
  assert.match(sql, /-- Productos \(1\)/);
  assert.match(sql, /"segunda"/);
  assert.doesNotMatch(sql, /"rosa-prueba"/);
});
