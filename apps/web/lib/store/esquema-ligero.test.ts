import { describe, expect, it } from 'vitest';
import { RespuestaVistaPrevia } from './carrito/contrato';
import { ErrorCheckout, RespuestaPedidoCreado } from './checkout/contrato';
import { anulable, enteroNoNegativo, lista, nuloOIndefinido, objeto, opcional, texto } from './esquema-ligero';

const linea = { variant_id: 'v1', quantity: 2, unit_price: '120000', compare_at: null, max_quantity: 2, line_discount: '0' };
const vista = { lines: [linea], subtotal: '240000', discount: '0', code: null };

describe('esquema-ligero', () => {
  it('texto con patrón, entero no negativo y nulos', () => {
    expect(texto(/^\d+$/).safeParse('12').success).toBe(true);
    expect(texto(/^\d+$/).safeParse('1a').success).toBe(false);
    expect(texto().safeParse(3).success).toBe(false);
    expect(enteroNoNegativo().safeParse(0).success).toBe(true);
    expect(enteroNoNegativo().safeParse(-1).success).toBe(false);
    expect(enteroNoNegativo().safeParse(1.5).success).toBe(false);
    expect(anulable(texto()).safeParse(null).success).toBe(true);
    expect(anulable(texto()).safeParse(undefined).success).toBe(false);
    expect(nuloOIndefinido(texto()).safeParse(undefined).success).toBe(true);
    expect(opcional(texto()).safeParse(null).success).toBe(false);
  });

  it('objeto descarta claves desconocidas y omite las opcionales ausentes', () => {
    const e = objeto({ a: texto(), b: opcional(texto()) });
    expect(e.parse({ a: 'x', z: 1 })).toEqual({ a: 'x' });
    expect(e.safeParse({ b: 'y' }).success).toBe(false);
    expect(e.safeParse([]).success).toBe(false);
    expect(e.safeParse(null).success).toBe(false);
    expect(() => e.parse(1)).toThrow();
  });

  it('lista exige que todos los elementos cumplan', () => {
    expect(lista(enteroNoNegativo()).safeParse([1, 2]).success).toBe(true);
    expect(lista(enteroNoNegativo()).safeParse([1, -2]).success).toBe(false);
    expect(lista(enteroNoNegativo()).safeParse('1').success).toBe(false);
  });
});

describe('contratos del bolso y del checkout con el validador propio', () => {
  it('vista previa válida, con y sin totals', () => {
    expect(RespuestaVistaPrevia.safeParse(vista).success).toBe(true);
    const con = { ...vista, totals: { payment_method: 'cod', payment_method_available: true, surcharge: '0', total_customer: '240000', cod_deposit: '10000', cod_collect: '230000', available_methods: [{ method: 'cod', available: true, reason: null }], manual_allowed: false } };
    const r = RespuestaVistaPrevia.parse(con);
    expect(r.totals?.cod_collect).toBe('230000');
  });

  it('rechaza montos que no son texto de dígitos, cantidades inválidas y estados desconocidos', () => {
    expect(RespuestaVistaPrevia.safeParse({ ...vista, subtotal: 240000 }).success).toBe(false);
    expect(RespuestaVistaPrevia.safeParse({ ...vista, subtotal: '24.5' }).success).toBe(false);
    expect(RespuestaVistaPrevia.safeParse({ ...vista, lines: [{ ...linea, quantity: -1 }] }).success).toBe(false);
    expect(RespuestaVistaPrevia.safeParse({ ...vista, code: { status: 'otro', code: 'X', reason: null, missing_amount: null } }).success).toBe(false);
    expect(RespuestaVistaPrevia.safeParse({ ...vista, code: { status: 'applied', code: 'X', reason: null, missing_amount: null } }).success).toBe(true);
  });

  it('pedido creado y errores del checkout', () => {
    expect(RespuestaPedidoCreado.safeParse({ order: { number: 'IZ-1001' }, public_token: 'abcdEFGH1234', next_step: 'pay_wompi' }).success).toBe(true);
    expect(RespuestaPedidoCreado.safeParse({ order: { number: 'IZ 1' }, public_token: 'abcdEFGH1234', next_step: 'pay_wompi' }).success).toBe(false);
    expect(RespuestaPedidoCreado.safeParse({ order: { number: 'IZ-1' }, public_token: 'corto', next_step: 'pay_wompi' }).success).toBe(false);
    expect(RespuestaPedidoCreado.safeParse({ order: { number: 'IZ-1' }, public_token: 'abcdEFGH1234', next_step: 'otro' }).success).toBe(false);
    const e = ErrorCheckout.parse({ error: 'STOCK_CHANGED', lines: [{ variant_id: 'v', max_quantity: 0 }], reason: null });
    expect(e.lines?.[0]?.max_quantity).toBe(0);
    expect(ErrorCheckout.safeParse({ issues: [] }).success).toBe(false);
  });
});
