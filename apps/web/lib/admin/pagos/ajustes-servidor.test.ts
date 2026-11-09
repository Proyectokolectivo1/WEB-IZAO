import { beforeEach, describe, expect, it, vi } from 'vitest';

const { auditar } = vi.hoisted(() => ({ auditar: vi.fn(async (_e: unknown) => true) }));
vi.mock('@/lib/admin/auditoria', () => ({ auditarCambio: auditar }));

import { clienteFalso } from '../crud/cliente-falso';
import { esquemaAjustesPais, esquemaMetodo } from './ajustes';
import { aFormularioPais, contarSinVinculo, guardarAjustesPaisBd, guardarMetodoBd, leerAjustes } from './ajustes-servidor';

const comun = { actor: 'admin-1', ip: null };

const FILA_CO = {
  country_code: 'CO',
  cod_enabled: true,
  cod_deposit_amount: 10000,
  cod_min_collect_amount: 20000,
  cod_link_ttl_hours: 24,
  cod_reminder_offsets_minutes: [180, 720, 1260],
  cod_quiet_hours_start: '21:00:00',
  cod_quiet_hours_end: '07:00:00',
  cod_resend_max: 2,
  financing_surcharge_pct: { addi: 10, sistecredito: 10, otro: 5 },
  pending_payment_ttl_minutes: 60,
  manual_order_ttl_hours: 24,
  fx_rate_to_cop: 1,
  carrier_provider: 'mastershop',
  carrier_wallet_low_balance: 100000,
  carrier_wallet_balance: 250000,
  carrier_wallet_balance_at: null,
  updated_at: '2026-10-20T10:00:00Z',
};

const FORM_CO = {
  cod_enabled: 'on',
  cod_deposit_amount: '12000',
  cod_min_collect_amount: '20000',
  cod_link_ttl_hours: '24',
  cod_reminder_hours: '3, 12, 21',
  cod_quiet_hours_start: '21:00',
  cod_quiet_hours_end: '07:00',
  cod_resend_max: '0',
  surcharge_addi: '11',
  surcharge_sistecredito: '10',
  pending_payment_ttl_minutes: '60',
  manual_order_ttl_hours: '24',
  fx_rate_to_cop: '',
  carrier_wallet_low_balance: '150000',
};

const datosPais = (extra: Record<string, string> = {}, pais: 'CO' | 'EC' = 'CO') =>
  esquemaAjustesPais(pais).parse({ ...FORM_CO, ...extra });

function sinClave<T extends Record<string, string>>(o: T, clave: string): Record<string, string> {
  return Object.fromEntries(Object.entries(o).filter(([k]) => k !== clave));
}

beforeEach(() => auditar.mockClear());

describe('aFormularioPais', () => {
  it('convierte la fila de la base a los textos del formulario', () => {
    const f = aFormularioPais(FILA_CO, 'CO');
    expect(f).toMatchObject({
      cod_deposit_amount: '10000',
      cod_reminder_hours: '3, 12, 21',
      cod_quiet_hours_start: '21:00',
      cod_quiet_hours_end: '07:00',
      surcharge_addi: '10',
      carrier_wallet_low_balance: '100000',
      saldo_billetera: '250000',
      tiene_transportadora: true,
    });
  });
});

describe('leerAjustes', () => {
  it('devuelve el país y los métodos', async () => {
    const { cliente } = clienteFalso({
      'country_settings.select': { data: FILA_CO },
      'payment_method_settings.select': {
        data: [
          { country_code: 'CO', method: 'cod', is_enabled: false, sort_order: 4, display_name: 'Contra entrega', description: null, fee_pct: 0, fee_fixed: 0, fee_tax_pct: 0 },
          { country_code: 'CO', method: 'wompi', is_enabled: true, sort_order: 1, display_name: 'Wompi', description: 'x', fee_pct: 2.65, fee_fixed: 700, fee_tax_pct: 19 },
        ],
      },
    });
    const r = await leerAjustes(cliente, 'CO');
    expect(r.pais?.cod_resend_max).toBe('2');
    expect(r.metodos.map((m) => m.method)).toEqual(['wompi', 'cod']);
    expect(r.metodos[0]?.fee_fixed).toBe('700');
  });
});

