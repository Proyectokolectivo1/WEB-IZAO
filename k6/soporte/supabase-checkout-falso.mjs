/**
 * Supabase FALSO para las pruebas de carga del carrito y del checkout (k6). Zona de izao-qa.
 *
 * Responde, con la forma exacta que valida `apps/web/lib/checkout/fuente-supabase.ts`, lo que necesitan
 * `POST /api/checkout/preview` y `POST /api/checkout`. No guarda nada: no hay stock real, ni base, ni Redis.
 * Por eso la prueba mide el costo de la APLICACIÓN (validación, recálculo con @izao/core, huella, serialización)
 * y NO el de la base real. La latencia de la base se simula con `FALSO_LATENCIA_MS` (por consulta; defecto 8 ms,
 * aprox. VPS y Supabase en Europa). El p95 real con Postgres hay que medirlo en staging.
 *
 *   node k6/soporte/supabase-checkout-falso.mjs        # puerto 38398 (FALSO_PUERTO)
 *
 * Tablas: country_settings, payment_method_settings, product_variants, product_option_values, discount_codes (vacía),
 * cities, orders (vacía), integration_credentials (vacía: el link de Wompi queda en `payment: null`).
 * RPC: politica_datos_vigente, crear_pedido_checkout, claves_cliente.
 * GET /__estadisticas devuelve el conteo de consultas y de pedidos creados.
 */
import http from 'node:http';
import crypto from 'node:crypto';

const puerto = Number(process.env.FALSO_PUERTO ?? 38398);
const latencia = Number(process.env.FALSO_LATENCIA_MS ?? 8);

/** Ids fijos que usa `k6/checkout.js` (geografía de CO). */
export const REGION_CO = '11111111-1111-4111-8111-111111111111';
export const CIUDAD_CO = '22222222-2222-4222-8222-222222222222';

const stats = { consultas: 0, rpc: 0, pedidos: 0, porRuta: {} };
let contador = 0;

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

function responder(res, estado, cuerpo, cabeceras = {}) {
  const texto = cuerpo === undefined ? '' : JSON.stringify(cuerpo);
  res.writeHead(estado, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(texto), ...cabeceras });
  res.end(texto);
}

