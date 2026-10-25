import { describe, expect, it } from 'vitest';
import {
  bienvenidaAGuardar,
  bienvenidaDe,
  conversionBp,
  esquemaAjustesChat,
  estadoPresupuesto,
  formatoUsdMicros,
  leerFiltrosConversacion,
  mesActual,
  microsATexto,
  parametrosDeFiltrosConversacion,
  usdAMicros,
  usoPresupuestoBp,
} from './chatbot';

const base = {
  is_enabled: 'on',
  model_primary: 'google/gemini-2.5-flash',
  model_fallback: 'meta-llama/llama-3.1-8b-instruct:free',
  presupuesto: '10',
  degrade_at_pct: '80',
  extra_instructions: '  Habla de tú.  ',
  welcome_CO: '¡Quiubo! Soy Iza.',
  welcome_EC: '',
  max_output_tokens: '450',
  history_turns: '12',
  max_input_chars: '500',
  max_messages_per_session: '30',
};

describe('presupuesto en micro-USD', () => {
  it('convierte USD a micro-USD sin floats y de vuelta', () => {
    expect(usdAMicros('10')).toBe(10_000_000n);
    expect(usdAMicros('12,5')).toBe(12_500_000n);
    expect(usdAMicros('0.000001')).toBe(1n);
    for (const malo of ['', '-5', '1e3', '10.1234567', '100001', 'diez']) expect(usdAMicros(malo), malo).toBeNull();
    expect(microsATexto(10_000_000n)).toBe('10');
    expect(microsATexto(2_500_000n)).toBe('2.5');
    expect(microsATexto(1n)).toBe('0.000001');
  });

  it('da formato en centavos, medio hacia arriba', () => {
    expect(formatoUsdMicros(3_450_000n)).toBe('USD 3,45');
    expect(formatoUsdMicros(5_000n)).toBe('USD 0,01');
    expect(formatoUsdMicros(4_999n)).toBe('USD 0,00');
    expect(formatoUsdMicros(1_234_567_000_000n)).toBe('USD 1.234.567,00');
  });

  it('calcula el uso y el estado según el umbral del panel (§20.4)', () => {
    expect(usoPresupuestoBp(8_000_000n, 10_000_000n)).toBe(8000n);
    expect(usoPresupuestoBp(1n, 0n)).toBeNull();
    expect(estadoPresupuesto(0n, 10_000_000n, 80)).toBe('normal');
    expect(estadoPresupuesto(7_999_999n, 10_000_000n, 80)).toBe('normal');
    expect(estadoPresupuesto(8_000_000n, 10_000_000n, 80)).toBe('respaldo');
    expect(estadoPresupuesto(8_000_000n, 10_000_000n, 90)).toBe('normal');
    expect(estadoPresupuesto(10_000_000n, 10_000_000n, 80)).toBe('agotado');
    expect(estadoPresupuesto(0n, 0n, 80)).toBe('sin_presupuesto');
  });

  it('el mes se cuenta en hora de Bogotá', () => {
    expect(mesActual(new Date('2026-10-25T12:00:00Z'))).toBe('2026-10-01');
    expect(mesActual(new Date('2026-11-01T03:00:00Z'))).toBe('2026-10-01'); // aún 31 de octubre en Bogotá
    expect(mesActual(new Date('2026-11-01T06:00:00Z'))).toBe('2026-11-01');
  });
});

describe('esquemaAjustesChat', () => {
  it('normaliza y arma los ajustes', () => {
    const d = esquemaAjustesChat.parse(base);
    expect(d).toMatchObject({
      is_enabled: true,
      model_primary: 'google/gemini-2.5-flash',
      monthly_budget_usd_micros: 10_000_000n,
      degrade_at_pct: 80,
      extra_instructions: 'Habla de tú.',
      welcome: { CO: '¡Quiubo! Soy Iza.', EC: null },
      max_output_tokens: 450,
      history_turns: 12,
    });
  });

  it('no deja activar sin modelo principal, pero sí guardar desactivada', () => {
    expect(esquemaAjustesChat.safeParse({ ...base, model_primary: '' }).success).toBe(false);
    expect(esquemaAjustesChat.safeParse({ ...base, model_primary: '', is_enabled: '' }).success).toBe(true);
  });

  it('valida modelos, presupuesto y rangos', () => {
    expect(esquemaAjustesChat.safeParse({ ...base, model_primary: 'gemini flash' }).success).toBe(false);
    expect(esquemaAjustesChat.safeParse({ ...base, model_fallback: 'sin-barra' }).success).toBe(false);
    expect(esquemaAjustesChat.safeParse({ ...base, presupuesto: '-1' }).success).toBe(false);
    for (const [campo, valor] of [['degrade_at_pct', '0'], ['degrade_at_pct', '101'], ['max_output_tokens', '10'], ['history_turns', '0'], ['max_input_chars', '5000'], ['max_messages_per_session', '1.5']] as const) {
      expect(esquemaAjustesChat.safeParse({ ...base, [campo]: valor }).success, `${campo}=${valor}`).toBe(false);
    }
  });

  it('regla 7: la bienvenida no afirma originalidad', () => {
    expect(esquemaAjustesChat.safeParse({ ...base, welcome_CO: 'Perfumes 100% originales' }).success).toBe(false);
  });
});

describe('bienvenida por país', () => {
  it('reemplaza los países del formulario y conserva el resto; vacío la borra', () => {
    expect(bienvenidaAGuardar({ CO: 'viejo', EC: 'x', otro: 'y' }, { CO: 'nuevo', EC: null })).toEqual({ CO: 'nuevo', otro: 'y' });
    expect(bienvenidaDe({ CO: 'hola' }, 'CO')).toBe('hola');
    expect(bienvenidaDe({ CO: 5 }, 'CO')).toBe('');
    expect(bienvenidaDe(null, 'EC')).toBe('');
  });
});

describe('conversaciones', () => {
  it('lee filtros válidos; la búsqueda exige 3 letras', () => {
    expect(leerFiltrosConversacion({ pais: 'ec', convertida: 'si', desde: '2026-10-20', hasta: '2026-10-01', q: 'envío', page: '2' })).toEqual({
      pagina: 2,
      pais: 'EC',
      convertida: 'si',
      desde: '2026-10-01',
      hasta: '2026-10-20',
      q: 'envío',
    });
    expect(leerFiltrosConversacion({ q: 'ab', pais: 'MX', convertida: 'x', desde: '2026-02-30' })).toMatchObject({ q: '', pais: '', convertida: '', desde: '' });
    expect(parametrosDeFiltrosConversacion(leerFiltrosConversacion({ convertida: 'no' }))).toEqual({ convertida: 'no' });
  });

  it('la conversión se calcula en puntos básicos', () => {
    expect(conversionBp(3, 40)).toBe(750n);
    expect(conversionBp(0, 0)).toBeNull();
    expect(conversionBp(1, 3)).toBe(3333n);
  });
});