describe('guardarAjustesPaisBd', () => {
  it('guarda en unidad menor, conserva claves de recargo ajenas, audita el diff', async () => {
    const { cliente, llamadas } = clienteFalso({
      'country_settings.select': { data: FILA_CO },
      'country_settings.update': { data: null },
    });
    const r = await guardarAjustesPaisBd({ cliente, ...comun, pais: 'CO', datos: datosPais() });
    expect(r.ok).toBe(true);
    const upd = llamadas.find((l) => l.clave === 'country_settings.update')!.args[0] as Record<string, unknown>;
    expect(upd.cod_deposit_amount).toBe('12000');
    expect(upd.cod_resend_max).toBe(0);
    expect(upd.cod_reminder_offsets_minutes).toEqual([180, 720, 1260]);
    expect(upd.financing_surcharge_pct).toEqual({ otro: 5, addi: 11, sistecredito: 10 });
    expect(upd.carrier_wallet_low_balance).toBe('150000');
    // Colombia no escribe la tasa de cambio.
    expect('fx_rate_to_cop' in upd).toBe(false);
    const ev = auditar.mock.calls[0]![0] as { accion: string; diff: { antes: Record<string, unknown>; despues: Record<string, unknown> } };
    expect(ev.accion).toBe('pagos.ajustes_pais_actualizados');
    expect(ev.diff.despues).toMatchObject({ cod_deposit_amount: '12000', cod_resend_max: 0, carrier_wallet_low_balance: '150000' });
    // Lo que no cambió no está en el diff.
    expect(ev.diff.despues).not.toHaveProperty('cod_link_ttl_hours');
    expect(ev.diff.despues).not.toHaveProperty('cod_quiet_hours_start');
  });

  it('Ecuador guarda la tasa de cambio y montos en centavos', async () => {
    const { cliente, llamadas } = clienteFalso({
      'country_settings.select': { data: { ...FILA_CO, country_code: 'EC', financing_surcharge_pct: {}, fx_rate_to_cop: null, carrier_provider: null } },
      'country_settings.update': { data: null },
    });
    const datos = datosPais({ cod_deposit_amount: '2.50', cod_min_collect_amount: '5', fx_rate_to_cop: '4100', surcharge_addi: '', surcharge_sistecredito: '', carrier_wallet_low_balance: '' }, 'EC');
    await guardarAjustesPaisBd({ cliente, ...comun, pais: 'EC', datos });
    const upd = llamadas.find((l) => l.clave === 'country_settings.update')!.args[0] as Record<string, unknown>;
    expect(upd.cod_deposit_amount).toBe('250');
    expect(upd.cod_min_collect_amount).toBe('500');
    expect(upd.fx_rate_to_cop).toBe('4100');
    expect(upd.carrier_wallet_low_balance).toBeNull();
    expect(upd.financing_surcharge_pct).toEqual({});
  });

  it('no deja deshabilitar la contra entrega del país mientras el método siga activo', async () => {
    const { cliente, llamadas } = clienteFalso({
      'country_settings.select': { data: FILA_CO },
      'payment_method_settings.select': { data: { is_enabled: true } },
    });
    const sin = sinClave(FORM_CO, 'cod_enabled');
    const r = await guardarAjustesPaisBd({ cliente, ...comun, pais: 'CO', datos: esquemaAjustesPais('CO').parse(sin) });
    expect(r.ok).toBe(false);
    expect(r.errores?.cod_enabled).toMatch(/sigue activo/);
    expect(llamadas.some((l) => l.clave === 'country_settings.update')).toBe(false);
    expect(auditar).not.toHaveBeenCalled();
  });

  it('permite deshabilitarla si el método ya está inactivo', async () => {
    const { cliente } = clienteFalso({
      'country_settings.select': { data: FILA_CO },
      'payment_method_settings.select': { data: { is_enabled: false } },
      'country_settings.update': { data: null },
    });
    const sin = sinClave(FORM_CO, 'cod_enabled');
    const r = await guardarAjustesPaisBd({ cliente, ...comun, pais: 'CO', datos: esquemaAjustesPais('CO').parse(sin) });
    expect(r.ok).toBe(true);
  });

  it('un error de base se traduce sin detalles técnicos', async () => {
    const { cliente } = clienteFalso({
      'country_settings.select': { data: FILA_CO },
      'country_settings.update': { error: { code: 'XX000', message: 'detalle interno' } },
    });
    const r = await guardarAjustesPaisBd({ cliente, ...comun, pais: 'CO', datos: datosPais() });
    expect(r.ok).toBe(false);
    expect(r.mensaje).not.toContain('detalle interno');
    expect(auditar).not.toHaveBeenCalled();
  });
});

