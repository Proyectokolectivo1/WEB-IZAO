/**
 * Jobs de contra entrega con abono (§13.1, §13.2, D-025). Cola `contraentrega`:
 * - `cod.iniciar`: único creador del link de Wompi del abono (fila `payments` reservada antes con `{número}-A{n}`),
 *   del token `/pagar/{token}` y del cobro inmediato `cobro_abono`; programa abandono y recordatorios.
 * - `cod.recordatorio`: reenvía el cobro con la plantilla que toque si el pedido sigue `esperando_abono`.
 * - `cod.abandono`: a la hora de vencimiento pasa a `abandonado` y libera stock y código (nunca va a MasterShop).
 * Todo es idempotente (ids de job fijos, filas reutilizables y estado releído) y el reloj se inyecta.
 * Plantillas, offsets, horario silencioso y vigencia son datos de la base; aquí no hay valores quemados.
 */
import { randomBytes } from 'node:crypto';
import { formatMoney, money } from '@izao/core/money';
import { transicionar } from '@izao/core/order-state';
import {
  ErrorWhatsApp,
  mensajePlantilla,
  type ClavePlantillaCod,
  type ClienteWhatsApp,
  type CredencialesWhatsApp,
  type ValoresCobro,
  urlPagoAbono,
} from '@izao/whatsapp';
import { ErrorWompi, type EntradaLinkAbono, type LinkPagoCreado, type WompiCredentials } from '@izao/wompi';
import type { AbonoFila, FuenteCod, PayLinkFila, PedidoCod } from './fuente.js';
import { enSilencio, finDelSilencio, planRecordatorios, plantillaRecordatorio } from './plan.js';

export class ErrorReintentableCod extends Error {
  constructor(motivo: string) {
    super(`cod: ${motivo}`);
    this.name = 'ErrorReintentableCod';
  }
}

export type JobProgramado =
  | { tipo: 'recordatorio'; order_id: string; n: number; en: Date }
  | { tipo: 'abandono'; order_id: string; en: Date };

export interface DepsCod {
  fuente: FuenteCod;
  wompi: (c: WompiCredentials) => { crearLink(e: EntradaLinkAbono): Promise<LinkPagoCreado> };
  whatsapp: (c: CredencialesWhatsApp) => ClienteWhatsApp;
  /** Job retrasado con id fijo (`cod.recordatorio.{id}.{n}`, `cod.abandono.{id}`): repetir no duplica. */
  programar: (j: JobProgramado) => Promise<void>;
  /** Respaldo si WhatsApp falla y el cliente dejó correo. */
  correoRespaldo?: (c: { order_id: string; email: string; url: string }) => Promise<void>;
  /** Origen público https (`SITE_URL`). */
  urlSitio: string;
  ahora?: () => Date;
  generarToken?: () => string;
}

export type AccionCod =
  | 'iniciado'
  | 'omitido'
  | 'pedido_no_encontrado'
  | 'link_fallido'
  | 'enviado'
  | 'ya_enviado'
  | 'no_enviado'
  | 'abandonado'
  | 'reprogramado'
  | 'tope_alcanzado'
  | 'link_vencido';

export interface ResultadoCod {
  accion: AccionCod;
  /** Con `reprogramado` de `cod.reenviar`: cuándo debe correr (fin del horario silencioso). */
  en?: Date;
}

/** Vigencia mínima del link que debe quedar al enviar fuera del silencio (misma regla que los recordatorios). */
const MIN_VIGENCIA_MS = 3_600_000;

const ACTOR = 'system';
const COBRABLE = new Set(['created', 'pending']);

function origen(deps: DepsCod): string {
  const u = deps.urlSitio.replace(/\/+$/, '');
  if (!/^https:\/\/[^\s/]+$/.test(u)) throw new RangeError('SITE_URL debe ser un origen https.');
  return u;
}

function fechaLocal(d: Date, zona: string): string {
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: zona,
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
}

function valores(p: PedidoCod, vence: Date, zona: string, urlPago: string): ValoresCobro {
  return {
    customer_first_name: p.contact_first_name.trim().split(/\s+/)[0] ?? p.contact_first_name,
    order_number: p.number,
    cod_deposit_amount: formatMoney(money(p.cod_deposit_amount, p.currency_code)),
    cod_collect_amount: formatMoney(money(p.cod_collect_amount, p.currency_code)),
    pay_link_expires_at: fechaLocal(vence, zona),
    pay_link_url: urlPago,
  };
}

