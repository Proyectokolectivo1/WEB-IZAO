import { describe, expect, it } from 'vitest';
import { RespuestaVistaPrevia } from '@/lib/store/carrito/contrato';
import { entradaVistaPreviaSchema, vistaPrevia, type EntradaVistaPrevia } from './vista-previa';
import { AHORA, V1, V2, V3, V4, V_NO_EXISTE, fuenteDePrueba } from './pruebas/datos';

function entrada(e: Record<string, unknown>): EntradaVistaPrevia {
  return entradaVistaPreviaSchema.parse(e);
}

describe('vista previa del carrito (POST /api/checkout/preview)', () => {
  it('cumple el contrato de la tienda: montos en texto y precios del servidor', async () => {
    const f = fuenteDePrueba();
    const r = await vistaPrevia(f, entrada({ country: 'co', items: [{ variant_id: V1, quantity: 2 }] }), AHORA);
    expect(r).not.toBeNull();
    expect(RespuestaVistaPrevia.safeParse(r).success).toBe(true);
    expect(r!.lines).toEqual([
      { variant_id: V1, quantity: 2, unit_price: '200000', compare_at: null, max_quantity: 2, line_discount: '0' },
    ]);
    expect(r!.subtotal).toBe('400000');
    expect(r!.discount).toBe('0');
    expect(r!.code).toBeNull();
  });

  it('max_quantity = min(existencias, pedida) y no revela el inventario', async () => {
    const f = fuenteDePrueba();
    const r = await vistaPrevia(
      f,
      entrada({ country: 'CO', items: [{ variant_id: V1, quantity: 1 }, { variant_id: V2, quantity: 3 }] }),
      AHORA,
    );
    const porId = new Map(r!.lines.map((l) => [l.variant_id, l]));
    expect(porId.get(V1)!.max_quantity).toBe(1); // hay 5, pidió 1
    expect(porId.get(V2)!.max_quantity).toBe(1); // hay 1, pidió 3
    // El subtotal se calcula sobre lo que de verdad se puede comprar
    expect(r!.subtotal).toBe('300000');
  });

  it('con tope configurable, pedir de más no revela el inventario real (hay 5, tope 3)', async () => {
    const f = fuenteDePrueba();
    const r = await vistaPrevia(f, entrada({ country: 'CO', items: [{ variant_id: V1, quantity: 999 }] }), AHORA, {
      topeCantidad: 3,
    });
    expect(r!.lines[0]!.max_quantity).toBe(3);
    expect(r!.subtotal).toBe('600000');
    // Debajo del tope no cambia nada
    const r2 = await vistaPrevia(f, entrada({ country: 'CO', items: [{ variant_id: V1, quantity: 2 }] }), AHORA, {
      topeCantidad: 3,
    });
    expect(r2!.lines[0]!.max_quantity).toBe(2);
  });

  it('agotado, no vendible, inexistente o de otro país llegan con max_quantity 0', async () => {
    const f = fuenteDePrueba();
    f.vars.get(V1)!.disponible = 0;
    const r = await vistaPrevia(
      f,
      entrada({
        country: 'co',
        items: [
          { variant_id: V1, quantity: 1 },
          { variant_id: V3, quantity: 1 },
          { variant_id: V_NO_EXISTE, quantity: 2 },
          { variant_id: V4, quantity: 1 },
        ],
      }),
      AHORA,
    );
    expect(r!.lines.map((l) => [l.variant_id, l.max_quantity])).toEqual([
      [V1, 0],
      [V3, 0],
      [V_NO_EXISTE, 0],
      [V4, 0],
    ]);
    expect(r!.lines.find((l) => l.variant_id === V_NO_EXISTE)!.unit_price).toBe('0');
    expect(r!.subtotal).toBe('0');
    expect(RespuestaVistaPrevia.safeParse(r).success).toBe(true);
  });

  it('código aplicado reparte line_discount por línea y Σ line_discount = discount', async () => {
    const f = fuenteDePrueba();
    const r = await vistaPrevia(
      f,
      entrada({ country: 'co', items: [{ variant_id: V1, quantity: 1 }, { variant_id: V2, quantity: 1 }], code: ' fijo50 ' }),
      AHORA,
    );
    expect(r!.code).toEqual({ status: 'applied', code: 'FIJO50', reason: null, missing_amount: null });
    expect(r!.discount).toBe('50000');
    const suma = r!.lines.reduce((a, l) => a + BigInt(l.line_discount), 0n);
    expect(suma).toBe(50_000n);
    // Proporcional: 33333,33 y 16666,67 → piso 33333 y 16666; el residuo (1) va a la línea mayor
    expect(r!.lines.map((l) => l.line_discount)).toEqual(['33334', '16666']);
  });

  it('applies_to_sale_items = false deja la línea rebajada sin descuento', async () => {
    const f = fuenteDePrueba();
    const r = await vistaPrevia(
      f,
      entrada({ country: 'co', items: [{ variant_id: V1, quantity: 1 }, { variant_id: V2, quantity: 1 }], code: 'SINREBAJA' }),
      AHORA,
    );
    expect(r!.discount).toBe('20000');
    expect(r!.lines.map((l) => l.line_discount)).toEqual(['20000', '0']);
  });

  it.each([
    ['inexistente', 'NOEXISTE'],
    ['inactivo', 'INACTIVO'],
    ['de otro país', 'OTROPAIS'],
    ['con caracteres inválidos', 'DESC$10'],
  ])('código %s → CODE_INVALID único', async (_n, texto) => {
    const f = fuenteDePrueba();
    const r = await vistaPrevia(f, entrada({ country: 'co', items: [{ variant_id: V1, quantity: 1 }], code: texto }), AHORA);
    expect(r!.code?.status).toBe('rejected');
    expect(r!.code?.reason).toBe('CODE_INVALID');
    expect(r!.discount).toBe('0');
    expect(RespuestaVistaPrevia.safeParse(r).success).toBe(true);
  });

  it('código vencido → CODE_EXPIRED; mínimo no alcanzado → CODE_MIN_SUBTOTAL con faltante', async () => {
    const f = fuenteDePrueba();
    const vencido = await vistaPrevia(f, entrada({ country: 'co', items: [{ variant_id: V1, quantity: 1 }], code: 'VENCIDO' }), AHORA);
    expect(vencido!.code?.reason).toBe('CODE_EXPIRED');
    const minimo = await vistaPrevia(f, entrada({ country: 'co', items: [{ variant_id: V1, quantity: 2 }], code: 'MIN500' }), AHORA);
    expect(minimo!.code).toEqual({ status: 'rejected', code: 'MIN500', reason: 'CODE_MIN_SUBTOTAL', missing_amount: '100000' });
  });

  it('el límite por cliente queda provisional (applied) en la vista previa', async () => {
    const f = fuenteDePrueba();
    const r = await vistaPrevia(f, entrada({ country: 'co', items: [{ variant_id: V1, quantity: 1 }], code: 'UNOXCLIENTE' }), AHORA);
    expect(r!.code?.status).toBe('applied');
    expect(f.llamadas).not.toContain('usosDelCliente');
  });

  it('con método: Addi retira el código y suma recargo; contra entrega calcula abono y recaudo', async () => {
    const f = fuenteDePrueba();
    const addi = await vistaPrevia(
      f,
      entrada({ country: 'co', items: [{ variant_id: V1, quantity: 1 }], code: 'DESC10', payment_method: 'addi' }),
      AHORA,
    );
    expect(addi!.code?.status).toBe('withdrawn');
    expect(addi!.discount).toBe('0');
    expect(addi!.totals).toMatchObject({ payment_method: 'addi', surcharge: '20000', total_customer: '220000' });
    expect(addi!.totals.messages).toContain('DISCOUNT_NOT_ALLOWED_WITH_FINANCING');

    const cod = await vistaPrevia(
      f,
      entrada({ country: 'co', items: [{ variant_id: V1, quantity: 1 }], code: 'DESC10', payment_method: 'cod' }),
      AHORA,
    );
    expect(cod!.code?.status).toBe('applied');
    expect(cod!.totals).toMatchObject({ total_customer: '180000', cod_deposit: '20000', cod_collect: '160000' });
    expect(cod!.totals.available_methods.map((m) => m.method)).toEqual(['wompi', 'addi', 'sistecredito', 'cod']);
  });

  it('Sistecrédito pendiente de documentación nunca figura disponible aunque el panel lo tenga activo (D-032)', async () => {
    const f = fuenteDePrueba();
    const r = await vistaPrevia(
      f,
      entrada({ country: 'co', items: [{ variant_id: V1, quantity: 1 }], payment_method: 'sistecredito' }),
      AHORA,
    );
    expect(r!.totals.payment_method_available).toBe(false);
    const st = r!.totals.available_methods.find((m) => m.method === 'sistecredito');
    expect(st).toMatchObject({ available: false, reason: 'METHOD_DISABLED' });
    expect(r!.totals.available_methods.filter((m) => m.available).map((m) => m.method)).toEqual(['wompi', 'addi', 'cod']);
  });

  it('país cuyo único método activo es Sistecrédito (pendiente) ofrece el pedido manual', async () => {
    const f = fuenteDePrueba();
    const cfg = f.config.get('CO')!;
    f.config.set('CO', { ...cfg, metodos: cfg.metodos.map((m) => ({ ...m, is_enabled: m.method === 'sistecredito' })) });
    const r = await vistaPrevia(f, entrada({ country: 'co', items: [{ variant_id: V1, quantity: 1 }] }), AHORA);
    expect(r!.totals.manual_allowed).toBe(true);
  });

  it('Ecuador en USD con centavos y sin métodos activos ofrece solo el pedido manual', async () => {
    const f = fuenteDePrueba();
    const r = await vistaPrevia(f, entrada({ country: 'ec', items: [{ variant_id: V4, quantity: 3 }] }), AHORA);
    expect(r!.subtotal).toBe('14997');
    expect(r!.totals.currency).toBe('USD');
    expect(r!.totals.manual_allowed).toBe(true);
  });

  it('rechaza entradas mal formadas', () => {
    expect(entradaVistaPreviaSchema.safeParse({ country: 'pe', items: [] }).success).toBe(false);
    expect(
      entradaVistaPreviaSchema.safeParse({ country: 'co', items: [{ variant_id: V1, quantity: 0 }] }).success,
    ).toBe(false);
    expect(
      entradaVistaPreviaSchema.safeParse({ country: 'co', items: [{ variant_id: V1, quantity: 1, unit_price: '1' }] }).success,
    ).toBe(false);
  });

  it('país sin configuración → null', async () => {
    const f = fuenteDePrueba();
    f.config.delete('CO');
    expect(await vistaPrevia(f, entrada({ country: 'co', items: [] }), AHORA)).toBeNull();
  });
});