describe('transportadora por país (D-052)', () => {
  const filaEc = { ...FILA_CO, country_code: 'EC', financing_surcharge_pct: {}, fx_rate_to_cop: 4100, carrier_provider: null, carrier_auto_confirm: true, carrier_discount_mode: 'prorate' };
  const extra = { carrier_provider: 'mastershop', carrier_auto_confirm: 'no', carrier_discount_mode: 'additional_charge', fx_rate_to_cop: '4100', cod_deposit_amount: '2.50', cod_min_collect_amount: '5', carrier_wallet_low_balance: '' };

  it('guarda proveedor, confirmación automática y modo de descuento, y audita el cambio', async () => {
    const { cliente, llamadas } = clienteFalso({
      'country_settings.select': { data: filaEc },
      'variant_countries.select': { data: null, count: 0 },
      'country_settings.update': { data: null },
    });
    const r = await guardarAjustesPaisBd({ cliente, ...comun, pais: 'EC', datos: datosPais(extra, 'EC') });
    expect(r.ok).toBe(true);
    const upd = llamadas.find((l) => l.clave === 'country_settings.update')!.args[0] as Record<string, unknown>;
    expect(upd).toMatchObject({ carrier_provider: 'mastershop', carrier_auto_confirm: false, carrier_discount_mode: 'additional_charge' });
    const ev = auditar.mock.calls[0]![0] as { entidadId: string; diff: { despues: Record<string, unknown> } };
    expect(ev.entidadId).toBe('EC');
    expect(ev.diff.despues).toMatchObject({ carrier_provider: 'mastershop', carrier_auto_confirm: false, carrier_discount_mode: 'additional_charge' });
  });

  it('no enciende MasterShop en un país si hay variantes publicadas sin el vínculo de ESE país', async () => {
    const { cliente, llamadas, filtros } = clienteFalso({
      'country_settings.select': { data: filaEc },
      'variant_countries.select': { data: null, count: 3 },
    });
    const r = await guardarAjustesPaisBd({ cliente, ...comun, pais: 'EC', datos: datosPais(extra, 'EC') });
    expect(r.ok).toBe(false);
    expect(r.errores?.carrier_provider).toMatch(/3 variantes publicadas no tienen el vínculo con MasterShop de este país/);
    expect(r.errores?.carrier_provider).toMatch(/Ecuador/);
    expect(filtros).toContainEqual({ tabla: 'variant_countries', metodo: 'eq', args: ['country_code', 'EC'] });
    expect(llamadas.some((l) => l.clave === 'country_settings.update')).toBe(false);
    expect(auditar).not.toHaveBeenCalled();
  });

  it('el conteo exige producto activo y visible en el país (misma condición que la base)', async () => {
    const { cliente, filtros } = clienteFalso({ 'variant_countries.select': { data: null, count: 1 } });
    expect(await contarSinVinculo(cliente, 'EC')).toBe(1);
    const f = filtros.map((x) => `${x.metodo}:${x.args.join('=')}`);
    expect(f).toEqual(expect.arrayContaining([
      'eq:is_active=true',
      'eq:product_variants.products.status=active',
      'eq:product_variants.products.product_countries.country_code=EC',
      'eq:product_variants.products.product_countries.is_visible=true',
    ]));
  });

  it('Colombia no se puede dejar sin transportadora (se bloquea en el servidor)', async () => {
    const { cliente, llamadas } = clienteFalso({ 'country_settings.select': { data: FILA_CO } });
    const r = await guardarAjustesPaisBd({ cliente, ...comun, pais: 'CO', datos: datosPais({ carrier_provider: 'ninguna' }) });
    expect(r.ok).toBe(false);
    expect(r.errores?.carrier_provider).toMatch(/Colombia envía siempre con MasterShop/);
    expect(llamadas.some((l) => l.clave === 'country_settings.update')).toBe(false);
    expect(auditar).not.toHaveBeenCalled();
  });

  it('si MasterShop ya estaba activo, cambiar otros ajustes no vuelve a exigir el vínculo', async () => {
    const { cliente } = clienteFalso({
      'country_settings.select': { data: { ...filaEc, carrier_provider: 'mastershop' } },
      'variant_countries.select': { data: null, count: 9 },
      'country_settings.update': { data: null },
    });
    const r = await guardarAjustesPaisBd({ cliente, ...comun, pais: 'EC', datos: datosPais(extra, 'EC') });
    expect(r.ok).toBe(true);
  });

  it('apagar la transportadora guarda null', async () => {
    const { cliente, llamadas } = clienteFalso({
      'country_settings.select': { data: { ...filaEc, carrier_provider: 'mastershop' } },
      'country_settings.update': { data: null },
    });
    await guardarAjustesPaisBd({ cliente, ...comun, pais: 'EC', datos: datosPais({ ...extra, carrier_provider: 'ninguna' }, 'EC') });
    const upd = llamadas.find((l) => l.clave === 'country_settings.update')!.args[0] as Record<string, unknown>;
    expect(upd.carrier_provider).toBeNull();
  });

  it('un formulario que no trae los campos de transportadora no los toca', async () => {
    const { cliente, llamadas } = clienteFalso({
      'country_settings.select': { data: { ...filaEc, carrier_provider: 'mastershop' } },
      'country_settings.update': { data: null },
    });
    await guardarAjustesPaisBd({ cliente, ...comun, pais: 'EC', datos: datosPais({ cod_deposit_amount: '2.50', cod_min_collect_amount: '5', fx_rate_to_cop: '4100', carrier_wallet_low_balance: '' }, 'EC') });
    const upd = llamadas.find((l) => l.clave === 'country_settings.update')!.args[0] as Record<string, unknown>;
    expect('carrier_provider' in upd).toBe(false);
    expect('carrier_auto_confirm' in upd).toBe(false);
  });

  it('leerAjustes informa cuántas variantes publicadas faltan por vincular', async () => {
    const { cliente } = clienteFalso({
      'country_settings.select': { data: filaEc },
      'payment_method_settings.select': { data: [] },
      'variant_countries.select': { data: null, count: 2 },
    });
    const r = await leerAjustes(cliente, 'EC');
    expect(r.pais).toMatchObject({ sin_vinculo: 2, carrier_provider: '', carrier_auto_confirm: true, carrier_discount_mode: 'prorate' });
  });
});

