import { describe, expect, it } from 'vitest';
import { impresionManualAtendida, impresionManualDeEventos, textoImpresionManual } from './impresion-manual';

/** `Intl` separa con espacio duro: se normaliza para comparar. */
const plano = (s: string) => s.replace(/\s/g, ' ');

const retencion = {
  type: 'transportadora',
  payload: { accion: 'impresion_manual_requerida', flete: '30000', umbral: '25000', motivo: 'flete_sobre_umbral' },
};

describe('impresión manual por flete (D-062)', () => {
  it('lee flete y umbral del evento transportadora (o de la alerta si faltara)', () => {
    expect(impresionManualDeEventos([{ type: 'status_changed', payload: {} }, retencion])).toEqual({ flete: 30000, umbral: 25000 });
    expect(impresionManualDeEventos([{ type: 'alerta', payload: { motivo: 'impresion_manual_requerida', flete: '4550', umbral: '4000' } }])).toEqual({
      flete: 4550,
      umbral: 4000,
    });
    expect(impresionManualDeEventos([{ type: 'transportadora', payload: { accion: 'etiqueta_guardada' } }])).toBeNull();
    expect(impresionManualDeEventos([{ type: 'transportadora', payload: { accion: 'impresion_manual_requerida', flete: 'x' } }])).toEqual({
      flete: null,
      umbral: null,
    });
  });

  it('el aviso se apaga con una impresión pedida desde el panel que no falló', () => {
    const auto = { type: 'label', status: 'printed', requested_by: 'auto' };
    expect(impresionManualAtendida([auto])).toBe(false);
    expect(impresionManualAtendida([{ type: 'label', status: 'failed', requested_by: 'admin:u1' }])).toBe(false);
    expect(impresionManualAtendida([{ type: 'label', status: 'queued', requested_by: 'admin:u1' }])).toBe(true);
    expect(impresionManualAtendida([{ type: 'label', status: 'printed', requested_by: 'admin:u1' }])).toBe(true);
  });

  it('texto con la moneda del pedido', () => {
    expect(plano(textoImpresionManual({ flete: 30000, umbral: 25000 }, 'COP'))).toBe(
      'Flete $ 30.000 supera el umbral $ 25.000: llama al cliente y luego imprime la guía.',
    );
    expect(plano(textoImpresionManual({ flete: 4550, umbral: null }, 'USD'))).toBe('Flete $45,50 supera el umbral —: llama al cliente y luego imprime la guía.');
  });
});
