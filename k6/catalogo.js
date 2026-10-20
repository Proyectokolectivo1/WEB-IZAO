// §30 F1 / §31.1: GET /api/catalog a 100 req/s sostenidas con combinación de filtros, cursor y país.
// Umbrales: p95 < 120 ms y errores < 1 %. NUNCA contra producción (ver k6/LEEME.md).
//
//   k6 run -e BASE_URL=http://127.0.0.1:3100 k6/catalogo.js
//   k6 run -e BASE_URL=http://127.0.0.1:3100 -e PERFIL=humo k6/catalogo.js   # validación rápida
import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.4/index.js';
import {
  baseUrlSegura,
  elegir,
  MARCAS,
  GENEROS,
  FAMILIAS,
  CONCENTRACIONES,
  ORDENES,
  PARAMS,
  perfil,
  resumenA,
} from './lib/comun.js';

const lotesPedidos = new Counter('lotes_pedidos');

export const options = {
  scenarios: {
    catalogo: {
      executor: 'constant-arrival-rate',
      timeUnit: '1s',
      exec: 'catalogo',
      ...perfil(100, '3m'),
    },
  },
  thresholds: {
    // Criterio de aceptación de F1.
    'http_req_duration{endpoint:catalogo}': ['p(95)<120'],
    'http_req_failed{endpoint:catalogo}': ['rate<0.01'],
    // La prueba debe sostener la tasa pedida: si el servidor se atrasa, k6 descarta iteraciones.
    dropped_iterations: ['count<1'],
    checks: ['rate>0.99'],
  },
};

// Combinación de consulta: país, orden y entre 0 y 4 filtros. Pesos: la mayoría navega con pocos filtros.
function consulta() {
  const pais = Math.random() < 0.7 ? 'co' : 'ec';
  const q = { [PARAMS.pais]: pais, [PARAMS.orden]: elegir(ORDENES) };
  const filtros = Math.random();
  if (filtros > 0.35) q[PARAMS.genero] = elegir(GENEROS);
  if (filtros > 0.55) q[PARAMS.familia] = elegir(FAMILIAS);
  if (filtros > 0.7) q[PARAMS.marca] = elegir(MARCAS);
  if (filtros > 0.85) q[PARAMS.concentracion] = elegir(CONCENTRACIONES);
  if (filtros > 0.92) {
    q[PARAMS.precioMin] = pais === 'co' ? 100000 : 3000; // COP en pesos, USD en centavos
    q[PARAMS.precioMax] = pais === 'co' ? 400000 : 12000;
  }
  return q;
}

function url(base, q, cursor) {
  const partes = Object.entries(q).map(([k, v]) => k + '=' + encodeURIComponent(v));
  if (cursor) partes.push(PARAMS.cursor + '=' + encodeURIComponent(cursor));
  return base + '/api/catalog?' + partes.join('&');
}

export function setup() {
  baseUrlSegura();
}

// Cada iteración es UN request (la tasa es exactamente req/s). El VU recuerda el cursor de su respuesta
// anterior y con 60 % de probabilidad pide el lote siguiente de esa misma consulta: mezcla primer lote y siguientes.
let pendiente = null;

export function catalogo() {
  const base = baseUrlSegura();
  const encadenar = pendiente !== null && Math.random() < 0.6;
  const q = encadenar ? pendiente.q : consulta();
  const r = http.get(url(base, q, encadenar ? pendiente.cursor : null), {
    tags: { endpoint: 'catalogo' },
    headers: { Accept: 'application/json' },
  });
  lotesPedidos.add(1);

  let cuerpo = null;
  try {
    cuerpo = r.json();
  } catch (_e) {
    cuerpo = null;
  }
  check(r, {
    'estado 200': (x) => x.status === 200,
    'respuesta { items, nextCursor }': () => cuerpo !== null && Array.isArray(cuerpo.items) && 'nextCursor' in cuerpo,
    'lote de 25 o último lote': () => cuerpo !== null && (cuerpo.items.length === 25 || cuerpo.nextCursor === null),
  });
  pendiente = cuerpo && cuerpo.nextCursor ? { q: q, cursor: cuerpo.nextCursor } : null;
}

export function handleSummary(data) {
  return resumenA('catalogo', data, textSummary);
}
