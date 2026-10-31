/**
 * Datos de servidor del checkout y de la confirmación del pedido (solo lectura). Mismo origen que el resto de la
 * tienda: Supabase con el rol de servicio (RLS niega todo a `anon`) o datos de ejemplo cuando no hay llaves.
 * Nunca se devuelven costos, notas internas, documento, celular ni correo del cliente.
 */
import 'server-only';
import { unstable_cache } from 'next/cache';
import { DOCUMENT_TYPES, soloMetodosVendibles } from '@izao/core/contracts';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';
import { ejemploPermitido } from './modo-datos';
import { TOKEN_EJEMPLO } from './checkout/adaptador';
import type { ConfigCheckout, EnlaceLegal, MetodoActivo, PoliticaLegal, MetodoReal, OpcionGeo } from './checkout/tipos';
import { aCodigoCore } from './pais';
import { elegirDestino } from './pagar/logica';
import { tienda } from './datos';
import type { CodigoPais } from './types';

type Fila = Record<string, unknown>;

export function usarSupabase(): boolean {
  const forzado = process.env.STORE_DATOS;
  if (forzado === 'ejemplo' && ejemploPermitido()) return false;
  if (forzado === 'supabase' || process.env.NODE_ENV === 'production') return true;
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
}

const upper = (p: CodigoPais) => p.toUpperCase();
const texto = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const entero = (v: unknown): string => {
  const n = typeof v === 'number' || typeof v === 'string' ? String(v) : '0';
  return /^\d{1,15}$/.test(n) ? n : '0';
};
const METODOS: readonly MetodoReal[] = ['wompi', 'addi', 'sistecredito', 'cod'];

function ok<T>(res: { data: T | null; error: { message: string } | null }, ctx: string): T | null {
  if (res.error) throw new Error(`${ctx}: ${res.error.message}`);
  return res.data;
}

// ---------------------------------------------------------------------------
// Configuración del checkout
// ---------------------------------------------------------------------------

const enlace = (p: { slug: string; title: string } | null): EnlaceLegal | null => (p ? { slug: p.slug, title: p.title } : null);

/**
 * Páginas legales del checkout por `pages.kind` (`terminos` y `tratamiento_datos`), no por slug ni título: izao-db garantiza
 * una publicada por país y tipo. Con caché de la tienda (se invalida al publicar desde el panel).
 */
async function enlacesLegales(pais: CodigoPais): Promise<PoliticaLegal> {
  const repo = tienda();
  const [terminos, datos] = await Promise.all([
    repo.paginaPorTipo(pais, 'terminos').catch(() => null),
    repo.paginaPorTipo(pais, 'tratamiento_datos').catch(() => null),
  ]);
  return { terminos: enlace(terminos), datos: enlace(datos), version: datos ? String(datos.version) : '0' };
}

/**
 * Lo mismo que `enlacesLegales` pero leído en el momento, sin caché: lo usa el checkout cuando el servidor responde
 * `DATA_POLICY_OUTDATED`, para mostrar la política que de verdad está vigente.
 */
export async function politicaVigente(pais: CodigoPais): Promise<PoliticaLegal> {
  if (!usarSupabase()) return enlacesLegales(pais);
  const r = ok(
    await crearClienteServicio()
      .from('pages')
      .select('slug,title,kind,version')
      .eq('country_code', upper(pais))
      .eq('status', 'published')
      .in('kind', ['terminos', 'tratamiento_datos']),
    'pages',
  );
  const filas = (r ?? []) as Fila[];
  const de = (kind: string) => filas.find((f) => f.kind === kind) ?? null;
  const datos = de('tratamiento_datos');
  const nombrar = (f: Fila | null) => (f ? { slug: String(f.slug), title: String(f.title) } : null);
  return { terminos: nombrar(de('terminos')), datos: nombrar(datos), version: datos ? String(datos.version) : '0' };
}