/** `id=in.(a,b)` o `id=eq.a` -> lista de ids. */
function idsDe(parametros, campo = 'id') {
  const v = parametros.get(campo);
  if (!v) return [];
  const m = /^in\.\((.*)\)$/.exec(v);
  if (m) return m[1].split(',').map((x) => x.replace(/"/g, '').trim()).filter(Boolean);
  const e = /^eq\.(.*)$/.exec(v);
  return e ? [e[1]] : [];
}

/** Precio estable por id (COP, múltiplos de 100) entre 89.900 y 389.900. */
function precioDe(id) {
  const h = crypto.createHash('sha1').update(id).digest();
  return 89900 + (h[0] % 31) * 10000;
}

function filaVariante(id) {
  const precio = precioDe(id);
  const pid = id.replace(/^(.{8})/, 'aaaaaaaa');
  return {
    id,
    product_id: pid,
    sku: 'SKU-' + id.slice(0, 8),
    option_value_ids: null,
    weight_kg: '0.4',
    products: {
      name: 'Perfume de prueba ' + id.slice(0, 4),
      status: 'active',
      product_categories: [],
      product_countries: [{ country_code: 'CO', is_visible: true }],
    },
    variant_countries: [
      {
        country_code: 'CO',
        is_active: true,
        price: String(precio),
        compare_at_price: null,
        cost: String(Math.round(precio * 0.5)),
        stock: 1000000,
        stock_reserved: 0,
        mastershop_product_id: 1,
        mastershop_variant_id: 1,
      },
    ],
  };
}

function tabla(nombre, parametros) {
  switch (nombre) {
    case 'country_settings':
      return [
        {
          country_code: 'CO',
          cod_enabled: true,
          cod_deposit_amount: '20000',
          cod_min_collect_amount: '0',
          financing_surcharge_pct: { addi: 10, sistecredito: 10 },
        },
      ];
    case 'payment_method_settings':
      return [
        { method: 'wompi', is_enabled: true, sort_order: 1 },
        { method: 'addi', is_enabled: true, sort_order: 2 },
        { method: 'cod', is_enabled: true, sort_order: 3 },
      ];
    case 'product_variants':
      return idsDe(parametros).map(filaVariante);
    case 'product_option_values':
      return [];
    case 'cities':
      return idsDe(parametros).map((id) => ({
        id,
        name: 'Medellín',
        region_id: REGION_CO,
        regions: { id: REGION_CO, name: 'Antioquia', country_code: 'CO' },
      }));
    case 'discount_codes':
    case 'orders':
    case 'integration_credentials':
    case 'discount_redemptions':
    case 'influencers':
      return [];
    default:
      return null;
  }
}

function rpc(nombre, args) {
  if (nombre === 'politica_datos_vigente') return { estado: 200, cuerpo: '2026-10' };
  if (nombre === 'claves_cliente') return { estado: 200, cuerpo: [] };
  if (nombre === 'crear_pedido_checkout') {
    const { order, items } = args.p;
    stats.pedidos += 1;
    contador += 1;
    const estado = order.payment_method === 'cod' ? 'esperando_abono' : 'pendiente_pago';
    return {
      estado: 200,
      cuerpo: {
        ok: true,
        estado: 'creado',
        repetido: false,
        order: {
          id: crypto.randomUUID(),
          number: 'IZ-CO-' + String(900000 + contador),
          public_token: crypto.randomBytes(18).toString('base64url'),
          status: estado,
          country_code: order.country_code,
          currency_code: order.currency_code,
          payment_method: order.payment_method,
          subtotal: String(order.subtotal),
          discount_amount: String(order.discount_amount ?? 0),
          financing_surcharge_amount: String(order.financing_surcharge_amount ?? 0),
          total_customer: String(order.total_customer),
          cod_deposit_amount: String(order.cod_deposit_amount ?? 0),
          cod_collect_amount: String(order.cod_collect_amount ?? 0),
          lines: items.map((i) => ({
            variant_id: i.variant_id,
            name_snapshot: i.name_snapshot,
            variant_label: i.variant_label,
            quantity: i.quantity,
            unit_price: String(i.unit_price),
            line_discount: String(i.line_discount ?? 0),
          })),
        },
      },
    };
  }
  return null;
}

const servidor = http.createServer((req, res) => {
  const partes = [];
  req.on('data', (c) => partes.push(c));
  req.on('end', async () => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/__estadisticas') return responder(res, 200, stats);
    const m = /^\/rest\/v1\/(rpc\/)?([a-z_]+)$/.exec(url.pathname);
    if (!m) return responder(res, 404, { message: 'no existe en el Supabase falso' });
    stats.porRuta[m[2]] = (stats.porRuta[m[2]] ?? 0) + 1;
    if (latencia > 0) await pausa(latencia);
    if (m[1]) {
      stats.rpc += 1;
      let args = {};
      try {
        args = JSON.parse(Buffer.concat(partes).toString('utf8') || '{}');
      } catch {
        /* sin cuerpo */
      }
      const r = rpc(m[2], args);
      return r ? responder(res, r.estado, r.cuerpo) : responder(res, 404, { message: 'rpc ' + m[2] + ' no existe' });
    }
    stats.consultas += 1;
    const filas = tabla(m[2], url.searchParams);
    if (filas === null) return responder(res, 404, { message: 'tabla ' + m[2] + ' no existe' });
    return responder(res, 200, req.method === 'HEAD' ? undefined : filas, { 'content-range': `0-${Math.max(0, filas.length - 1)}/${filas.length}` });
  });
});

servidor.listen(puerto, '127.0.0.1', () => {
  console.log(`Supabase falso de carga en http://127.0.0.1:${puerto} (latencia por consulta ${latencia} ms)`);
});
