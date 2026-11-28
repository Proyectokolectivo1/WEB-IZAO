import { describe, expect, it } from 'vitest';
import { advertenciaCancelar, haySolicitudReembolso, pagosPorReembolsar, textoReembolso } from './reembolso';

/** `Intl` separa con espacio duro: se normaliza para comparar. */
const plano = (s: string | null) => (s === null ? null : s.replace(/\s/g, ' '));

const wompi = { provider: 'wompi', purpose: 'full', amount: 169900, status: 'approved', provider_reference: 'IZ-CO-000052-1' };
const abono = { provider: 'wompi', purpose: 'cod_deposit', amount: 15000, status: 'approved', provider_reference: 'IZ-CO-000051-2' };
const rechazado = { ...abono, status: 'declined', provider_reference: 'IZ-CO-000051-1' };
const addi = { provider: 'addi', purpose: 'financing', amount: 186890, status: 'approved', provider_reference: null };

describe('pagosPorReembolsar', () => {
  it('solo cuenta los aprobados', () => {
    expect(pagosPorReembolsar([rechazado, abono])).toEqual([abono]);
    expect(pagosPorReembolsar([])).toEqual([]);
  });
});

describe('textoReembolso', () => {
  it('Wompi: monto con formato de la moneda y referencia', () => {
    expect(plano(textoReembolso([wompi], 'COP', false))).toBe('Requiere reembolso manual en Wompi: $ 169.900 (referencia IZ-CO-000052-1).');
  });

  it('abono de contra entrega: solo el abono aprobado', () => {
    expect(plano(textoReembolso(pagosPorReembolsar([rechazado, abono]), 'COP', false))).toBe(
      'Requiere reembolso manual en Wompi: $ 15.000 (referencia IZ-CO-000051-2).',
    );
  });

  it('USD con centavos y financiación sin referencia', () => {
    expect(plano(textoReembolso([{ ...wompi, amount: 4550 }], 'USD', false))).toBe('Requiere reembolso manual en Wompi: $45,50 (referencia IZ-CO-000052-1).');
    expect(plano(textoReembolso([addi], 'COP', false))).toBe('Requiere reembolso manual en Addi: $ 186.890 (sin referencia).');
  });

  it('pago manual sin fila de pago: reembolso por el medio en que se recibió', () => {
    expect(plano(textoReembolso([], 'COP', true))).toBe('Requiere reembolso manual por el medio en que se recibió el pago (pago marcado a mano).');
  });

  it('sin dinero cobrado no hay texto', () => {
    expect(plano(textoReembolso([], 'COP', false))).toBeNull();
  });
});

describe('advertenciaCancelar', () => {
  it('error_transportadora con pago: dice que MasterShop no lo aceptó y el reembolso', () => {
    const t = plano(advertenciaCancelar({ status: 'error_transportadora', currency_code: 'COP', paid_at: '2026-11-27T00:00:00Z' }, [rechazado, wompi]));
    expect(t).toContain('MasterShop nunca aceptó este pedido');
    expect(t).toContain('Requiere reembolso manual en Wompi: $ 169.900 (referencia IZ-CO-000052-1).');
    expect(t).toContain('No se puede deshacer.');
  });

  it('otros estados conservan la advertencia de siempre', () => {
    expect(advertenciaCancelar({ status: 'en_preparacion', currency_code: 'COP', paid_at: null }, [wompi])).toBe(
      'El pedido pasa a Cancelado y se libera el stock reservado. Si el envío está creado en MasterShop, también se cancela allá. No se puede deshacer.',
    );
  });
});

describe('haySolicitudReembolso', () => {
  it('detecta la alerta reembolso_manual_pendiente', () => {
    expect(haySolicitudReembolso([{ type: 'alerta', motivo_alerta: 'reembolso_manual_pendiente' }])).toBe(true);
    expect(haySolicitudReembolso([{ type: 'alerta', motivo_alerta: 'error_transportadora' }, { type: 'nota_interna', motivo_alerta: null }])).toBe(false);
  });
});
