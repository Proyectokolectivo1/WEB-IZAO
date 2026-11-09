import 'server-only';
/**
 * Pagos y países (§24.1) con el cliente de servicio: lectura y escritura de `country_settings` y
 * `payment_method_settings`. Cada escritura se audita con el diff antes/después y respeta la regla de que la
 * contra entrega no puede estar activa si el país la tiene deshabilitada. Los montos ya llegan como enteros en
 * unidad menor (`ajustes.ts`); aquí no se calcula dinero.
 */
import { auditarCambio } from '@/lib/admin/auditoria';
import type { Cliente } from '../catalogo/taxonomias-servidor';
import { diffCampos, type ErroresCampo, type ResultadoAccion } from '../crud/comun';
import { traducirErrorBd } from '../crud/servidor';
import {
  MONEDA_PAIS,
  METODOS,
  horaCorta,
  minutosAHoras,
  montoATexto,
  motivoMetodoNoActivable,
  type AjustesMetodo,
  type AjustesPais,
  type MetodoPago,
  type PaisAjustes,
} from './ajustes';

type Ctx = { cliente: Cliente; actor: string; ip: string | null };
export type ResultadoAjustes = ResultadoAccion & { errores?: ErroresCampo };

const COLUMNAS_PAIS =
  'country_code, cod_enabled, cod_deposit_amount, cod_min_collect_amount, cod_link_ttl_hours, cod_reminder_offsets_minutes, cod_quiet_hours_start, cod_quiet_hours_end, cod_resend_max, financing_surcharge_pct, pending_payment_ttl_minutes, manual_order_ttl_hours, fx_rate_to_cop, carrier_provider, carrier_auto_confirm, carrier_discount_mode, carrier_wallet_low_balance, carrier_wallet_balance, carrier_wallet_balance_at, updated_at';
const COLUMNAS_METODO =
  'country_code, method, is_enabled, sort_order, display_name, description, fee_pct, fee_fixed, fee_tax_pct, updated_at';

/** Valores del formulario del país, todo como texto (lo que se ve y se edita). */
export type FormularioPais = {
  cod_enabled: boolean;
  cod_deposit_amount: string;
  cod_min_collect_amount: string;
  cod_link_ttl_hours: string;
  cod_reminder_hours: string;
  cod_quiet_hours_start: string;
  cod_quiet_hours_end: string;
  cod_resend_max: string;
  surcharge_addi: string;
  surcharge_sistecredito: string;
  pending_payment_ttl_minutes: string;
  manual_order_ttl_hours: string;
  fx_rate_to_cop: string;
  carrier_wallet_low_balance: string;
  /** `''` = sin transportadora integrada. */
  carrier_provider: string;
  carrier_auto_confirm: boolean;
  carrier_discount_mode: string;
  /** Solo lectura. Variantes activas de productos publicados sin vínculo de MasterShop en este país. */
  sin_vinculo: number;
  tiene_transportadora: boolean;
  saldo_billetera: string;
  updated_at: string | null;
};

export type FormularioMetodo = {
  method: MetodoPago;
  is_enabled: boolean;
  sort_order: string;
  display_name: string;
  description: string;
  fee_pct: string;
  fee_fixed: string;
  fee_tax_pct: string;
};

type Fila = Record<string, unknown>;

const txt = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

function recargo(json: unknown, clave: string): string {
  if (typeof json !== 'object' || json === null) return '';
  const v = (json as Record<string, unknown>)[clave];
  return v === undefined || v === null ? '' : String(v);
}

