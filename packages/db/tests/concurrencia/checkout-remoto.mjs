#!/usr/bin/env node
// Prueba de concurrencia de crear_pedido_checkout contra el Supabase remoto (ver README.md, sección "Checkout remoto").
// Dispara N llamadas simultáneas por PostgREST (cada una es su propia transacción, como en producción) y verifica:
// sin sobreventa, stock nunca negativo, stock_reserved = Σ unidades de los pedidos reservados, todo o nada por pedido,
// idempotencia por clave (y por huella), límites de código total y por cliente. Crea sus propios datos (producto en
// borrador, variantes, códigos) con un prefijo por corrida y los borra al terminar, falle o no.
//
//   node packages/db/tests/concurrencia/checkout-remoto.mjs            # N=12, RONDAS=2
//   N=20 RONDAS=3 node packages/db/tests/concurrencia/checkout-remoto.mjs
//   node packages/db/tests/concurrencia/checkout-remoto.mjs --limpiar  # borra restos de corridas abortadas
//
// Credenciales: SUPABASE_URL y SUPABASE_SECRET_KEY del entorno o de apps/web/.env.local. Nunca se imprimen.
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const N = Math.max(4, Number(process.env.N ?? 12));
const RONDAS = Math.max(1, Number(process.env.RONDAS ?? 2));
const PREF_CLAVE = 'conc-remoto-';
const PREF_SLUG = 'prueba-concurrencia-remoto-';
const PREF_CODIGO = 'CONCREMOTO';