/** Token de `/pagar/{token}`: 128 bits (22 caracteres base64url). */
function tokenNuevo(deps: DepsCod): string {
  return deps.generarToken ? deps.generarToken() : randomBytes(16).toString('base64url');
}

async function asegurarLink(deps: DepsCod, p: PedidoCod, vence: Date): Promise<AbonoFila | 'pagado' | 'fallido'> {
  const { fuente } = deps;
  const leer = async () => fuente.abonos(p.id);
  let abonos = await leer();
  if (abonos.some((a) => a.status === 'approved')) return 'pagado';
  const conLink = abonos.filter((a) => a.payment_link_id && a.checkout_url && COBRABLE.has(a.status)).at(-1);
  if (conLink) return conLink;

  let fila = abonos.filter((a) => !a.payment_link_id && a.status === 'created').at(-1);
  if (!fila) {
    const ref = `${p.number}-A${abonos.length + 1}`;
    const r = await fuente.reservarAbono({
      order_id: p.id,
      amount: p.cod_deposit_amount,
      currency_code: p.currency_code,
      provider_reference: ref,
      expires_at: vence,
    });
    abonos = await leer();
    fila = abonos.find((a) => (r.ok ? a.id === r.id : a.provider_reference === ref));
    if (!fila) throw new ErrorReintentableCod('abono_no_reservado');
    if (fila.payment_link_id && fila.checkout_url) return fila;
  }

  const creds = await fuente.credencialesWompi();
  if (!creds) throw new ErrorReintentableCod('sin_credenciales_wompi');
  let link: LinkPagoCreado;
  try {
    link = await deps.wompi(creds).crearLink({
      numeroPedido: p.number,
      montoAbono: p.cod_deposit_amount,
      moneda: p.currency_code,
      expiraEn: vence,
      urlRetorno: `${origen(deps)}/${p.country_code.toLowerCase()}/pedido/${encodeURIComponent(p.public_token)}`,
    });
  } catch (e) {
    if (e instanceof ErrorWompi && !e.reintentable) {
      await fuente.registrarAlerta(p.id, 'link_abono_fallido', { codigo: e.codigo });
      return 'fallido';
    }
    throw new ErrorReintentableCod(e instanceof ErrorWompi ? e.codigo : 'link');
  }
  await fuente.guardarLink(fila.id, { payment_link_id: link.id, checkout_url: link.url });
  return { ...fila, payment_link_id: link.id, checkout_url: link.url };
}

async function asegurarPayLink(deps: DepsCod, p: PedidoCod, abono: AbonoFila, vence: Date): Promise<PayLinkFila> {
  const actual = await deps.fuente.payLink(p.id);
  if (actual) return actual;
  const nuevo: PayLinkFila = { token: tokenNuevo(deps), payment_id: abono.id, target_url: abono.checkout_url!, expires_at: vence };
  await deps.fuente.crearPayLink({ ...nuevo, order_id: p.id });
  const leido = await deps.fuente.payLink(p.id);
  if (!leido) throw new ErrorReintentableCod('pay_link');
  return leido;
}

/**
 * Envía una plantilla una sola vez por (plantilla, hora programada). Error reintentable → lanza (BullMQ reintenta y
 * la fila `queued` se reutiliza); error definitivo → fila `failed` y alerta. Devuelve si quedó enviado.
 */
