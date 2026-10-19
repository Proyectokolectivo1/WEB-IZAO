import { describe, expect, it } from 'vitest';
import {
  ORDER_STATUSES,
  TERMINAL_STATUSES,
  findTransitionPath,
  isOrderStatus,
  isTerminal,
  isValidActor,
  puedeTransicionar,
  siguientesEstados,
  transicionar,
  type OrderStatus,
} from './index';

/**
 * Tabla literal de §16 de la especificación, más D-002, §12.2 (abono tardío sin stock)
 * y las decisiones del dueño de la Oleada 1 (pago completo aprobado después de expirar;
 * MasterShop cancela un pedido en preparación).
 */
const ESPERADA: Record<OrderStatus, OrderStatus[]> = {
  pendiente_pago: ['pagado', 'pago_rechazado', 'expirado'],
  pago_rechazado: ['pendiente_pago', 'expirado'],
  expirado: ['requiere_reembolso'],
  esperando_abono: ['abono_pagado', 'abandonado'],
  abandonado: ['abono_pagado', 'requiere_reembolso'],
  pendiente_manual: ['pagado', 'cancelado', 'expirado'],
  pagado: ['enviado_transportadora', 'error_transportadora'],
  abono_pagado: ['enviado_transportadora', 'error_transportadora'],
  error_transportadora: ['enviado_transportadora'],
  enviado_transportadora: ['en_preparacion', 'cancelado'],
  en_preparacion: ['en_transito', 'cancelado'],
  en_transito: ['entregado', 'devuelto', 'reclamacion'],
  entregado: ['reclamacion'],
  devuelto: [],
  cancelado: [],
  reclamacion: [],
  requiere_reembolso: ['cancelado'],
};

describe('order-state: estados', () => {
  it('son exactamente los 17 de §16, en el orden del check de la base', () => {
    expect(ORDER_STATUSES).toEqual([
      'pendiente_pago',
      'pago_rechazado',
      'expirado',
      'esperando_abono',
      'abandonado',
      'pendiente_manual',
      'pagado',
      'abono_pagado',
      'error_transportadora',
      'enviado_transportadora',
      'en_preparacion',
      'en_transito',
      'entregado',
      'devuelto',
      'cancelado',
      'reclamacion',
      'requiere_reembolso',
    ]);
    expect(new Set(ORDER_STATUSES).size).toBe(17);
  });

  it('isOrderStatus reconoce solo estados válidos', () => {
    expect(isOrderStatus('pagado')).toBe(true);
    expect(isOrderStatus('PAGADO')).toBe(false);
    expect(isOrderStatus('enviado')).toBe(false);
    expect(isOrderStatus(undefined)).toBe(false);
  });

  it('terminales: devuelto, cancelado, reclamacion', () => {
    expect([...TERMINAL_STATUSES].sort()).toEqual(['cancelado', 'devuelto', 'reclamacion'].sort());
  });
});

describe('order-state: tabla completa de transiciones (17 × 17)', () => {
  for (const from of Object.keys(ESPERADA) as OrderStatus[]) {
    for (const to of Object.keys(ESPERADA) as OrderStatus[]) {
      const permitido = ESPERADA[from].includes(to);
      it(`${from} → ${to}: ${permitido ? 'permitida' : 'rechazada'}`, () => {
        expect(puedeTransicionar(from, to)).toBe(permitido);
      });
    }
  }

  it('siguientesEstados coincide con la tabla', () => {
    for (const from of ORDER_STATUSES) {
      expect([...siguientesEstados(from)].sort()).toEqual([...ESPERADA[from]].sort());
    }
  });

  it('D-002: pendiente_manual → expirado está permitida', () => {
    expect(puedeTransicionar('pendiente_manual', 'expirado')).toBe(true);
  });

  it('§12.2: abono aprobado tarde sin stock, abandonado → requiere_reembolso', () => {
    expect(puedeTransicionar('abandonado', 'requiere_reembolso')).toBe(true);
  });

  it('decisión del dueño: pago completo aprobado tras expirar, expirado → requiere_reembolso y nada más', () => {
    expect(puedeTransicionar('expirado', 'requiere_reembolso')).toBe(true);
    expect(siguientesEstados('expirado')).toEqual(['requiere_reembolso']);
    expect(puedeTransicionar('expirado', 'pagado')).toBe(false);
    expect(puedeTransicionar('expirado', 'pendiente_pago')).toBe(false);
  });
});

describe('order-state: propiedades', () => {
  it('ningún estado terminal sale', () => {
    for (const t of TERMINAL_STATUSES) {
      for (const to of ORDER_STATUSES) expect(puedeTransicionar(t, to)).toBe(false);
      expect(isTerminal(t)).toBe(true);
    }
  });

  it('un estado es terminal si y solo si no tiene siguientes', () => {
    for (const s of ORDER_STATUSES) {
      expect(isTerminal(s)).toBe(siguientesEstados(s).length === 0);
    }
  });

  it('ninguna transición va al mismo estado', () => {
    for (const s of ORDER_STATUSES) expect(puedeTransicionar(s, s)).toBe(false);
  });

  it('todo estado no inicial es alcanzable desde un estado inicial', () => {
    const iniciales: OrderStatus[] = ['pendiente_pago', 'esperando_abono', 'pendiente_manual'];
    const alcanzados = new Set<OrderStatus>(iniciales);
    const cola = [...iniciales];
    while (cola.length) {
      const s = cola.shift()!;
      for (const n of siguientesEstados(s)) {
        if (!alcanzados.has(n)) {
          alcanzados.add(n);
          cola.push(n);
        }
      }
    }
    expect(alcanzados.size).toBe(17);
  });

  it('rechaza estados desconocidos sin lanzar', () => {
    expect(puedeTransicionar('pagado' as OrderStatus, 'inventado' as OrderStatus)).toBe(false);
    expect(puedeTransicionar('inventado' as OrderStatus, 'pagado' as OrderStatus)).toBe(false);
  });
});

