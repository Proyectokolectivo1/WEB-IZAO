/** Falsos positivos y negativos del guardarraíl de cifras con frases típicas de una asesora de ventas. */
import { describe, expect, it } from 'vitest';
import { DatosPermitidos, cifraNoRespaldada } from './cifras';

function datos(conGratis = true) {
  const d = new DatosPermitidos();
  d.agregarTexto(`Rango de precios del catálogo: de $ 90.000 a $ 450.000.${conGratis ? ' Envío «Gratis».' : ''}`);
  d.agregarResultado({ contra_entrega: { abono: '$ 10.000' }, recargo_financiacion_pct: { addi: '10' }, texto: 'Entrega en 3 a 5 días hábiles.' });
  return d;
}

describe('cifras: frases legítimas pasan', () => {
  it.each([
    'Tenemos opciones desde $ 90.000 hasta $ 450.000.',
    'El abono es de $10.000 y el resto lo pagas al recibir.',
    'Addi tiene un recargo del 10% por financiar.',
    'Dura entre 6 y 8 horas sobre la piel.',
    'Es un perfume de 100 ml, ideal para la noche.',
    'Quedan pocas unidades.',
    'El envío no tiene devolución de dinero si lo abres.',
    'Tu código de barras está en la caja.',
    'Llega en 3 a 5 días hábiles.',
    'El envío es gratis.',
    'Tienes 2 perfumes en tu bolso.',
  ])('%s', (o) => {
    expect(cifraNoRespaldada(o, datos())).toBeNull();
  });
});

describe('cifras: lo no respaldado se detecta', () => {
  it.each([
    ['Te llega en 2 días hábiles.', 'plazo'],
    ['Cuesta $ 95.000.', 'monto'],
    ['Tiene 20% de descuento.', 'porcentaje'],
    ['Quedan 4 unidades.', 'unidades'],
    ['Úsalo con el código FREE20.', 'codigo'],
    ['Cuesta cien mil pesos.', 'monto_en_palabras'],
  ])('%s', (o, motivo) => {
    expect(cifraNoRespaldada(o, datos())).toBe(motivo);
  });
  it('«gratis» sin respaldo del panel o de una herramienta', () => {
    expect(cifraNoRespaldada('El envío es gratis.', datos(false))).toBe('gratis');
    expect(cifraNoRespaldada('El envío no tiene costo.', datos(false))).toBe('gratis');
    expect(cifraNoRespaldada('El envío no tiene devolución.', datos(false))).toBeNull();
  });
});