async function enviar(
  deps: DepsCod,
  p: PedidoCod,
  key: ClavePlantillaCod,
  programadoPara: Date,
  pay: PayLinkFila,
  zona: string,
): Promise<'enviado' | 'ya_enviado' | 'no_enviado'> {
  const { fuente } = deps;
  const previos = await fuente.mensajes(p.id);
  if (previos.some((m) => m.template_key === key && m.scheduled_for?.getTime() === programadoPara.getTime() && m.status !== 'queued')) {
    return 'ya_enviado';
  }
  const creds = await fuente.credencialesWhatsApp(p.country_code);
  if (!creds) {
    await fuente.registrarAlerta(p.id, 'whatsapp_sin_credenciales', { plantilla: key });
    return 'no_enviado';
  }
  const plantilla = await fuente.plantillaActiva(p.country_code, key);
  if (!plantilla) {
    await fuente.registrarAlerta(p.id, 'plantilla_no_activa', { plantilla: key });
    return 'no_enviado';
  }
  const msg = mensajePlantilla(plantilla, { to: p.contact_phone_e164, valores: valores(p, pay.expires_at, zona, urlPagoAbono(origen(deps), p.country_code, pay.token)), tokenBoton: pay.token });
  const id = await fuente.prepararMensaje({ order_id: p.id, template_id: plantilla.id, to_e164: p.contact_phone_e164, scheduled_for: programadoPara });
  try {
    const r = await deps.whatsapp(creds).enviarPlantilla(msg);
    await fuente.marcarMensaje(id, { status: 'sent', wa_message_id: r.wa_message_id, sent_at: (deps.ahora ?? (() => new Date()))() });
    return 'enviado';
  } catch (e) {
    if (e instanceof ErrorWhatsApp && !e.reintentable) {
      await fuente.marcarMensaje(id, { status: 'failed', error_code: e.metaCode ?? e.codigo, error_text: e.codigo });
      await fuente.registrarAlerta(p.id, 'whatsapp_fallido', { plantilla: key, codigo: e.metaCode ?? e.codigo });
      return 'no_enviado';
    }
    throw new ErrorReintentableCod(e instanceof ErrorWhatsApp ? e.codigo : 'whatsapp');
  }
}

export async function iniciarCod(orderId: string, deps: DepsCod): Promise<ResultadoCod> {
  const { fuente } = deps;
  const ahora = (deps.ahora ?? (() => new Date()))();
  const p = await fuente.pedido(orderId);
  if (!p) return { accion: 'pedido_no_encontrado' };
  if (p.payment_method !== 'cod' || p.status !== 'esperando_abono') return { accion: 'omitido' };
  const vence = p.stock_reserved_until;
  await deps.programar({ tipo: 'abandono', order_id: p.id, en: vence ?? ahora });
  if (!vence || vence.getTime() <= ahora.getTime()) return { accion: 'omitido' };
  const cfg = await fuente.config(p.country_code);
  if (!cfg) throw new ErrorReintentableCod('sin_config');

  const abono = await asegurarLink(deps, p, vence);
  if (abono === 'pagado') return { accion: 'omitido' };
  if (abono === 'fallido') return { accion: 'link_fallido' };
  const pay = await asegurarPayLink(deps, p, abono, vence);

  const r = await enviar(deps, p, 'cobro_abono', p.created_at, pay, cfg.zona);
  if (r === 'no_enviado' && p.contact_email && deps.correoRespaldo) {
    await deps.correoRespaldo({ order_id: p.id, email: p.contact_email, url: urlPagoAbono(origen(deps), p.country_code, pay.token) });
  }

  for (const rec of planRecordatorios({ creado: p.created_at, venceEn: vence, offsetsMinutos: cfg.offsetsMinutos, silencio: cfg.silencio, zona: cfg.zona })) {
    if (rec.enviarEn.getTime() > ahora.getTime()) await deps.programar({ tipo: 'recordatorio', order_id: p.id, n: rec.n, en: rec.enviarEn });
  }
  return { accion: 'iniciado' };
}

export async function recordatorioCod(orderId: string, n: number, deps: DepsCod): Promise<ResultadoCod> {
  const { fuente } = deps;
  const ahora = (deps.ahora ?? (() => new Date()))();
  const p = await fuente.pedido(orderId);
  if (!p) return { accion: 'pedido_no_encontrado' };
  if (p.payment_method !== 'cod' || p.status !== 'esperando_abono') return { accion: 'omitido' };
  if (!p.stock_reserved_until || p.stock_reserved_until.getTime() <= ahora.getTime()) return { accion: 'omitido' };
  const cfg = await fuente.config(p.country_code);
  if (!cfg) throw new ErrorReintentableCod('sin_config');
  const offset = cfg.offsetsMinutos[n - 1];
  if (!Number.isInteger(n) || n < 1 || offset === undefined) return { accion: 'omitido' };
  const pay = await fuente.payLink(p.id);
  if (!pay || pay.expires_at.getTime() <= ahora.getTime()) {
    await fuente.registrarAlerta(p.id, 'recordatorio_sin_link', { n: String(n) });
    return { accion: 'no_enviado' };
  }
  // La hora programada (creación + offset) identifica el recordatorio aunque el silencio lo haya movido.
  const programado = new Date(p.created_at.getTime() + offset * 60_000);
  const key = plantillaRecordatorio(n, cfg.offsetsMinutos.length);
  return { accion: await enviar(deps, p, key, programado, pay, cfg.zona) };
}

