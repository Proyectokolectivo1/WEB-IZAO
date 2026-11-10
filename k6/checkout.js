// §30 F3 / §31.1: checkout a 10 req/s sostenidas. Cada iteración = el recorrido del cliente en el carrito y el pago:
// POST /api/checkout/preview (resumen) seguido de POST /api/checkout (crea el pedido, método Wompi) = 10 pedidos/s.
// El proveedor de pago es un MOCK por construcción: el Supabase falso (k6/soporte/supabase-checkout-falso.mjs) no tiene
// credenciales de Wompi, así que el link de pago queda en `payment: null`; no se llama a ningún proveedor ni a Redis.
// La especificación no fija un presupuesto de latencia para el checkout: supuesto p95 < 500 ms (`P95_MS`).
//
//   k6 run -e BASE_URL=http://127.0.0.1:3100 k6/checkout.js
//   k6 run -e BASE_URL=http://127.0.0.1:3100 -e PERFIL=humo k6/checkout.js
import http from 'k6/http';
import { check } from 'k6';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.4/index.js';
import { baseUrlSegura, cuerpoPedido, ipAleatoria, lineasAleatorias, perfil, resumenA, uuid } from './lib/comun.js';

const P95_MS = Number(__ENV.P95_MS || 500);

export const options = {
  scenarios: {
    checkout: { executor: 'constant-arrival-rate', timeUnit: '1s', exec: 'checkout', ...perfil(10, '2m') },
    // El 11.º pedido por minuto desde una misma IP debe recibir 429 (CHECKOUT_RATE_LIMIT_PER_MIN, defecto 10).
    limite_de_tasa: { executor: 'per-vu-iterations', exec: 'limiteDeTasa', vus: 1, iterations: 1, maxDuration: '30s' },
  },
  thresholds: {
    'http_req_duration{endpoint:pedido}': ['p(95)<' + P95_MS],
    'http_req_duration{endpoint:preview}': ['p(95)<' + P95_MS],
    'http_req_failed{endpoint:pedido}': ['rate<0.01'],
    'http_req_failed{endpoint:preview}': ['rate<0.01'],
    dropped_iterations: ['count<1'],
    'checks{escenario:checkout}': ['rate>0.99'],
    'checks{escenario:limite}': ['rate==1'],
  },
};

export function setup() {
  baseUrlSegura();
}

function cabeceras(ip) {
  return { 'Content-Type': 'application/json', 'x-real-ip': ip };
}

export function checkout() {
  const base = baseUrlSegura();
  const ip = ipAleatoria();
  const items = lineasAleatorias();

  const p = http.post(base + '/api/checkout/preview', JSON.stringify({ country: 'co', items: items }), {
    headers: cabeceras(ip),
    tags: { endpoint: 'preview' },
  });
  check(p, { 'preview 200': (r) => r.status === 200 }, { escenario: 'checkout' });

  const r = http.post(base + '/api/checkout', JSON.stringify(cuerpoPedido(items, 'wompi')), {
    headers: cabeceras(ip),
    tags: { endpoint: 'pedido' },
  });
  let c = null;
  try {
    c = r.json();
  } catch (_e) {
    c = null;
  }
  check(
    r,
    {
      'pedido 201': (x) => x.status === 201,
      'trae número y token': () => c !== null && !!c.order && !!c.order.number && !!c.public_token,
    },
    { escenario: 'checkout' },
  );
}

export function limiteDeTasa() {
  const base = baseUrlSegura();
  const ip = '10.99.' + Math.floor(Math.random() * 250) + '.' + (1 + Math.floor(Math.random() * 250)); // IP propia de esta corrida (la ventana del límite dura 1 min)
  const items = lineasAleatorias();
  let limitado = 0;
  let creados = 0;
  for (let i = 0; i < 12; i++) {
    const r = http.post(base + '/api/checkout', JSON.stringify(cuerpoPedido(items, 'wompi', uuid())), {
      headers: cabeceras(ip),
      tags: { endpoint: 'limite' },
      responseCallback: http.expectedStatuses(201, 429),
    });
    if (r.status === 429) limitado++;
    if (r.status === 201) creados++;
  }
  check(null, { 'exactamente 10 pedidos y el resto 429': () => creados === 10 && limitado === 2 }, { escenario: 'limite' });
}

export function handleSummary(data) {
  return resumenA('checkout', data, textSummary);
}