const leerConfigSupabase = unstable_cache(
  async (pais: CodigoPais): Promise<Omit<ConfigCheckout, 'terminos' | 'datos' | 'versionPoliticaDatos'>> => {
    const db = crearClienteServicio();
    const [cs, pm, rg] = await Promise.all([
      db
        .from('country_settings')
        .select('cod_enabled,cod_deposit_amount,cod_min_collect_amount,financing_surcharge_pct')
        .eq('country_code', upper(pais))
        .maybeSingle(),
      db
        .from('payment_method_settings')
        .select('method,display_name,description,sort_order,is_enabled')
        .eq('country_code', upper(pais))
        .eq('is_enabled', true)
        .order('sort_order'),
      db.from('regions').select('id,name').eq('country_code', upper(pais)).order('name'),
    ]);
    const ajustes = (ok(cs, 'country_settings') ?? {}) as Fila;
    const codHabilitado = ajustes.cod_enabled === true;
    const pct = (ajustes.financing_surcharge_pct ?? {}) as Record<string, unknown>;
    const recargo: Record<string, string> = {};
    for (const [k, v] of Object.entries(pct)) if (typeof v === 'number' || typeof v === 'string') recargo[k] = String(v);
    // Sistecrédito y cualquier método sin integración lista salen apagados aunque el panel los tenga activos.
    const filasMetodos = soloMetodosVendibles(
      ((ok(pm, 'payment_method_settings') ?? []) as Fila[]).map((m): Fila & { method: string; is_enabled: boolean } => ({ ...m, method: String(m.method), is_enabled: m.is_enabled === true })),
    );
    const metodos: MetodoActivo[] = filasMetodos
      .filter((m) => m.is_enabled && METODOS.includes(m.method as MetodoReal) && (m.method !== 'cod' || codHabilitado))
      .map((m) => ({
        method: m.method as MetodoReal,
        nombre: texto(m.display_name) ?? String(m.method),
        descripcion: texto(m.description),
      }));
    const regiones: OpcionGeo[] = ((ok(rg, 'regions') ?? []) as Fila[]).map((r) => ({ id: String(r.id), name: String(r.name) }));
    return {
      pais,
      codHabilitado,
      codAbono: entero(ajustes.cod_deposit_amount),
      codMinimoRecaudo: entero(ajustes.cod_min_collect_amount),
      recargoFinanciacion: recargo,
      metodos,
      regiones,
      tiposDocumento: [...DOCUMENT_TYPES[aCodigoCore(pais)]],
    };
  },
  ['checkout-config'],
  { revalidate: 60, tags: ['checkout-config'] },
);

const REGIONES_EJEMPLO: Record<CodigoPais, OpcionGeo[]> = {
  co: [
    { id: 'ejemplo-antioquia', name: 'Antioquia' },
    { id: 'ejemplo-bogota', name: 'Bogotá D.C.' },
    { id: 'ejemplo-valle', name: 'Valle del Cauca' },
  ],
  ec: [
    { id: 'ejemplo-pichincha', name: 'Pichincha' },
    { id: 'ejemplo-guayas', name: 'Guayas' },
  ],
};

const CIUDADES_EJEMPLO: Record<string, OpcionGeo[]> = {
  'ejemplo-antioquia': [
    { id: 'ejemplo-medellin', name: 'Medellín' },
    { id: 'ejemplo-envigado', name: 'Envigado' },
  ],
  'ejemplo-bogota': [{ id: 'ejemplo-bogota-c', name: 'Bogotá D.C.' }],
  'ejemplo-valle': [{ id: 'ejemplo-cali', name: 'Cali' }],
  'ejemplo-pichincha': [{ id: 'ejemplo-quito', name: 'Quito' }],
  'ejemplo-guayas': [{ id: 'ejemplo-guayaquil', name: 'Guayaquil' }],
};

function configEjemplo(pais: CodigoPais): Omit<ConfigCheckout, 'terminos' | 'datos' | 'versionPoliticaDatos'> {
  const co = pais === 'co';
  return {
    pais,
    codHabilitado: co,
    codAbono: co ? '10000' : '0',
    codMinimoRecaudo: co ? '20000' : '0',
    recargoFinanciacion: { addi: '10', sistecredito: '10' },
    metodos: co
      ? [
          { method: 'wompi', nombre: 'Wompi', descripcion: 'Tarjeta, PSE o Nequi.' },
          { method: 'addi', nombre: 'Addi', descripcion: 'Paga en cuotas.' },
          { method: 'cod', nombre: 'Contra entrega', descripcion: 'Un abono para confirmar y el resto al recibir.' },
        ]
      : [],
    regiones: REGIONES_EJEMPLO[pais],
    tiposDocumento: [...DOCUMENT_TYPES[aCodigoCore(pais)]],
  };
}