export function aFormularioPais(f: Fila, pais: PaisAjustes, sinVinculo = 0): FormularioPais {
  const moneda = MONEDA_PAIS[pais];
  return {
    cod_enabled: f.cod_enabled === true,
    cod_deposit_amount: montoATexto(f.cod_deposit_amount, moneda),
    cod_min_collect_amount: montoATexto(f.cod_min_collect_amount, moneda),
    cod_link_ttl_hours: txt(f.cod_link_ttl_hours),
    cod_reminder_hours: minutosAHoras(f.cod_reminder_offsets_minutes as number[] | null),
    cod_quiet_hours_start: horaCorta(txt(f.cod_quiet_hours_start)),
    cod_quiet_hours_end: horaCorta(txt(f.cod_quiet_hours_end)),
    cod_resend_max: txt(f.cod_resend_max),
    surcharge_addi: recargo(f.financing_surcharge_pct, 'addi'),
    surcharge_sistecredito: recargo(f.financing_surcharge_pct, 'sistecredito'),
    pending_payment_ttl_minutes: txt(f.pending_payment_ttl_minutes),
    manual_order_ttl_hours: txt(f.manual_order_ttl_hours),
    fx_rate_to_cop: txt(f.fx_rate_to_cop),
    carrier_wallet_low_balance: montoATexto(f.carrier_wallet_low_balance, moneda),
    carrier_provider: txt(f.carrier_provider),
    carrier_auto_confirm: f.carrier_auto_confirm !== false,
    carrier_discount_mode: txt(f.carrier_discount_mode) || 'prorate',
    sin_vinculo: sinVinculo,
    tiene_transportadora: f.carrier_provider !== null && f.carrier_provider !== undefined,
    saldo_billetera: montoATexto(f.carrier_wallet_balance, moneda),
    updated_at: f.updated_at ? String(f.updated_at) : null,
  };
}

export function aFormularioMetodo(f: Fila, pais: PaisAjustes): FormularioMetodo {
  const moneda = MONEDA_PAIS[pais];
  return {
    method: f.method as MetodoPago,
    is_enabled: f.is_enabled === true,
    sort_order: txt(f.sort_order),
    display_name: txt(f.display_name),
    description: txt(f.description),
    fee_pct: txt(f.fee_pct),
    fee_fixed: montoATexto(f.fee_fixed, moneda),
    fee_tax_pct: txt(f.fee_tax_pct),
  };
}

/**
 * Variantes activas en el país, de productos activos y visibles en ese país, sin `mastershop_product_id` de ESE país (D-052). Es la misma
 * condición con la que la base rechaza publicar (`sin_vinculo_mastershop`); aquí sirve para avisar y para no encender la
 * transportadora de un país que aún no tiene sus productos vinculados.
 */
export async function contarSinVinculo(cliente: Cliente, pais: PaisAjustes): Promise<number> {
  const { count, error } = await cliente
    .from('variant_countries')
    .select('variant_id, product_variants!inner(product_id, products!inner(status, product_countries!inner(country_code, is_visible)))', {
      count: 'exact',
      head: true,
    })
    .eq('country_code', pais)
    .eq('is_active', true)
    .is('mastershop_product_id', null)
    .eq('product_variants.products.status', 'active')
    .eq('product_variants.products.product_countries.country_code', pais)
    .eq('product_variants.products.product_countries.is_visible', true);
  if (error) throw new Error(`No se pudo revisar el vínculo con MasterShop: ${error.message}`);
  return count ?? 0;
}

export async function leerAjustes(
  cliente: Cliente,
  pais: PaisAjustes,
): Promise<{ pais: FormularioPais | null; metodos: FormularioMetodo[] }> {
  const [cs, pm, sinVinculo] = await Promise.all([
    cliente.from('country_settings').select(COLUMNAS_PAIS).eq('country_code', pais).maybeSingle(),
    cliente.from('payment_method_settings').select(COLUMNAS_METODO).eq('country_code', pais).order('sort_order', { ascending: true }),
    contarSinVinculo(cliente, pais),
  ]);
  if (cs.error) throw new Error(`No se pudieron leer los ajustes del país: ${cs.error.message}`);
  if (pm.error) throw new Error(`No se pudieron leer los métodos de pago: ${pm.error.message}`);
  const orden = (m: MetodoPago) => METODOS.indexOf(m);
  return {
    pais: cs.data ? aFormularioPais(cs.data as Fila, pais, sinVinculo) : null,
    metodos: ((pm.data ?? []) as Fila[])
      .map((f) => aFormularioMetodo(f, pais))
      .sort((a, b) => Number(a.sort_order) - Number(b.sort_order) || orden(a.method) - orden(b.method)),
  };
}