describe('guardarMetodoBd', () => {
  const previo = { country_code: 'CO', method: 'cod', is_enabled: false, sort_order: 4, display_name: 'Contra entrega', description: null, fee_pct: 0, fee_fixed: 0, fee_tax_pct: 0 };
  const form = { is_enabled: 'on', sort_order: '4', display_name: 'Contra entrega', description: 'Haz un abono por WhatsApp.', fee_pct: '0', fee_fixed: '0', fee_tax_pct: '0' };

  it('impide activar la contra entrega si el país la tiene deshabilitada', async () => {
    const { cliente, llamadas } = clienteFalso({
      'country_settings.select': { data: { cod_enabled: false } },
      'payment_method_settings.select': { data: previo },
    });
    const r = await guardarMetodoBd({ cliente, ...comun, pais: 'CO', metodo: 'cod', datos: esquemaMetodo('CO').parse(form) });
    expect(r.ok).toBe(false);
    expect(r.errores?.is_enabled).toBeTruthy();
    expect(llamadas.some((l) => l.clave === 'payment_method_settings.update')).toBe(false);
    expect(auditar).not.toHaveBeenCalled();
  });

  it('activa la contra entrega cuando el país la tiene habilitada y audita', async () => {
    const { cliente, llamadas } = clienteFalso({
      'country_settings.select': { data: { cod_enabled: true } },
      'payment_method_settings.select': { data: previo },
      'payment_method_settings.update': { data: null },
    });
    const r = await guardarMetodoBd({ cliente, ...comun, pais: 'CO', metodo: 'cod', datos: esquemaMetodo('CO').parse(form) });
    expect(r.ok).toBe(true);
    const upd = llamadas.find((l) => l.clave === 'payment_method_settings.update')!.args[0] as Record<string, unknown>;
    expect(upd).toMatchObject({ is_enabled: true, fee_fixed: '0', description: 'Haz un abono por WhatsApp.' });
    expect(auditar.mock.calls[0]![0]).toMatchObject({ accion: 'pagos.metodo_actualizado', entidadId: 'CO:cod' });
  });

  it('no deja activar Sistecrédito mientras su integración esté pendiente, pero sí desactivarlo', async () => {
    const sis = { ...previo, method: 'sistecredito', is_enabled: true, display_name: 'Sistecrédito' };
    const { cliente, llamadas } = clienteFalso({
      'country_settings.select': { data: { cod_enabled: true } },
      'payment_method_settings.select': { data: { ...sis, is_enabled: false } },
      'payment_method_settings.update': { data: null },
    });
    const activar = await guardarMetodoBd({ cliente, ...comun, pais: 'CO', metodo: 'sistecredito', datos: esquemaMetodo('CO').parse({ ...form, display_name: 'Sistecrédito' }) });
    expect(activar).toMatchObject({ ok: false, errores: { is_enabled: expect.stringMatching(/integración/) } });
    expect(llamadas.some((l) => l.clave === 'payment_method_settings.update')).toBe(false);
    const sinActivo = Object.fromEntries(Object.entries(form).filter(([k]) => k !== 'is_enabled'));
    const apagar = await guardarMetodoBd({ cliente, ...comun, pais: 'CO', metodo: 'sistecredito', datos: esquemaMetodo('CO').parse({ ...sinActivo, display_name: 'Sistecrédito' }) });
    expect(apagar.ok).toBe(true);
  });

  it('otros métodos sí pueden activarse aunque la contra entrega esté deshabilitada', async () => {
    const wompi = { ...previo, method: 'wompi', display_name: 'Wompi' };
    const { cliente } = clienteFalso({
      'country_settings.select': { data: { cod_enabled: false } },
      'payment_method_settings.select': { data: wompi },
      'payment_method_settings.update': { data: null },
    });
    const r = await guardarMetodoBd({
      cliente,
      ...comun,
      pais: 'CO',
      metodo: 'wompi',
      datos: esquemaMetodo('CO').parse({ ...form, display_name: 'Wompi', fee_pct: '2.65', fee_fixed: '700', fee_tax_pct: '19' }),
    });
    expect(r.ok).toBe(true);
  });

  it('desactivar la contra entrega siempre se permite', async () => {
    const { cliente } = clienteFalso({
      'country_settings.select': { data: { cod_enabled: false } },
      'payment_method_settings.select': { data: { ...previo, is_enabled: true } },
      'payment_method_settings.update': { data: null },
    });
    const sin = sinClave(form, 'is_enabled');
    const r = await guardarMetodoBd({ cliente, ...comun, pais: 'CO', metodo: 'cod', datos: esquemaMetodo('CO').parse(sin) });
    expect(r.ok).toBe(true);
  });

  it('un método que no existe para el país da un error claro', async () => {
    const { cliente } = clienteFalso({
      'country_settings.select': { data: { cod_enabled: true } },
      'payment_method_settings.select': { data: null },
    });
    const r = await guardarMetodoBd({ cliente, ...comun, pais: 'EC', metodo: 'addi', datos: esquemaMetodo('EC').parse(form) });
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/no existe/);
  });
});