export async function configCheckout(pais: CodigoPais): Promise<ConfigCheckout> {
  const [base, legal] = await Promise.all([
    usarSupabase() ? leerConfigSupabase(pais) : Promise.resolve(configEjemplo(pais)),
    enlacesLegales(pais),
  ]);
  return { ...base, terminos: legal.terminos, datos: legal.datos, versionPoliticaDatos: legal.version };
}

const REGEX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const leerCiudades = unstable_cache(
  async (regionId: string): Promise<OpcionGeo[]> => {
    const r = ok(await crearClienteServicio().from('cities').select('id,name').eq('region_id', regionId).order('name'), 'cities');
    return ((r ?? []) as Fila[]).map((c) => ({ id: String(c.id), name: String(c.name) }));
  },
  ['checkout-ciudades'],
  { revalidate: 86400, tags: ['geo'] },
);

/** Ciudades (municipios o cantones) de una región del país; lista vacía si la región no es del país. */
export async function ciudadesDe(pais: CodigoPais, regionId: string): Promise<OpcionGeo[] | null> {
  if (!usarSupabase()) {
    return REGIONES_EJEMPLO[pais].some((r) => r.id === regionId) ? (CIUDADES_EJEMPLO[regionId] ?? []) : null;
  }
  if (!REGEX_UUID.test(regionId)) return null;
  const config = await leerConfigSupabase(pais);
  if (!config.regiones.some((r) => r.id === regionId)) return null;
  return leerCiudades(regionId);
}

// ---------------------------------------------------------------------------
// Pedido público (`/{pais}/pedido/{public_token}`)
// ---------------------------------------------------------------------------

export interface PedidoPublico {
  numero: string;
  pais: CodigoPais;
  estado: string;
  metodo: string;
  nombre: string;
  region: string | null;
  ciudad: string | null;
  direccion: string | null;
  lineas: { nombre: string; presentacion: string | null; cantidad: number; precio: string; descuento: string }[];
  subtotal: string;
  descuento: string;
  recargo: string;
  recargoPct: string | null;
  total: string;
  abono: string;
  recaudo: string;
  creado: string;
  pagado: string | null;
  enviado: string | null;
  entregado: string | null;
  cancelado: string | null;
  /** Enlace https de un pago pendiente (abono o pago completo) que aún no venció. */
  pagoPendiente: { url: string; proposito: 'full' | 'cod_deposit' | 'financing' } | null;
  /** Token del link de marca `/pagar/{token}` del abono; solo si el pedido espera el abono y el link sigue vigente. */
  tokenAbono: string | null;
}

export const REGEX_TOKEN = /^[A-Za-z0-9]{8,64}$/;

function ejemplo(pais: CodigoPais): PedidoPublico {
  const ahora = new Date().toISOString();
  return {
    numero: `IZ-${upper(pais)}-000000`,
    pais,
    estado: 'esperando_abono',
    metodo: 'cod',
    nombre: 'Andrea',
    region: pais === 'co' ? 'Antioquia' : 'Pichincha',
    ciudad: pais === 'co' ? 'Medellín' : 'Quito',
    direccion: 'Calle de ejemplo 10 # 20-30',
    lineas: [{ nombre: 'Aroma de ejemplo', presentacion: '100 ml', cantidad: 1, precio: pais === 'co' ? '90000' : '4990', descuento: '0' }],
    subtotal: pais === 'co' ? '90000' : '4990',
    descuento: '0',
    recargo: '0',
    recargoPct: null,
    total: pais === 'co' ? '90000' : '4990',
    abono: pais === 'co' ? '10000' : '0',
    recaudo: pais === 'co' ? '80000' : '0',
    creado: ahora,
    pagado: null,
    enviado: null,
    entregado: null,
    cancelado: null,
    pagoPendiente: null,
    tokenAbono: pais === 'co' ? 'ejemplovigente000000' : null,
  };
}

