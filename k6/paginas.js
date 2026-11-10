// Páginas HTML de la tienda (home, listado, carrito y checkout): GET sostenido, mezcla uniforme.
// La especificación fija LCP < 2,5 s y JS < 170 KB, no un p95 de servidor para el HTML; supuesto p95 < 300 ms (`P95_MS`),
// igual que la ficha. El carrito y el checkout son cascarones de cliente: miden el HTML, no la vista previa (ver checkout.js).
//
//   k6 run -e BASE_URL=http://127.0.0.1:3100 k6/paginas.js
import http from 'k6/http';
import { check } from 'k6';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.4/index.js';
import { baseUrlSegura, elegir, pais as paisCarga, perfil, resumenA } from './lib/comun.js';

const P95_MS = Number(__ENV.P95_MS || 300);
const RUTAS = [
  { nombre: 'home', ruta: '' },
  { nombre: 'catalogo', ruta: '/catalogo' },
  { nombre: 'carrito', ruta: '/carrito' },
  { nombre: 'checkout', ruta: '/checkout' },
];

export const options = {
  scenarios: {
    paginas: { executor: 'constant-arrival-rate', timeUnit: '1s', exec: 'paginas', ...perfil(60, '2m') },
  },
  thresholds: {
    'http_req_duration{endpoint:home}': ['p(95)<' + P95_MS],
    'http_req_duration{endpoint:catalogo}': ['p(95)<' + P95_MS],
    'http_req_duration{endpoint:carrito}': ['p(95)<' + P95_MS],
    'http_req_duration{endpoint:checkout}': ['p(95)<' + P95_MS],
    http_req_failed: ['rate<0.01'],
    dropped_iterations: ['count<1'],
    checks: ['rate>0.99'],
  },
};

export function setup() {
  baseUrlSegura();
}

export function paginas() {
  const base = baseUrlSegura();
  const p = paisCarga();
  const r = elegir(RUTAS);
  const res = http.get(base + '/' + p + r.ruta, { tags: { endpoint: r.nombre } });
  check(res, {
    'estado 200': (x) => x.status === 200,
    'es HTML': (x) => String(x.headers['Content-Type'] || '').includes('text/html'),
  });
}

export function handleSummary(data) {
  return resumenA('paginas', data, textSummary);
}