export async function abandonarCod(orderId: string, deps: DepsCod): Promise<ResultadoCod> {
  const { fuente } = deps;
  const ahora = (deps.ahora ?? (() => new Date()))();
  const p = await fuente.pedido(orderId);
  if (!p) return { accion: 'pedido_no_encontrado' };
  if (p.status === 'esperando_abono') {
    const vence = p.stock_reserved_until;
    if (vence && vence.getTime() > ahora.getTime()) {
      await deps.programar({ tipo: 'abandono', order_id: p.id, en: vence });
      return { accion: 'reprogramado' };
    }
    const t = transicionar({ from: 'esperando_abono', to: 'abandonado', actor: ACTOR, payload: { motivo: 'abono_no_recibido' } });
    if (!t.ok) throw new Error(`Transición inválida: ${t.error.code}`);
    if (!(await fuente.aplicarTransicion(p.id, t.event, { abandoned_at: ahora }))) return { accion: 'omitido' };
  } else if (!(p.status === 'abandonado' && p.stock_state === 'reserved')) {
    return { accion: 'omitido' };
  }
  // Reintento tras una falla entre la transición y la liberación: liberar es idempotente en la base.
  const stock = await fuente.liberarStock(p.id);
  if (!stock.ok) throw new ErrorReintentableCod('liberar_stock');
  await fuente.liberarCanje(p.id);
  return { accion: 'abandonado' };
}

/**
 * `cod.reenviar` ("Reenviar cobro" del panel): vuelve a enviar `cobro_abono` con `scheduled_for = solicitadoEn`, una
 * fila nueva bajo `whatsapp_messages_envio_unico_key`; el reintento del mismo job encuentra esa fila y no duplica.
 * Solo con el pedido en `esperando_abono` y el link vigente; tope `country_settings.cod_resend_max`; en horario
 * silencioso se reprograma al fin si al link le queda al menos 1 h.
 */
export async function reenviarCod(orderId: string, solicitadoEn: Date, deps: DepsCod): Promise<ResultadoCod> {
  const { fuente } = deps;
  const ahora = (deps.ahora ?? (() => new Date()))();
  const p = await fuente.pedido(orderId);
  if (!p) return { accion: 'pedido_no_encontrado' };
  if (p.payment_method !== 'cod' || p.status !== 'esperando_abono') return { accion: 'omitido' };
  const pay = await fuente.payLink(p.id);
  if (!pay || pay.expires_at.getTime() <= ahora.getTime()) return { accion: 'link_vencido' };
  const cfg = await fuente.config(p.country_code);
  if (!cfg) throw new ErrorReintentableCod('sin_config');

  const tope = await fuente.topeReenvios(p.country_code);
  if (tope === null) {
    await fuente.registrarAlerta(p.id, 'reenvio_sin_tope', { pais: p.country_code });
    return { accion: 'no_enviado' };
  }
  const previos = await fuente.mensajes(p.id);
  const reenvios = previos.filter((m) => {
    const t = m.scheduled_for?.getTime();
    return m.template_key === 'cobro_abono' && t !== undefined && t !== p.created_at.getTime() && t !== solicitadoEn.getTime();
  }).length;
  if (reenvios >= tope) {
    await fuente.registrarAlerta(p.id, 'reenvio_tope_alcanzado', { tope: String(tope) });
    return { accion: 'tope_alcanzado' };
  }
  if (enSilencio(ahora, cfg.silencio, cfg.zona)) {
    const en = finDelSilencio(ahora, cfg.silencio, cfg.zona);
    if (pay.expires_at.getTime() - en.getTime() < MIN_VIGENCIA_MS) return { accion: 'link_vencido' };
    return { accion: 'reprogramado', en };
  }

  const r = await enviar(deps, p, 'cobro_abono', solicitadoEn, pay, cfg.zona);
  if (r === 'no_enviado' && p.contact_email && deps.correoRespaldo) {
    await deps.correoRespaldo({ order_id: p.id, email: p.contact_email, url: urlPagoAbono(origen(deps), p.country_code, pay.token) });
  }
  return { accion: r };
}