function entorno() {
  const env = { SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY };
  for (const nombre of ['.env.local', '.env']) {
    const archivo = resolve(AQUI, '../../../../apps/web', nombre);
    if ((env.SUPABASE_URL && env.SUPABASE_SECRET_KEY) || !existsSync(archivo)) continue;
    for (const linea of readFileSync(archivo, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
      const m = linea.match(/^\s*(?:export\s+)?(SUPABASE_URL|SUPABASE_SECRET_KEY)\s*=\s*(.*?)\s*$/);
      const valor = m?.[2].replace(/^(['"])(.*)\1$/, '$2');
      if (m && valor && !env[m[1]]) env[m[1]] = valor;
    }
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) throw new Error('faltan SUPABASE_URL o SUPABASE_SECRET_KEY');
  return env;
}
const { SUPABASE_URL, SUPABASE_SECRET_KEY } = entorno();
const BASE = SUPABASE_URL.replace(/\/$/, '') + '/rest/v1';

async function rest(metodo, ruta, cuerpo, prefer = 'return=minimal') {
  const r = await fetch(BASE + ruta, {
    method: metodo,
    headers: { apikey: SUPABASE_SECRET_KEY, 'Content-Type': 'application/json', Prefer: prefer },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  const texto = await r.text();
  if (!r.ok) throw Object.assign(new Error(`${metodo} ${ruta.split('?')[0]} → ${r.status} ${texto.slice(0, 300)}`), { status: r.status, texto });
  return texto ? JSON.parse(texto) : null;
}
const rpc = (fn, args) => rest('POST', `/rpc/${fn}`, args, 'return=representation');

// ── Limpieza por prefijo (pedidos → cascada a líneas, eventos y canjes; producto → variantes y precios por país) ──
async function limpiar(prefijoClave = PREF_CLAVE, prefijoSlug = PREF_SLUG, prefijoCodigo = PREF_CODIGO) {
  await rest('DELETE', `/orders?checkout_idempotency_key=like.${encodeURIComponent(prefijoClave)}*`);
  await rest('DELETE', `/discount_codes?code=like.${encodeURIComponent(prefijoCodigo)}*`);
  await rest('DELETE', `/products?slug=like.${encodeURIComponent(prefijoSlug)}*`);
  await rest('DELETE', `/pages?slug=like.${encodeURIComponent(prefijoSlug)}*`);
}

// ── Datos de una ronda ────────────────────────────────────────────────────────────────────────────
const PRECIO = 100000; // COP, exponente 0
function sha(x) { return createHash('sha256').update(x).digest('hex'); }

async function sembrar(run) {
  const productId = randomUUID();
  const v = Object.fromEntries(['A', 'B', 'C', 'D', 'E', 'F'].map((k) => [k, randomUUID()]));
  const stock = { A: 3, B: 5, C: 5, D: 50, E: 50, F: 50 };
  await rest('POST', '/products', { id: productId, name: `Prueba concurrencia ${run}`, slug: `${PREF_SLUG}${run}`, status: 'draft' });
  await rest('POST', '/product_variants', Object.entries(v).map(([k, id], i) => ({
    id, product_id: productId, sku: `CONC-${run}-${k}`.toUpperCase(), is_default: i === 0 })));
  await rest('POST', '/variant_countries', Object.entries(v).map(([k, id]) => ({
    variant_id: id, country_code: 'CO', is_active: true, price: PRECIO, stock: stock[k] })));
  const codTotal = randomUUID();
  const codCliente = randomUUID();
  const sufijo = run.replace(/[^a-z0-9]/gi, '').toUpperCase();
  await rest('POST', '/discount_codes', [
    { id: codTotal, code: `${PREF_CODIGO}T${sufijo}`, country_code: 'CO', type: 'percent', value: 10, usage_limit_total: 2, usage_limit_per_customer: null },
    { id: codCliente, code: `${PREF_CODIGO}C${sufijo}`, country_code: 'CO', type: 'percent', value: 10, usage_limit_total: null, usage_limit_per_customer: 1 },
  ]);
  return { productId, v, stock, codTotal, codCliente };
}

// Payload igual al que arma lib/checkout (montos en texto, descuento = Σ descuento de línea)
function payload({ d, clave, lineas, politica, codigo = null, cliente = 0, hash }) {
  const items = lineas.map(([k, cant]) => ({
    product_id: d.productId, variant_id: d.v[k], sku: `SKU-${k}`, name_snapshot: 'Prueba concurrencia', variant_label: k,
    quantity: cant, unit_price: String(PRECIO), unit_cost: 40000, line_discount: codigo ? (PRECIO / 10) * cant : 0,
  }));
  const sub = items.reduce((s, i) => s + PRECIO * i.quantity, 0);
  const des = items.reduce((s, i) => s + i.line_discount, 0);
  const n = String(cliente).padStart(4, '0');
  return { p: {
    order: {
      country_code: 'CO', currency_code: 'COP', contact_first_name: 'Prueba', contact_last_name: 'Concurrencia',
      contact_phone_e164: `+57300999${n}`, contact_email: `conc${n}@test.local`, document_type: 'CC', document_number: `99${n}0000`,
      payment_method: 'wompi', subtotal: String(sub), discount_code_id: codigo, discount_amount: des,
      financing_surcharge_pct: '0.00', financing_surcharge_amount: '0', total_customer: String(sub - des),
      cod_deposit_amount: '0', cod_collect_amount: '0', product_cost_total: '0', checkout_idempotency_key: clave,
      checkout_request_hash: hash ?? sha(clave), terms_accepted_at: new Date().toISOString(), data_policy_version: politica,
      whatsapp_opt_in: false,
    },
    items,
  } };
}

// Dispara todas a la vez; guarda resultado o error HTTP y el intervalo para medir solapamiento
async function simultaneas(payloads) {
  const t0 = performance.now();
  const r = await Promise.all(payloads.map(async (p) => {
    const ini = performance.now() - t0;
    try { const v = await rpc('crear_pedido_checkout', p); return { v, ini, fin: performance.now() - t0 }; }
    catch (e) { return { error: e.message, ini, fin: performance.now() - t0 }; }
  }));
  // solapamiento máximo: cuántas peticiones estaban en vuelo a la vez
  const ev = r.flatMap((x) => [[x.ini, 1], [x.fin, -1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let vuelo = 0, max = 0;
  for (const [, d] of ev) { vuelo += d; max = Math.max(max, vuelo); }
  return { r, max };
}
const cuenta = (r, f) => r.filter(f).length;

let fallas = 0;
function verificar(cond, msj) { console.log(`${cond ? 'ok    ' : 'FALLA '} ${msj}`); if (!cond) fallas++; }

async function ronda(numero, politica) {
  const run = `${Date.now().toString(36)}${numero}`;
  const pref = `${PREF_CLAVE}${run}-`;
  console.log(`\n── Ronda ${numero} (${run}), N=${N} ──`);
  const d = await sembrar(run);
  const creados = [];
  const llevar = (r) => r.forEach((x) => x.v?.estado === 'creado' && creados.push(x.v.order.id));

  // 1. Última unidad: A stock 3, N pedidos de 1 → exactamente 3 ganadores
  {
    const { r, max } = await simultaneas([...Array(N)].map((_, i) => payload({ d, clave: `${pref}a${i}`, lineas: [['A', 1]], politica, cliente: i })));
    llevar(r);
    verificar(cuenta(r, (x) => x.error) === 0, `A: sin errores HTTP (en vuelo a la vez: ${max})`);
    verificar(cuenta(r, (x) => x.v?.estado === 'creado') === 3, `A: 3 creados de ${N} (${cuenta(r, (x) => x.v?.estado === 'creado')})`);
    verificar(cuenta(r, (x) => x.v?.motivo === 'sin_stock') === N - 3, `A: ${N - 3} rechazados por sin_stock`);
  }
  // 2. Orden cruzado: [B,C] y [C,B] de a 2 con stock 5 y 5 → 2 ganadores, sin interbloqueos
  {
    const { r, max } = await simultaneas([...Array(N)].map((_, i) => payload({ d, clave: `${pref}b${i}`, politica, cliente: 100 + i,
      lineas: i % 2 ? [['B', 2], ['C', 2]] : [['C', 2], ['B', 2]] })));
    llevar(r);
    const errores = r.filter((x) => x.error).map((x) => x.error);
    verificar(errores.length === 0, `B/C: sin errores ni interbloqueos (en vuelo: ${max})${errores.length ? ' · ' + errores[0] : ''}`);
    verificar(cuenta(r, (x) => x.v?.estado === 'creado') === 2, `B/C: 2 creados (${cuenta(r, (x) => x.v?.estado === 'creado')})`);
  }
  // 3. Misma clave y misma huella N veces (doble clic masivo) → 1 pedido; todas devuelven el mismo
  {
    const clave = `${pref}d`;
    const { r, max } = await simultaneas([...Array(N)].map(() => payload({ d, clave, lineas: [['D', 1]], politica, cliente: 200 })));
    llevar(r);
    const ids = new Set(r.map((x) => x.v?.order?.id).filter(Boolean));
    verificar(cuenta(r, (x) => x.error) === 0, `D: sin errores HTTP (en vuelo: ${max})`);
    verificar(cuenta(r, (x) => x.v?.estado === 'creado') === 1, `D: 1 creado`);
    verificar(cuenta(r, (x) => x.v?.ok === true && x.v?.estado === 'existente' && x.v?.repetido === true) === N - 1,
      `D: ${N - 1} existentes con repetido (motivos: ${[...new Set(r.map((x) => x.v?.motivo).filter(Boolean))].join(',') || '-'})`);
    verificar(ids.size === 1, `D: todas devuelven el mismo pedido (${ids.size})`);
  }
  // 4. Misma clave con huellas distintas → 1 creado, el resto idempotencia_conflicto
  {
    const clave = `${pref}e`;
    const { r, max } = await simultaneas([...Array(N)].map((_, i) => payload({ d, clave, lineas: [['E', 1]], politica, cliente: 300, hash: sha(clave + i) })));
    llevar(r);
    verificar(cuenta(r, (x) => x.error) === 0, `E: sin errores HTTP (en vuelo: ${max})`);
    verificar(cuenta(r, (x) => x.v?.estado === 'creado') === 1, `E: 1 creado`);
    verificar(cuenta(r, (x) => x.v?.motivo === 'idempotencia_conflicto') === N - 1, `E: ${N - 1} idempotencia_conflicto`);
  }
  // 5. Código con límite total 2 (clientes distintos) → 2 creados; los rechazados no dejan stock reservado
  {
    const { r, max } = await simultaneas([...Array(N)].map((_, i) => payload({ d, clave: `${pref}f${i}`, lineas: [['F', 1]], politica, codigo: d.codTotal, cliente: 400 + i })));
    llevar(r);
    verificar(cuenta(r, (x) => x.error) === 0, `F: sin errores HTTP (en vuelo: ${max})`);
    verificar(cuenta(r, (x) => x.v?.estado === 'creado') === 2, `F: 2 creados con el código de límite 2`);
    verificar(cuenta(r, (x) => x.v?.motivo === 'limite_total') === N - 2, `F: ${N - 2} rechazados por limite_total`);
  }
  // 6. Código con 1 uso por cliente, mismo cliente, claves distintas → 1 creado
  {
    const { r, max } = await simultaneas([...Array(N)].map((_, i) => payload({ d, clave: `${pref}g${i}`, lineas: [['F', 1]], politica, codigo: d.codCliente, cliente: 500 })));
    llevar(r);
    verificar(cuenta(r, (x) => x.error) === 0, `G: sin errores HTTP (en vuelo: ${max})`);
    verificar(cuenta(r, (x) => x.v?.estado === 'creado') === 1, `G: 1 creado por cliente`);
    verificar(cuenta(r, (x) => x.v?.motivo === 'limite_por_cliente') === N - 1, `G: ${N - 1} rechazados por limite_por_cliente`);
  }

  // ── Invariantes sobre la base ──
  const ids = Object.values(d.v).join(',');
  const vc = await rest('GET', `/variant_countries?country_code=eq.CO&variant_id=in.(${ids})&select=variant_id,stock,stock_reserved`, undefined, '');
  const pedidos = await rest('GET', `/orders?checkout_idempotency_key=like.${encodeURIComponent(pref)}*&select=id,stock_state,order_items(variant_id,quantity)`, undefined, '');
  const reservado = {};
  for (const o of pedidos) if (o.stock_state === 'reserved') for (const i of o.order_items) reservado[i.variant_id] = (reservado[i.variant_id] ?? 0) + i.quantity;
  for (const [k, id] of Object.entries(d.v)) {
    const f = vc.find((x) => x.variant_id === id);
    verificar(f && f.stock === d.stock[k] && f.stock >= 0 && f.stock_reserved >= 0 && f.stock_reserved <= f.stock
      && f.stock_reserved === (reservado[id] ?? 0),
      `${k}: stock ${f?.stock} intacto, reservado ${f?.stock_reserved} = Σ pedidos reservados ${reservado[id] ?? 0} ≤ stock`);
  }
  verificar(pedidos.length === creados.length && pedidos.every((o) => o.stock_state === 'reserved'),
    `pedidos en la base = creados (${pedidos.length}/${creados.length}) y todos reservados: los rechazos no dejan filas`);
  const codigos = await rest('GET', `/discount_codes?id=in.(${d.codTotal},${d.codCliente})&select=id,usage_count,discount_redemptions(status)`, undefined, '');
  for (const c of codigos) {
    const esp = c.id === d.codTotal ? 2 : 1;
    verificar(c.usage_count === esp && c.discount_redemptions.filter((x) => x.status === 'reserved').length === esp
      && c.discount_redemptions.length === esp, `código ${c.id === d.codTotal ? 'total' : 'por cliente'}: usage_count ${c.usage_count} = canjes ${c.discount_redemptions.length} = ${esp}`);
  }
  return run;
}

async function main() {
  console.log(`Supabase: ${new URL(SUPABASE_URL).host}`);
  if (process.argv.includes('--limpiar')) { await limpiar(); console.log('restos borrados'); return; }
  let politica = await rpc('politica_datos_vigente', { p_pais: 'CO' });
  try {
    if (!politica) {
      // Sin política publicada (antes del lanzamiento): una página temporal de la prueba, que se borra al final
      await rest('POST', '/pages', { country_code: 'CO', slug: `${PREF_SLUG}datos`, title: 'Prueba de concurrencia',
        content_html: '<p>Página temporal de la prueba de concurrencia.</p>', version: 1, status: 'published', kind: 'tratamiento_datos' });
      politica = await rpc('politica_datos_vigente', { p_pais: 'CO' });
      console.log(`política de datos temporal de la prueba (versión ${politica})`);
    }
    for (let i = 1; i <= RONDAS; i++) await ronda(i, politica);
  } finally {
    await limpiar();
    const restos = await rest('GET', `/orders?checkout_idempotency_key=like.${PREF_CLAVE}*&select=id`, undefined, '');
    const prods = await rest('GET', `/products?slug=like.${PREF_SLUG}*&select=id`, undefined, '');
    const pags = await rest('GET', `/pages?slug=like.${PREF_SLUG}*&select=id`, undefined, '');
    verificar(restos.length === 0 && prods.length === 0 && pags.length === 0, 'limpieza: sin pedidos, productos ni páginas de prueba en la base');
  }
  console.log(fallas ? `\nFALLA: ${fallas} verificaciones` : '\nOK: checkout concurrente sin sobreventa, reservas consistentes e idempotente');
  process.exitCode = fallas ? 1 : 0;
}
main().catch((e) => { console.error('ERROR:', e.message); process.exitCode = 2; });
