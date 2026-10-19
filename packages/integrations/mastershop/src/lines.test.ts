import { allocate, money } from '@izao/core/money';
import type { CurrencyCode } from '@izao/core/money';
import { describe, expect, it } from 'vitest';
import { buildCarrierLines, CarrierLinesError } from './lines';
import type { CarrierDiscountMode, CarrierLineSource, CarrierPaymentKind } from './lines';
import { createRng } from './test-utils/prng';

interface Item extends CarrierLineSource {
  sku: string;
}

function item(sku: string, unitPrice: bigint, quantity = 1, lineDiscount = 0n): Item {
  return { sku, unitPrice, quantity, lineDiscount };
}

function checkInvariant(r: ReturnType<typeof buildCarrierLines<Item>>): void {
  const lineSum = r.lines.reduce((a, l) => a + l.price * BigInt(l.quantity), 0n);
  const chargeSum = r.additionalCharges.reduce((a, c) => a + c.value, 0n);
  expect(lineSum + chargeSum).toBe(r.total);
  expect(r.total > 0n).toBe(true);
  for (const l of r.lines) {
    expect(l.price >= 0n).toBe(true);
    expect(Number.isInteger(l.quantity) && l.quantity > 0).toBe(true);
  }
}

describe('buildCarrierLines — casos de §11.3 y §14.4', () => {
  it('caso 10: 90.000 + 60.000, 10 %, contra entrega → 75.000 y 50.000 (modo B)', () => {
    const r = buildCarrierLines({
      currency: 'COP',
      paymentKind: 'cod',
      mode: 'prorate',
      codDeposit: 10_000n,
      items: [item('A', 90_000n, 1, 9_000n), item('B', 60_000n, 1, 6_000n)],
    });
    expect(r.paymentMethod).toBe('cod');
    expect(r.subtotal).toBe(150_000n);
    expect(r.discount).toBe(15_000n);
    expect(r.reduction).toBe(25_000n);
    expect(r.total).toBe(125_000n);
    expect(r.additionalCharges).toEqual([]);
    expect(r.lines.map((l) => [l.source.sku, l.quantity, l.price])).toEqual([
      ['A', 1, 75_000n],
      ['B', 1, 50_000n],
    ]);
    checkInvariant(r);
  });

  it('caso 10 en modo A: precios reales y un additional_charge "descuento" de −25.000', () => {
    const r = buildCarrierLines({
      currency: 'COP',
      paymentKind: 'cod',
      mode: 'additional_charge',
      codDeposit: 10_000n,
      items: [item('A', 90_000n, 1, 9_000n), item('B', 60_000n, 1, 6_000n)],
    });
    expect(r.lines.map((l) => [l.source.sku, l.quantity, l.price])).toEqual([
      ['A', 1, 90_000n],
      ['B', 1, 60_000n],
    ]);
    expect(r.additionalCharges).toEqual([{ type_charge: 'descuento', value: -25_000n }]);
    expect(r.total).toBe(125_000n);
    checkInvariant(r);
  });

  it('caso 1: 1 × 90.000 contra entrega → recauda 80.000', () => {
    const r = buildCarrierLines({
      currency: 'COP',
      paymentKind: 'cod',
      mode: 'prorate',
      codDeposit: 10_000n,
      items: [item('A', 90_000n)],
    });
    expect(r.total).toBe(80_000n);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]?.price).toBe(80_000n);
    checkInvariant(r);
  });

  it('caso 2: 1 × 90.000 contra entrega con 10 % → recauda 71.000', () => {
    const r = buildCarrierLines({
      currency: 'COP',
      paymentKind: 'cod',
      mode: 'prorate',
      codDeposit: 10_000n,
      items: [item('A', 90_000n, 1, 9_000n)],
    });
    expect(r.total).toBe(71_000n);
    expect(r.lines[0]?.price).toBe(71_000n);
  });

  it('caso 3: Wompi con fijo 15.000 → prepago (pia) con total 75.000', () => {
    const r = buildCarrierLines({
      currency: 'COP',
      paymentKind: 'wompi',
      mode: 'prorate',
      items: [item('A', 90_000n, 1, 15_000n)],
    });
    expect(r.paymentMethod).toBe('pia');
    expect(r.total).toBe(75_000n);
    expect(r.lines[0]?.price).toBe(75_000n);
  });

  it('caso 4: Addi → total = subtotal de productos (el recargo no va a MasterShop)', () => {
    const r = buildCarrierLines({
      currency: 'COP',
      paymentKind: 'addi',
      mode: 'prorate',
      items: [item('A', 90_000n)],
    });
    expect(r.paymentMethod).toBe('pia');
    expect(r.total).toBe(90_000n);
    expect(r.lines[0]?.price).toBe(90_000n);
    expect(r.additionalCharges).toEqual([]);
  });

  it('caso 5: Sistecrédito 90.000 + 120.000 → total 210.000, sin cargos', () => {
    for (const mode of ['prorate', 'additional_charge'] as const) {
      const r = buildCarrierLines({
        currency: 'COP',
        paymentKind: 'sistecredito',
        mode,
        items: [item('A', 90_000n), item('B', 120_000n)],
      });
      expect(r.total).toBe(210_000n);
      expect(r.lines.map((l) => l.price)).toEqual([90_000n, 120_000n]);
      expect(r.additionalCharges).toEqual([]);
    }
  });

  it('caso 9 (USD): 2 × 49,90 con 10 % → una línea de cantidad 2 a 44,91', () => {
    const r = buildCarrierLines({
      currency: 'USD',
      paymentKind: 'wompi',
      mode: 'prorate',
      items: [item('A', 4_990n, 2, 998n)],
    });
    expect(r.total).toBe(8_982n);
    expect(r.lines.map((l) => [l.quantity, l.price])).toEqual([[2, 4_491n]]);
    checkInvariant(r);
  });

  it('sin reducción en modo A no se envía additional_charge', () => {
    const r = buildCarrierLines({
      currency: 'COP',
      paymentKind: 'wompi',
      mode: 'additional_charge',
      items: [item('A', 90_000n)],
    });
    expect(r.additionalCharges).toEqual([]);
    expect(r.total).toBe(90_000n);
  });
});

