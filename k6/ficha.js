// Ficha de producto (§7.6): GET /{pais}/perfume/{slug} sostenido, mezcla CO/EC con productos reales del seed.
// La especificación no fija el presupuesto de la ficha: por defecto p95 < 300 ms (HTML cacheado) y errores < 1 %;
// se ajusta con -e P95_MS=... y, si cambia, se registra en docs/DECISIONES.md.
//
//   k6 run -e BASE_URL=http://127.0.0.1:3100 k6/ficha.js
//   k6 run -e BASE_URL=http://127.0.0.1:3100 -e PERFIL=humo k6/ficha.js
import http from 'k6/http';
import { check } from 'k6';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.4/index.js';
import { baseUrlSegura, elegir, perfil, resumenA, visiblesEn } from './lib/comun.js';

const P95_MS = Number(__ENV.P95_MS || 300);
const EN = { co: visiblesEn('co'), ec: visiblesEn('ec') };

export const options = {
  scenarios: {
    ficha: { executor: 'constant-arrival-rate', timeUnit: '1s', exec: 'ficha', ...perfil(50, '2m') },
  },
  thresholds: {
    'http_req_duration{endpoint:ficha}': ['p(95)<' + P95_MS],
    'http_req_failed{endpoint:ficha}': ['rate<0.01'],
    dropped_iterations: ['count<1'],
    checks: ['rate>0.99'],
  },
};

export function setup() {
  baseUrlSegura();
}

export function ficha() {
  const base = baseUrlSegura();
  const pais = Math.random() < 0.7 ? 'co' : 'ec';
  const p = elegir(EN[pais]);
  const r = http.get(base + '/' + pais + '/perfume/' + p.slug, { tags: { endpoint: 'ficha' } });
  check(r, {
    'estado 200': (x) => x.status === 200,
    'es HTML': (x) => String(x.headers['Content-Type'] || '').includes('text/html'),
    'trae JSON-LD Product': (x) => x.body !== null && String(x.body).includes('"@type":"Product"'),
  });
}

export function handleSummary(data) {
  return resumenA('ficha', data, textSummary);
}