describe('order-state: transicionar', () => {
  it('devuelve el evento a registrar en order_events', () => {
    const r = transicionar({
      from: 'pendiente_pago',
      to: 'pagado',
      actor: 'webhook:wompi',
      payload: { transaction_id: '123-abc' },
    });
    expect(r).toEqual({
      ok: true,
      event: {
        type: 'status_changed',
        from_status: 'pendiente_pago',
        to_status: 'pagado',
        actor: 'webhook:wompi',
        payload: { transaction_id: '123-abc' },
      },
    });
  });

  it('payload por defecto es un objeto vacío', () => {
    const r = transicionar({ from: 'esperando_abono', to: 'abandonado', actor: 'system' });
    expect(r.ok && r.event.payload).toEqual({});
  });

  it('rechaza transición inválida con código estable', () => {
    const r = transicionar({ from: 'esperando_abono', to: 'pagado', actor: 'system' });
    expect(r).toMatchObject({ ok: false, error: { code: 'INVALID_TRANSITION' } });
  });

  it('rechaza salir de un estado terminal', () => {
    const r = transicionar({ from: 'cancelado', to: 'pagado', actor: 'admin:abc' });
    expect(r).toMatchObject({ ok: false, error: { code: 'TERMINAL_STATE' } });
  });

  it('expirado ya no es final pero solo admite requiere_reembolso', () => {
    const r = transicionar({ from: 'expirado', to: 'pagado', actor: 'webhook:wompi' });
    expect(r).toMatchObject({ ok: false, error: { code: 'INVALID_TRANSITION' } });
    const ok = transicionar({ from: 'expirado', to: 'requiere_reembolso', actor: 'webhook:wompi' });
    expect(ok.ok).toBe(true);
  });

  it('rechaza salir de devuelto', () => {
    const r = transicionar({ from: 'devuelto', to: 'cancelado', actor: 'system' });
    expect(r).toMatchObject({ ok: false, error: { code: 'TERMINAL_STATE' } });
  });

  it('rechaza transición al mismo estado', () => {
    const r = transicionar({ from: 'pagado', to: 'pagado', actor: 'system' });
    expect(r).toMatchObject({ ok: false, error: { code: 'SAME_STATE' } });
  });

  it('rechaza estados desconocidos', () => {
    const r = transicionar({ from: 'pagado', to: 'enviado' as OrderStatus, actor: 'system' });
    expect(r).toMatchObject({ ok: false, error: { code: 'UNKNOWN_STATUS' } });
  });

  it('rechaza actores que la base no acepta', () => {
    for (const actor of ['', 'admin:', 'webhook:', 'cliente', 'System']) {
      const r = transicionar({ from: 'pendiente_pago', to: 'pagado', actor });
      expect(r).toMatchObject({ ok: false, error: { code: 'INVALID_ACTOR' } });
    }
  });

  it('isValidActor sigue el check de order_events.actor', () => {
    expect(isValidActor('system')).toBe(true);
    expect(isValidActor('agent')).toBe(true);
    expect(isValidActor('admin:6f1c')).toBe(true);
    expect(isValidActor('webhook:mastershop')).toBe(true);
    expect(isValidActor('admin')).toBe(false);
  });
});

describe('order-state: findTransitionPath (sincronización que se salta estados)', () => {
  it('enviado_transportadora → entregado pasa por en_preparacion y en_transito', () => {
    expect(findTransitionPath('enviado_transportadora', 'entregado')).toEqual([
      'en_preparacion',
      'en_transito',
      'entregado',
    ]);
  });

  it('transición directa da un solo paso', () => {
    expect(findTransitionPath('pagado', 'enviado_transportadora')).toEqual([
      'enviado_transportadora',
    ]);
  });

  it('expirado → cancelado pasa por requiere_reembolso', () => {
    expect(findTransitionPath('expirado', 'cancelado')).toEqual(['requiere_reembolso', 'cancelado']);
  });

  it('decisión del dueño: en_preparacion → cancelado (MasterShop 9 desde 3–4)', () => {
    expect(puedeTransicionar('en_preparacion', 'cancelado')).toBe(true);
    expect(findTransitionPath('en_preparacion', 'cancelado')).toEqual(['cancelado']);
  });

  it('en_transito → cancelado no está permitida ni tiene camino (en tránsito se devuelve)', () => {
    expect(puedeTransicionar('en_transito', 'cancelado')).toBe(false);
    expect(findTransitionPath('en_transito', 'cancelado')).toBeNull();
  });

  it('cancelado sigue siendo terminal', () => {
    expect(isTerminal('cancelado')).toBe(true);
    expect(siguientesEstados('cancelado')).toEqual([]);
  });

  it('sin camino devuelve null', () => {
    expect(findTransitionPath('entregado', 'pagado')).toBeNull();
    expect(findTransitionPath('cancelado', 'entregado')).toBeNull();
    expect(findTransitionPath('pagado', 'pagado')).toBeNull();
  });
});
