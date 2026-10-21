import { describe, expect, it } from 'vitest';
import {
  afirmaOriginalidad,
  duracionSilencioso,
  esquemaAjustesPais,
  esquemaMetodo,
  horasAMinutos,
  minutosAHoras,
  montoATexto,
  motivoMetodoNoActivable,
} from './ajustes';

const BASE_CO = {
  cod_enabled: 'on',
  cod_deposit_amount: '10000',
  cod_min_collect_amount: '20000',
  cod_link_ttl_hours: '24',
  cod_reminder_hours: '3, 12, 21',
  cod_quiet_hours_start: '21:00',
  cod_quiet_hours_end: '07:00',
  cod_resend_max: '2',
  surcharge_addi: '10',
  surcharge_sistecredito: '12.5',
  pending_payment_ttl_minutes: '60',
  manual_order_ttl_hours: '24',
  fx_rate_to_cop: '',
  carrier_wallet_low_balance: '100000',
};

describe('horas de recordatorio', () => {
  it('convierte a minutos ordenados y sin repetidos', () => {
    expect(horasAMinutos('3, 12, 21')).toEqual([180, 720, 1260]);
    expect(horasAMinutos('21 3 3;12')).toEqual([180, 720, 1260]);
    expect(horasAMinutos('1.5')).toEqual([90]);
    expect(horasAMinutos('')).toEqual([]);
  });
  it('rechaza ceros, negativos y texto', () => {
    expect(horasAMinutos('0')).toBeNull();
    expect(horasAMinutos('-3')).toBeNull();
    expect(horasAMinutos('tres')).toBeNull();
    expect(horasAMinutos('1,5')).toEqual([60, 300]);
  });
  it('ida y vuelta', () => {
    expect(minutosAHoras([180, 720, 1260])).toBe('3, 12, 21');
    expect(minutosAHoras([90])).toBe('1.5');
    expect(minutosAHoras(null)).toBe('');
  });
});

describe('montoATexto', () => {
  it('COP sin decimales y USD con dos', () => {
    expect(montoATexto(10000, 'COP')).toBe('10000');
    expect(montoATexto('550', 'USD')).toBe('5.50');
    expect(montoATexto(null, 'COP')).toBe('');
  });
});

