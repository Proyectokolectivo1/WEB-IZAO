// Utilidades compartidas de los escenarios k6 de Izao.
// Los valores de filtros y los slugs salen de un archivo de datos con la forma de `ProductoSemilla`:
//   -e DATOS=ejemplo (defecto)  -> apps/web/tests/.resultados/ejemplo.json, lo escribe Playwright (globalSetup) y es lo que sirve
//                                  el build de `pnpm build:e2e` (STORE_DATOS=ejemplo, 140 productos).
//   -e DATOS=seed               -> los 520 productos del seed, para staging con la base real.
import exec from 'k6/execution';

const RUTAS_DATOS = {
  ejemplo: '../../apps/web/tests/.resultados/ejemplo.json',
  seed: '../../packages/db/seed/data/productos.json',
};
export const DATOS = __ENV.DATOS === 'seed' ? 'seed' : 'ejemplo';
const productos = JSON.parse(open(RUTAS_DATOS[DATOS]));

// Nombres de los parámetros de GET /api/catalog. Si izao-tienda los define distinto, se cambian SOLO aquí.
export const PARAMS = {
  pais: 'country',
  cursor: 'cursor',
  orden: 'orden',
  marca: 'marca',
  genero: 'genero',
  familia: 'familia',
  concentracion: 'concentracion',
  categoria: 'categoria',
  precioMin: 'precio_min',
  precioMax: 'precio_max',
  disponible: 'disponible',
};

export const ORDENES = ['featured', 'sales', 'newest', 'price_asc', 'price_desc', 'discount'];

const unicos = (campo) => [...new Set(productos.map((p) => p[campo]))];
export const MARCAS = unicos('brand_slug');
export const GENEROS = unicos('gender_slug');
export const FAMILIAS = unicos('family_slug');
export const CONCENTRACIONES = unicos('concentration_slug');

export function visiblesEn(pais) {
  return productos.filter((p) => p.status === 'active' && p.countries[pais] && p.countries[pais].visible);
}

// País de la carga. QA de Colombia: `co` por defecto; `-e PAIS=mixto` reparte 70 % CO / 30 % EC; `-e PAIS=ec` solo EC.
export function pais() {
  const v = __ENV.PAIS || 'co';
  if (v === 'mixto') return Math.random() < 0.7 ? 'co' : 'ec';
  return v === 'ec' ? 'ec' : 'co';
}

export function elegir(lista) {
  return lista[Math.floor(Math.random() * lista.length)];
}

// Nunca se corre contra producción: la prueba se aborta antes de enviar una sola petición.
export function baseUrlSegura() {
  const base = (__ENV.BASE_URL || '').replace(/\/$/, '');
  if (!base) {
    exec.test.abort('Falta BASE_URL (p. ej. -e BASE_URL=http://127.0.0.1:3100). Ver k6/LEEME.md.');
  }
  if (/izaoperfumeria\.com/i.test(base) && __ENV.PERMITIR_PRODUCCION !== 'SI_ESTOY_SEGURO') {
    exec.test.abort('BASE_URL apunta a producción: las pruebas de carga NO se ejecutan allí.');
  }
  return base;
}

// Perfil "humo" (validar los scripts) o "carga" (criterio de aceptación).
export function perfil(porSegundoCarga, duracionCarga) {
  if (__ENV.PERFIL === 'humo') return { rate: 5, duration: '10s', preAllocatedVUs: 5, maxVUs: 20 };
  return {
    rate: Number(__ENV.TASA || porSegundoCarga),
    duration: __ENV.DURACION || duracionCarga,
    preAllocatedVUs: 100,
    maxVUs: 400,
  };
}

export function resumenA(archivo, data, textSummary) {
  return {
    stdout: textSummary(data, { indent: ' ', enableColors: false }),
    ['k6/.resultados/' + archivo + '.json']: JSON.stringify(data, null, 2),
  };
}

// ── Carrito y checkout ─────────────────────────────────────────────────────────────────────────────
// Ids de geografía que responde `k6/soporte/supabase-checkout-falso.mjs` (el falso inventa la fila de la ciudad).
export const REGION_CO = '11111111-1111-4111-8111-111111111111';
export const CIUDAD_CO = '22222222-2222-4222-8222-222222222222';
export const VERSION_POLITICA = '2026-10';

export function uuid() {
  const h = '0123456789abcdef';
  let s = '';
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) s += '-';
    else if (i === 14) s += '4';
    else if (i === 19) s += h[8 + Math.floor(Math.random() * 4)];
    else s += h[Math.floor(Math.random() * 16)];
  }
  return s;
}

// El límite de tasa del checkout es por IP (`x-real-ip`, la pone Nginx). Cada petición simula un cliente distinto
// para medir el rendimiento del servidor sin chocar con el límite de 10 pedidos/min por IP; el límite se prueba aparte.
export function ipAleatoria() {
  return '10.' + Math.floor(Math.random() * 250) + '.' + Math.floor(Math.random() * 250) + '.' + (1 + Math.floor(Math.random() * 250));
}

export function lineasAleatorias() {
  const n = 1 + Math.floor(Math.random() * 3);
  const ids = new Set();
  while (ids.size < n) ids.add(uuid());
  return [...ids].map((id) => ({ variant_id: id, quantity: 1 + Math.floor(Math.random() * 2) }));
}

export function cuerpoPedido(items, metodo, clave) {
  return {
    country_code: 'CO',
    idempotency_key: clave || uuid(),
    items: items,
    contact: { first_name: 'Ana', last_name: 'Prueba', phone: '3001234567', email: null },
    document: { type: 'CC', number: '1234567' },
    shipping: { region_id: REGION_CO, city_id: CIUDAD_CO, district: null, address1: 'Calle 1 # 2-3', address2: null, notes: null },
    payment_method: metodo || 'wompi',
    discount_code: null,
    consents: { terms_and_data: true, whatsapp: false },
    data_policy_version: VERSION_POLITICA,
  };
}
