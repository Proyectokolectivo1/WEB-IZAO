// Utilidades compartidas de los escenarios k6 de Izao.
// Los valores de filtros salen de los 520 productos de prueba del seed, igual que en Playwright.
import exec from 'k6/execution';

const productos = JSON.parse(open('../../packages/db/seed/data/productos.json'));

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