describe('buildCarrierLines — modo B respeta line_discount (M1, §11.2)', () => {
  it('caso 8: descuento solo en la categoría X (A) y abono prorrateado sobre el valor neto', () => {
    // A 100.000 con descuento 10.000 (neto 90.000) + B 50.000 (neto 50.000), abono 10.000.
    // allocate(10.000, [90.000, 50.000]) = [6.428 + 1 de residuo, 3.571] = [6.429, 3.571].
    const r = buildCarrierLines({
      currency: 'COP',
      paymentKind: 'cod',
      mode: 'prorate',
      codDeposit: 10_000n,
      items: [item('A', 100_000n, 1, 10_000n), item('B', 50_000n)],
    });
    expect(r.total).toBe(130_000n);
    expect(r.lines.map((l) => [l.source.sku, l.quantity, l.price])).toEqual([
      ['A', 1, 83_571n],
      ['B', 1, 46_429n],
    ]);
    checkInvariant(r);
  });

  it('caso 8 con Wompi: cada línea va a su valor menos su propio descuento', () => {
    const r = buildCarrierLines({
      currency: 'COP',
      paymentKind: 'wompi',
      mode: 'prorate',
      items: [item('A', 100_000n, 1, 10_000n), item('B', 50_000n)],
    });
    expect(r.lines.map((l) => l.price)).toEqual([90_000n, 50_000n]);
  });

  it('un descuento concentrado en una línea no se reparte a las demás', () => {
    const r = buildCarrierLines({
      currency: 'COP',
      paymentKind: 'wompi',
      mode: 'prorate',
      items: [item('A', 10_000n, 1, 9_000n), item('B', 90_000n)],
    });
    // Sobre el valor bruto daría 1.000 + 9.000 de descuento → 9.000 y 81.000.
    expect(r.lines.map((l) => l.price)).toEqual([1_000n, 90_000n]);
  });
});