describe('ajustes del país', () => {
  it('Colombia: valores válidos salen tipados y en unidad menor', () => {
    const r = esquemaAjustesPais('CO').safeParse(BASE_CO);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data).toMatchObject({
      cod_enabled: true,
      cod_deposit_amount: 10000n,
      cod_min_collect_amount: 20000n,
      cod_link_ttl_hours: 24,
      cod_reminder_offsets_minutes: [180, 720, 1260],
      cod_resend_max: 2,
      surcharge: { addi: 10, sistecredito: 12.5 },
      carrier_wallet_low_balance: 100000n,
      fx_rate_to_cop: null,
    });
  });

  it('Ecuador: el abono se escribe en dólares y se guarda en centavos', () => {
    const r = esquemaAjustesPais('EC').safeParse({ ...BASE_CO, cod_deposit_amount: '2.50', cod_min_collect_amount: '5', fx_rate_to_cop: '4100.5', carrier_wallet_low_balance: '' });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.cod_deposit_amount).toBe(250n);
    expect(r.data.cod_min_collect_amount).toBe(500n);
    expect(r.data.fx_rate_to_cop).toBe('4100.5');
    expect(r.data.carrier_wallet_low_balance).toBeNull();
  });

  it('cod_resend_max: 0 es válido; negativo, decimal o texto no', () => {
    const val = (v: string) => esquemaAjustesPais('CO').safeParse({ ...BASE_CO, cod_resend_max: v });
    expect(val('0').success).toBe(true);
    expect(val('-1').success).toBe(false);
    expect(val('1.5').success).toBe(false);
    expect(val('abc').success).toBe(false);
    expect(val('').success).toBe(false);
  });

  it('el umbral de saldo bajo puede quedar vacío (sin alerta) pero no negativo', () => {
    expect(esquemaAjustesPais('CO').safeParse({ ...BASE_CO, carrier_wallet_low_balance: '' }).success).toBe(true);
    expect(esquemaAjustesPais('CO').safeParse({ ...BASE_CO, carrier_wallet_low_balance: '-5' }).success).toBe(false);
  });

  it('COP no admite decimales y USD admite máximo dos', () => {
    expect(esquemaAjustesPais('CO').safeParse({ ...BASE_CO, cod_deposit_amount: '10000.5' }).success).toBe(false);
    expect(esquemaAjustesPais('EC').safeParse({ ...BASE_CO, cod_deposit_amount: '2.555' }).success).toBe(false);
  });

  it('los recordatorios deben caer antes de que venza el link', () => {
    const r = esquemaAjustesPais('CO').safeParse({ ...BASE_CO, cod_reminder_hours: '3, 30' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.path).toEqual(['cod_reminder_hours']);
    expect(esquemaAjustesPais('CO').safeParse({ ...BASE_CO, cod_reminder_hours: '' }).success).toBe(true);
    expect(esquemaAjustesPais('CO').safeParse({ ...BASE_CO, cod_reminder_hours: '1,2,3,4,5,6,7' }).success).toBe(false);
  });

  it('horario silencioso: formato HH:MM y inicio distinto del fin', () => {
    expect(esquemaAjustesPais('CO').safeParse({ ...BASE_CO, cod_quiet_hours_start: '25:00' }).success).toBe(false);
    expect(esquemaAjustesPais('CO').safeParse({ ...BASE_CO, cod_quiet_hours_start: '9pm' }).success).toBe(false);
    expect(esquemaAjustesPais('CO').safeParse({ ...BASE_CO, cod_quiet_hours_end: '21:00' }).success).toBe(false);
    expect(duracionSilencioso('21:00', '07:00')).toBe(600);
    expect(duracionSilencioso('01:00', '05:00')).toBe(240);
  });

  it('recargos: 0 a 100 con máximo dos decimales; vacío = no aplica', () => {
    const val = (a: string) => esquemaAjustesPais('CO').safeParse({ ...BASE_CO, surcharge_addi: a });
    expect(val('0').success).toBe(true);
    expect(val('100').success).toBe(true);
    expect(val('100.5').success).toBe(false);
    expect(val('10.123').success).toBe(false);
    const vacio = esquemaAjustesPais('CO').safeParse({ ...BASE_CO, surcharge_addi: '', surcharge_sistecredito: '' });
    expect(vacio.success && vacio.data.surcharge).toEqual({});
  });

  it('tiempos con rangos razonables', () => {
    expect(esquemaAjustesPais('CO').safeParse({ ...BASE_CO, pending_payment_ttl_minutes: '1' }).success).toBe(false);
    expect(esquemaAjustesPais('CO').safeParse({ ...BASE_CO, cod_link_ttl_hours: '0' }).success).toBe(false);
    expect(esquemaAjustesPais('CO').safeParse({ ...BASE_CO, manual_order_ttl_hours: '999' }).success).toBe(false);
  });

  it('la tasa de cambio debe ser positiva', () => {
    expect(esquemaAjustesPais('EC').safeParse({ ...BASE_CO, fx_rate_to_cop: '0' }).success).toBe(false);
    expect(esquemaAjustesPais('EC').safeParse({ ...BASE_CO, fx_rate_to_cop: 'x' }).success).toBe(false);
  });

  it('un checkbox sin marcar es falso', () => {
    const sin = Object.fromEntries(Object.entries(BASE_CO).filter(([k]) => k !== 'cod_enabled'));
    const r = esquemaAjustesPais('CO').safeParse(sin);
    expect(r.success && r.data.cod_enabled).toBe(false);
  });
});

const METODO = {
  is_enabled: 'on',
  sort_order: '1',
  display_name: 'Wompi',
  description: 'Paga en línea con Wompi.',
  fee_pct: '2.65',
  fee_fixed: '700',
  fee_tax_pct: '19',
};

describe('métodos de pago', () => {
  it('valida y convierte la comisión fija a unidad menor', () => {
    const r = esquemaMetodo('CO').safeParse(METODO);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toMatchObject({ is_enabled: true, fee_pct: 2.65, fee_fixed: 700n, fee_tax_pct: 19 });
    const ec = esquemaMetodo('EC').safeParse({ ...METODO, fee_fixed: '0.30' });
    expect(ec.success && ec.data.fee_fixed).toBe(30n);
  });

  it('rechaza porcentajes fuera de rango y nombres vacíos', () => {
    expect(esquemaMetodo('CO').safeParse({ ...METODO, fee_pct: '101' }).success).toBe(false);
    expect(esquemaMetodo('CO').safeParse({ ...METODO, display_name: '  ' }).success).toBe(false);
    expect(esquemaMetodo('CO').safeParse({ ...METODO, fee_fixed: '-1' }).success).toBe(false);
  });

  it('no deja textos que afirmen originalidad o certificados', () => {
    for (const t of ['Pago 100% original', 'Fragancias auténticas', 'Producto certificado', 'Réplica']) {
      expect(afirmaOriginalidad(t), t).toBe(true);
    }
    expect(afirmaOriginalidad('Paga en línea con Wompi.')).toBe(false);
    const r = esquemaMetodo('CO').safeParse({ ...METODO, description: 'Perfumes originales' });
    expect(r.success).toBe(false);
  });

  it('contra entrega no se activa si el país la tiene deshabilitada', () => {
    expect(motivoMetodoNoActivable('cod', true, false)).toMatch(/habilít/);
    expect(motivoMetodoNoActivable('cod', true, true)).toBeNull();
    expect(motivoMetodoNoActivable('cod', false, false)).toBeNull();
    expect(motivoMetodoNoActivable('wompi', true, false)).toBeNull();
  });
});