const fecha = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

export async function pedidoPublico(pais: CodigoPais, token: string): Promise<PedidoPublico | null> {
  if (!REGEX_TOKEN.test(token)) return null;
  if (!usarSupabase()) return token === TOKEN_EJEMPLO ? ejemplo(pais) : null;
  const db = crearClienteServicio();
  const o = ok(
    await db
      .from('orders')
      .select(
        'id,number,country_code,status,payment_method,subtotal,discount_amount,financing_surcharge_amount,financing_surcharge_pct,total_customer,cod_deposit_amount,cod_collect_amount,contact_first_name,shipping_region_name,shipping_city_name,shipping_address1,created_at,paid_at,sent_to_carrier_at,delivered_at,cancelled_at',
      )
      .eq('public_token', token)
      .eq('country_code', upper(pais))
      .maybeSingle(),
    'orders',
  ) as Fila | null;
  if (!o) return null;
  const id = String(o.id);
  const esperaAbono = o.status === 'esperando_abono';
  const [items, pagos, links] = await Promise.all([
    db.from('order_items').select('name_snapshot,variant_label,quantity,unit_price,line_discount').eq('order_id', id).order('created_at'),
    db
      .from('payments')
      .select('purpose,status,checkout_url,expires_at')
      .eq('order_id', id)
      .in('status', ['created', 'pending'])
      .order('created_at', { ascending: false })
      .limit(3),
    esperaAbono
      ? db
          .from('pay_links')
          .select('token,target_url,payments(status,checkout_url,expires_at)')
          .eq('order_id', id)
          .gt('expires_at', new Date().toISOString())
          .order('created_at', { ascending: false })
          .limit(1)
      : Promise.resolve(null),
  ]);
  const ahora = Date.now();
  const link = links ? (((ok(links, 'pay_links') ?? []) as Fila[])[0] ?? null) : null;
  const pagoLink = link ? ((Array.isArray(link.payments) ? link.payments[0] : link.payments) as Fila | null | undefined) : null;
  const tokenAbono =
    link &&
    elegirDestino(
      link.target_url,
      pagoLink ? { estado: String(pagoLink.status), checkoutUrl: texto(pagoLink.checkout_url), venceEn: fecha(pagoLink.expires_at) } : null,
      ahora,
    )
      ? String(link.token)
      : null;
  const pago = ((ok(pagos, 'payments') ?? []) as Fila[]).find((p) => {
    const url = texto(p.checkout_url);
    const vence = fecha(p.expires_at);
    return url?.startsWith('https://') && (!vence || new Date(vence).getTime() > ahora);
  });
  const pct = o.financing_surcharge_pct;
  return {
    numero: String(o.number),
    pais,
    estado: String(o.status),
    metodo: String(o.payment_method),
    nombre: texto(o.contact_first_name) ?? '',
    region: texto(o.shipping_region_name),
    ciudad: texto(o.shipping_city_name),
    direccion: texto(o.shipping_address1),
    lineas: ((ok(items, 'order_items') ?? []) as Fila[]).map((i) => ({
      nombre: String(i.name_snapshot),
      presentacion: texto(i.variant_label),
      cantidad: Number(i.quantity),
      precio: entero(i.unit_price),
      descuento: entero(i.line_discount),
    })),
    subtotal: entero(o.subtotal),
    descuento: entero(o.discount_amount),
    recargo: entero(o.financing_surcharge_amount),
    recargoPct: typeof pct === 'number' || typeof pct === 'string' ? String(pct) : null,
    total: entero(o.total_customer),
    abono: entero(o.cod_deposit_amount),
    recaudo: entero(o.cod_collect_amount),
    creado: String(o.created_at),
    pagado: fecha(o.paid_at),
    enviado: fecha(o.sent_to_carrier_at),
    entregado: fecha(o.delivered_at),
    cancelado: fecha(o.cancelled_at),
    pagoPendiente: pago
      ? { url: String(pago.checkout_url), proposito: pago.purpose as 'full' | 'cod_deposit' | 'financing' }
      : null,
    tokenAbono,
  };
}