describe('buildCarrierLines — bordes del prorrateo (modo B)', () => {
  it('una sola línea con cantidad 3 que divide exacto conserva la línea', () => {
    const r = buildCarrierLines({
      currency: 'COP',
      paymentKind: 'wompi',
      mode: 'prorate',
      items: [item('A', 50_000n, 3, 15_000n)],
    });
    expect(r.lines.map((l) => [l.quantity, l.price])).toEqual([[3, 45_000n]]);
    checkInvariant(r);
  });

  it('cantidad 3 que no divide exacto se parte en dos líneas: resto × (unidad+1) y el resto × unidad (B2)', () => {
    const r = buildCarrierLines({
      currency: 'COP',
      paymentKind: 'wompi',
      mode: 'prorate',
      items: [item('A', 50_000n, 3, 10_000n)],
    });
    // 140.000 / 3 = 46.666 resto 2 → 2 × 46.667 + 1 × 46.666
    expect(r.lines.map((l) => [l.source.sku, l.quantity, l.price])).toEqual([
      ['A', 2, 46_667n],
      ['A', 1, 46_666n],
    ]);
    expect(r.lines.every((l) => l.sourceIndex === 0)).toBe(true);
    checkInvariant(r);
  });

  it('una cantidad grande que no divide exacto da solo dos líneas, no una por unidad', () => {
    const r = buildCarrierLines({
      currency: 'COP',
      paymentKind: 'cod',
      mode: 'prorate',
      codDeposit: 10_000n,
      items: [item('A', 1_000n, 999)],
    });
    // 999.000 − 10.000 = 989.000; 989.000 / 999 = 989 resto 989 → 989 × 990 + 10 × 989
    expect(r.lines.map((l) => [l.quantity, l.price])).toEqual([
      [989, 990n],
      [10, 989n],
    ]);
    checkInvariant(r);
  });

  it('reducción mayor que una línea: ninguna línea queda negativa', () => {
    const r = buildCarrierLines({
      currency: 'COP',
      paymentKind: 'cod',
      mode: 'prorate',
      codDeposit: 10_000n,
      items: [item('A', 100_000n, 1, 38_096n), item('B', 5_000n, 1, 1_904n)],
    });
    // reducción 50.000 sobre 105.000: 47.619 + 2.380, residuo 1 a A
    expect(r.reduction).toBe(50_000n);
    expect(r.lines.map((l) => l.price)).toEqual([52_380n, 2_620n]);
    checkInvariant(r);
  });

  it('el residuo no hace negativa la línea mayor cuando todas son pequeñas', () => {
    const r = buildCarrierLines({
      currency: 'COP',
      paymentKind: 'wompi',
      mode: 'prorate',
      items: [item('A', 1n, 1, 1n), item('B', 1n, 1, 1n), item('C', 1n)],
    });
    expect(r.total).toBe(1n);
    expect(r.lines.map((l) => l.price)).toEqual([0n, 0n, 1n]);
    checkInvariant(r);
  });

  it('residuo de 1 centavo (USD) va a la línea de mayor valor; empate al menor índice', () => {
    const r = buildCarrierLines({
      currency: 'USD',
      paymentKind: 'wompi',
      mode: 'prorate',
      items: [item('A', 1_000n, 1, 34n), item('B', 1_000n, 1, 33n), item('C', 1_000n, 1, 33n)],
    });
    // reducción 1,00 sobre 30,00: 0,33 cada una y 0,01 de residuo a A
    expect(r.lines.map((l) => l.price)).toEqual([966n, 967n, 967n]);
    expect(r.total).toBe(2_900n);
    checkInvariant(r);
  });

  it('el residuo va a la línea de mayor valor aunque no sea la primera', () => {
    const r = buildCarrierLines({
      currency: 'COP',
      paymentKind: 'wompi',
      mode: 'prorate',
      items: [item('A', 10_000n, 1, 3_333n), item('B', 20_000n, 1, 6_667n)],
    });
    // reducción 10.000 sobre 30.000: 3.333 + 6.666, residuo 1 a B
    expect(r.lines.map((l) => l.price)).toEqual([6_667n, 13_333n]);
    checkInvariant(r);
  });

  it('es determinista', () => {
    const input = {
      currency: 'COP' as const,
      paymentKind: 'cod' as const,
      mode: 'prorate' as const,
      codDeposit: 10_000n,
      items: [item('A', 33_333n, 2, 1_111n), item('B', 77_777n, 3, 2_222n)],
    };
    expect(buildCarrierLines(input)).toEqual(buildCarrierLines(input));
  });
});

describe('buildCarrierLines — validaciones', () => {
  const base = { currency: 'COP' as const, mode: 'prorate' as const };

  it('contra entrega exige abono', () => {
    expect(() =>
      buildCarrierLines({ ...base, paymentKind: 'cod', items: [item('A', 90_000n)] }),
    ).toThrow(CarrierLinesError);
  });

  it('el abono solo existe en contra entrega', () => {
    expect(() =>
      buildCarrierLines({
        ...base,
        paymentKind: 'wompi',
        codDeposit: 10_000n,
        items: [item('A', 90_000n)],
      }),
    ).toThrow(/abono/);
  });

  it('Addi y Sistecrédito no admiten descuento', () => {
    for (const paymentKind of ['addi', 'sistecredito'] as const) {
      expect(() =>
        buildCarrierLines({ ...base, paymentKind, items: [item('A', 90_000n, 1, 9_000n)] }),
      ).toThrow(/descuento/);
    }
  });

  it('rechaza un total que no sea positivo', () => {
    expect(() =>
      buildCarrierLines({
        ...base,
        paymentKind: 'cod',
        codDeposit: 90_000n,
        items: [item('A', 90_000n)],
      }),
    ).toThrow(expect.objectContaining({ code: 'total_no_positivo' }));
  });

  it('rechaza carrito vacío, cantidades no enteras, precios o descuentos negativos', () => {
    const bad: Item[][] = [
      [],
      [item('A', 90_000n, 1.5)],
      [item('A', 90_000n, 0)],
      [item('A', -1n)],
      [item('A', 90_000n, 1, -1n)],
      [item('A', 90_000n, 1, 90_001n)],
    ];
    for (const items of bad) {
      expect(() => buildCarrierLines({ ...base, paymentKind: 'wompi', items })).toThrow(
        CarrierLinesError,
      );
    }
  });

  it('rechaza montos que no son bigint', () => {
    const items = [
      { sku: 'A', unitPrice: 90000 as unknown as bigint, quantity: 1, lineDiscount: 0n },
    ];
    expect(() => buildCarrierLines({ ...base, paymentKind: 'wompi', items })).toThrow(
      CarrierLinesError,
    );
  });
});