/** Para el diff de auditoría: bigint a texto y listas tal cual. */
function serializable(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : v]));
}

export async function guardarAjustesPaisBd(args: Ctx & { pais: PaisAjustes; datos: AjustesPais }): Promise<ResultadoAjustes> {
  const { cliente, pais, datos, actor, ip } = args;

  const { data: previa, error: errPrevia } = await cliente
    .from('country_settings')
    .select(COLUMNAS_PAIS)
    .eq('country_code', pais)
    .maybeSingle();
  if (errPrevia) return { ok: false, mensaje: traducirErrorBd(errPrevia).mensaje };
  if (!previa) return { ok: false, mensaje: 'Ese país no tiene ajustes cargados.' };
  const antes = previa as Fila;

  if (!datos.cod_enabled) {
    const { data: cod, error } = await cliente
      .from('payment_method_settings')
      .select('is_enabled')
      .eq('country_code', pais)
      .eq('method', 'cod')
      .maybeSingle();
    if (error) return { ok: false, mensaje: traducirErrorBd(error).mensaje };
    if ((cod as { is_enabled?: boolean } | null)?.is_enabled) {
      return {
        ok: false,
        mensaje: 'Revisa los campos marcados.',
        errores: { cod_enabled: 'El método "Contra entrega" sigue activo en este país. Desactívalo primero en la lista de métodos.' },
      };
    }
  }

  // Se conservan las claves de recargo que el formulario no maneja; las de Addi y Sistecrédito se reemplazan.
  const previoRecargo =
    typeof antes.financing_surcharge_pct === 'object' && antes.financing_surcharge_pct !== null
      ? { ...(antes.financing_surcharge_pct as Record<string, unknown>) }
      : {};
  delete previoRecargo.addi;
  delete previoRecargo.sistecredito;
  const recargos = { ...previoRecargo, ...datos.surcharge };

  // Colombia despacha siempre con MasterShop: apagarla dejaría sin envío los pedidos reales. Solo se puede apagar en
  // países que aún no operan con MasterShop.
  if (pais === 'CO' && datos.carrier_provider === null) {
    return {
      ok: false,
      mensaje: 'Revisa los campos marcados.',
      errores: { carrier_provider: 'Colombia envía siempre con MasterShop; no se puede quitar la transportadora de este país.' },
    };
  }

  // Encender MasterShop en un país exige que sus productos publicados ya tengan el vínculo de ESE país: si no, los
  // pedidos fallarían al crearse en la transportadora (D-052).
  if (datos.carrier_provider === 'mastershop' && antes.carrier_provider !== 'mastershop') {
    let faltan: number;
    try {
      faltan = await contarSinVinculo(cliente, pais);
    } catch {
      return { ok: false, mensaje: 'No se pudo revisar el vínculo de los productos con MasterShop. Inténtalo de nuevo.' };
    }
    if (faltan > 0) {
      return {
        ok: false,
        mensaje: 'Revisa los campos marcados.',
        errores: {
          carrier_provider: `No se puede activar MasterShop en ${pais === 'CO' ? 'Colombia' : 'Ecuador'} todavía: ${faltan} ${faltan === 1 ? 'variante publicada no tiene' : 'variantes publicadas no tienen'} el vínculo con MasterShop de este país. Vincúlalas en cada producto (sección Variantes) y vuelve a intentarlo.`,
        },
      };
    }
  }

  const nuevo = {
    cod_enabled: datos.cod_enabled,
    cod_deposit_amount: datos.cod_deposit_amount.toString(),
    cod_min_collect_amount: datos.cod_min_collect_amount.toString(),
    cod_link_ttl_hours: datos.cod_link_ttl_hours,
    cod_reminder_offsets_minutes: datos.cod_reminder_offsets_minutes,
    cod_quiet_hours_start: datos.cod_quiet_hours_start,
    cod_quiet_hours_end: datos.cod_quiet_hours_end,
    cod_resend_max: datos.cod_resend_max,
    financing_surcharge_pct: recargos,
    pending_payment_ttl_minutes: datos.pending_payment_ttl_minutes,
    manual_order_ttl_hours: datos.manual_order_ttl_hours,
    // Colombia no necesita tasa (su moneda es el peso); no se toca desde aquí.
    ...(pais === 'CO' ? {} : { fx_rate_to_cop: datos.fx_rate_to_cop }),
    carrier_wallet_low_balance: datos.carrier_wallet_low_balance === null ? null : datos.carrier_wallet_low_balance.toString(),
    ...(datos.carrier_provider === undefined ? {} : { carrier_provider: datos.carrier_provider }),
    ...(datos.carrier_auto_confirm === undefined ? {} : { carrier_auto_confirm: datos.carrier_auto_confirm }),
    ...(datos.carrier_discount_mode === undefined ? {} : { carrier_discount_mode: datos.carrier_discount_mode }),
  };

  const { error } = await cliente.from('country_settings').update(nuevo).eq('country_code', pais);
  if (error) return { ok: false, mensaje: traducirErrorBd(error).mensaje };

  const previoNorm = {
    ...antes,
    cod_quiet_hours_start: horaCorta(txt(antes.cod_quiet_hours_start)),
    cod_quiet_hours_end: horaCorta(txt(antes.cod_quiet_hours_end)),
    cod_deposit_amount: txt(antes.cod_deposit_amount),
    cod_min_collect_amount: txt(antes.cod_min_collect_amount),
    carrier_wallet_low_balance: antes.carrier_wallet_low_balance === null ? null : txt(antes.carrier_wallet_low_balance),
    fx_rate_to_cop: antes.fx_rate_to_cop === null ? null : txt(antes.fx_rate_to_cop),
  };
  const diff = diffCampos(previoNorm, serializable(nuevo));
  await auditarCambio({
    actor,
    accion: 'pagos.ajustes_pais_actualizados',
    entidad: 'country_settings',
    entidadId: pais,
    ip,
    diff,
  });
  return { ok: true, id: pais, mensaje: 'Ajustes del país guardados.' };
}