describe('buildCarrierLines — propiedad: Σ price × quantity + Σ additional_charge = total', () => {
  it('se cumple exacto en 5.000 carritos aleatorios, en ambos modos y monedas', () => {
    const rng = createRng(20261019);
    const kinds: CarrierPaymentKind[] = ['cod', 'wompi', 'addi', 'sistecredito'];
    const modes: CarrierDiscountMode[] = ['prorate', 'additional_charge'];
    const currencies: CurrencyCode[] = ['COP', 'USD'];
    let checked = 0;
    for (let n = 0; n < 5_000; n++) {
      const currency = rng.pick(currencies);
      const paymentKind = rng.pick(kinds);
      const mode = rng.pick(modes);
      const lineCount = rng.int(1, 6);
      const raw = Array.from({ length: lineCount }, (_, i) => ({
        sku: `S${i}`,
        unitPrice: rng.big(0n, currency === 'COP' ? 900_000n : 90_000n),
        quantity: rng.int(1, 5),
      }));
      const subtotal = raw.reduce((a, r) => a + r.unitPrice * BigInt(r.quantity), 0n);
      if (subtotal === 0n) continue;
      const financing = paymentKind === 'addi' || paymentKind === 'sistecredito';
      // Mitad de los carritos con descuento proporcional; la otra mitad con descuento
      // concentrado en algunas líneas (código por categoría, caso 8).
      let items: Item[];
      if (financing) {
        items = raw.map((r) => ({ ...r, lineDiscount: 0n }));
      } else if (rng.int(0, 1) === 0) {
        const parts = allocate(
          money(rng.big(0n, (subtotal * 6n) / 10n), currency),
          raw.map((r) => r.unitPrice * BigInt(r.quantity)),
        );
        items = raw.map((r, i) => ({ ...r, lineDiscount: parts[i]!.amount }));
      } else {
        items = raw.map((r) => {
          const value = r.unitPrice * BigInt(r.quantity);
          return { ...r, lineDiscount: rng.int(0, 2) === 0 ? 0n : rng.big(0n, value) };
        });
      }
      const discount = items.reduce((a, it) => a + it.lineDiscount, 0n);
      const afterDiscount = subtotal - discount;
      let codDeposit: bigint | undefined;
      if (paymentKind === 'cod') {
        if (afterDiscount < 2n) continue;
        codDeposit = rng.big(0n, afterDiscount - 1n);
      } else if (afterDiscount < 1n) continue;

      const r = buildCarrierLines({ currency, paymentKind, mode, items, codDeposit });
      checkInvariant(r);

      const expectedTotal =
        paymentKind === 'cod'
          ? afterDiscount - codDeposit!
          : paymentKind === 'wompi'
            ? afterDiscount
            : subtotal;
      expect(r.total).toBe(expectedTotal);

      // Cada línea de origen conserva sus unidades.
      for (let i = 0; i < items.length; i++) {
        const qty = r.lines.filter((l) => l.sourceIndex === i).reduce((a, l) => a + l.quantity, 0);
        expect(qty).toBe(items[i]!.quantity);
      }
      if (mode === 'additional_charge') {
        r.lines.forEach((l) => expect(l.price).toBe(items[l.sourceIndex]!.unitPrice));
        expect(
          r.additionalCharges.every((c) => c.value < 0n && c.type_charge === 'descuento'),
        ).toBe(true);
      } else {
        expect(r.additionalCharges).toEqual([]);
        // M1: cada línea respeta su line_discount; solo el abono se prorratea.
        for (let i = 0; i < items.length; i++) {
          const it = items[i]!;
          const net = it.unitPrice * BigInt(it.quantity) - it.lineDiscount;
          const sent = r.lines
            .filter((l) => l.sourceIndex === i)
            .reduce((a, l) => a + l.price * BigInt(l.quantity), 0n);
          expect(sent <= net).toBe(true);
          if (!codDeposit) expect(sent).toBe(net);
        }
        // B2: una línea partida da exactamente dos líneas cuyos precios difieren en 1.
        for (let i = 0; i < items.length; i++) {
          const ls = r.lines.filter((l) => l.sourceIndex === i);
          expect(ls.length <= 2).toBe(true);
          if (ls.length === 2) expect(ls[0]!.price - ls[1]!.price).toBe(1n);
        }
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(4_000);
  });
});