export async function guardarMetodoBd(
  args: Ctx & { pais: PaisAjustes; metodo: MetodoPago; datos: AjustesMetodo },
): Promise<ResultadoAjustes> {
  const { cliente, pais, metodo, datos, actor, ip } = args;

  const [{ data: cs, error: e1 }, { data: previo, error: e2 }] = await Promise.all([
    cliente.from('country_settings').select('cod_enabled').eq('country_code', pais).maybeSingle(),
    cliente
      .from('payment_method_settings')
      .select(COLUMNAS_METODO)
      .eq('country_code', pais)
      .eq('method', metodo)
      .maybeSingle(),
  ]);
  if (e1 || e2) return { ok: false, mensaje: traducirErrorBd((e1 ?? e2)!).mensaje };
  if (!previo) return { ok: false, mensaje: 'Ese método de pago no existe para el país.' };

  const motivo = motivoMetodoNoActivable(metodo, datos.is_enabled, (cs as { cod_enabled?: boolean } | null)?.cod_enabled === true);
  if (motivo) return { ok: false, mensaje: 'Revisa los campos marcados.', errores: { is_enabled: motivo } };

  const nuevo = {
    is_enabled: datos.is_enabled,
    sort_order: datos.sort_order,
    display_name: datos.display_name,
    description: datos.description,
    fee_pct: datos.fee_pct,
    fee_fixed: datos.fee_fixed.toString(),
    fee_tax_pct: datos.fee_tax_pct,
  };
  const { error } = await cliente
    .from('payment_method_settings')
    .update(nuevo)
    .eq('country_code', pais)
    .eq('method', metodo);
  if (error) return { ok: false, mensaje: traducirErrorBd(error).mensaje };

  const antes = previo as Fila;
  await auditarCambio({
    actor,
    accion: 'pagos.metodo_actualizado',
    entidad: 'payment_method_settings',
    entidadId: `${pais}:${metodo}`,
    ip,
    diff: diffCampos({ ...antes, fee_fixed: txt(antes.fee_fixed) }, nuevo),
  });
  return { ok: true, id: `${pais}:${metodo}`, mensaje: `${datos.display_name}: cambios guardados.` };
}
