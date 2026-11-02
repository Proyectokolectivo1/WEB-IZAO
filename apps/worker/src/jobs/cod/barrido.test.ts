import { describe, expect, it } from 'vitest';
import type { OrderStatus, OrderStatusEvent } from '@izao/core/order-state';
import { barrerPedidos, encoladorInicioCod, type DepsBarrido } from './barrido.js';
import type { PedidoCod, PedidoPorVencer, SolicitudFinanciacionAbierta } from './fuente.js';

const AHORA = new Date('2026-10-21T15:05:00.000Z');
const id = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;

function pedido(n: number, status: OrderStatus, o: Partial<PedidoCod> = {}): PedidoCod {
  return {
    id: id(n),
    number: `IZ-CO-0000${n}`,
    public_token: 't',
    status,
    country_code: 'CO',
    currency_code: 'COP',
    payment_method: status === 'esperando_abono' ? 'cod' : 'wompi',
    stock_state: 'reserved',
    cod_deposit_amount: 0n,
    cod_collect_amount: 0n,
    contact_first_name: 'Ana',
    contact_email: null,
    contact_phone_e164: '+573001234567',
    created_at: new Date('2026-10-20T15:00:00.000Z'),
    stock_reserved_until: new Date('2026-10-21T15:00:00.000Z'),
    ...o,
  };
}

interface PagoFinanciacion {
  id: string;
  order_id: string;
  provider: string;
  status: string;
}

function escenario(o: {
  pedidos: PedidoCod[];
  vencer?: PedidoPorVencer[];
  sinLink?: string[];
  huerfanas?: string[];
  stockFalla?: string;
  pagos?: PagoFinanciacion[];
  invalidarFalla?: string;
}) {
  const pedidos = new Map(o.pedidos.map((p) => [p.id, p]));
  const transiciones: { id: string; ev: OrderStatusEvent; fechas?: { abandoned_at?: Date } }[] = [];
  const liberados: string[] = [];
  const canjes: string[] = [];
  const encolados: string[] = [];
  const cancelados: string[] = [];
  const consultas: { sinLink?: [Date, Date, number]; solicitudes?: number } = {};
  const pagos = o.pagos ?? [];
  const invalidadas: string[] = [];
  const deps: DepsBarrido = {
    fuente: {
      async pedidosPorVencer() {
        return o.vencer ?? [];
      },
      async pedidosSinLink(antes, ahora, limite) {
        consultas.sinLink = [antes, ahora, limite];
        return o.sinLink ?? [];
      },
      async reservasHuerfanas() {
        return o.huerfanas ?? [];
      },
      // Igual que la consulta real: intentos `created`/`pending` de Addi cuyo pedido ya está `expirado`.
      async solicitudesFinanciacionVencidas(limite) {
        consultas.solicitudes = limite;
        return pagos
          .filter((p) => p.provider === 'addi' && ['created', 'pending'].includes(p.status) && pedidos.get(p.order_id)?.status === 'expirado')
          .map((p): SolicitudFinanciacionAbierta => ({ payment_id: p.id, order_id: p.order_id, provider: 'addi' }));
      },
      // Condicional por estado, como el PATCH real: si el callback ya lo cambió, no se toca.
      async invalidarSolicitudFinanciacion(paymentId) {
        if (paymentId === o.invalidarFalla) throw new Error('PostgREST 503');
        const p = pagos.find((x) => x.id === paymentId);
        if (!p || !['created', 'pending'].includes(p.status)) return false;
        p.status = 'expired';
        invalidadas.push(paymentId);
        return true;
      },
      async pedido(x) {
        return pedidos.get(x) ?? null;
      },
      async aplicarTransicion(x, ev, fechas) {
        const p = pedidos.get(x)!;
        if (p.status !== ev.from_status) return false;
        p.status = ev.to_status;
        transiciones.push({ id: x, ev, ...(fechas ? { fechas } : {}) });
        return true;
      },
      async liberarStock(x) {
        if (x === o.stockFalla) return { ok: false, reason: 'error' } as never;
        liberados.push(x);
        pedidos.get(x)!.stock_state = 'released';
        return { ok: true } as never;
      },
      async liberarCanje(x) {
        canjes.push(x);
        return { ok: true };
      },
    },
    encolarInicioCod: async (x) => {
      encolados.push(x);
      return 'encolado';
    },
    cancelarJobsCod: async (x) => void cancelados.push(x),
    ahora: () => AHORA,
  };
  return { deps, pedidos, pagos, invalidadas, transiciones, liberados, canjes, encolados, cancelados, consultas };
}

describe('barrido de pedidos (cron)', () => {
  it('pendiente_pago vencido → expirado por aplicar_transicion_pedido, libera stock y canje', async () => {
    const s = escenario({ pedidos: [pedido(1, 'pendiente_pago')], vencer: [{ order_id: id(1), estado_actual: 'pendiente_pago', nuevo_estado: 'expirado' }] });
    expect(await barrerPedidos(s.deps)).toEqual({ vencidos: 1, liberados: 0, encolados: 0, invalidadas: 0, omitidos: 0, errores: 0 });
    expect(s.transiciones).toEqual([
      { id: id(1), ev: expect.objectContaining({ from_status: 'pendiente_pago', to_status: 'expirado', actor: 'system', payload: { motivo: 'reserva_vencida' } }) },
    ]);
    expect(s.liberados).toEqual([id(1)]);
    expect(s.canjes).toEqual([id(1)]);
    expect(s.cancelados).toEqual([]);
  });

  it('esperando_abono vencido → abandonado con abandoned_at; cancela los jobs de contra entrega', async () => {
    const s = escenario({ pedidos: [pedido(2, 'esperando_abono')], vencer: [{ order_id: id(2), estado_actual: 'esperando_abono', nuevo_estado: 'abandonado' }] });
    await barrerPedidos(s.deps);
    expect(s.transiciones[0]).toMatchObject({ ev: { to_status: 'abandonado' }, fechas: { abandoned_at: AHORA } });
    expect(s.liberados).toEqual([id(2)]);
    expect(s.cancelados).toEqual([id(2)]);
  });

  it('pedido que ya cambió (pagado entre la consulta y el barrido) no se toca', async () => {
    const s = escenario({ pedidos: [pedido(3, 'pagado')], vencer: [{ order_id: id(3), estado_actual: 'pendiente_pago', nuevo_estado: 'expirado' }] });
    expect(await barrerPedidos(s.deps)).toMatchObject({ vencidos: 0, omitidos: 1, errores: 0 });
    expect(s.transiciones).toEqual([]);
    expect(s.liberados).toEqual([]);
  });

  it('reserva vigente según el pedido releído (se extendió): no se vence', async () => {
    const s = escenario({
      pedidos: [pedido(4, 'pendiente_pago', { stock_reserved_until: new Date(AHORA.getTime() + 60_000) })],
      vencer: [{ order_id: id(4), estado_actual: 'pendiente_pago', nuevo_estado: 'expirado' }],
    });
    expect(await barrerPedidos(s.deps)).toMatchObject({ vencidos: 0, omitidos: 1 });
  });

  it('un fallo de un pedido no detiene el barrido; liberar_stock fallido cuenta como error (la reserva queda huérfana)', async () => {
    const s = escenario({
      pedidos: [pedido(5, 'pendiente_pago'), pedido(6, 'pendiente_pago')],
      vencer: [
        { order_id: id(5), estado_actual: 'pendiente_pago', nuevo_estado: 'expirado' },
        { order_id: id(6), estado_actual: 'pendiente_pago', nuevo_estado: 'expirado' },
      ],
      stockFalla: id(5),
    });
    expect(await barrerPedidos(s.deps)).toMatchObject({ vencidos: 1, errores: 1 });
    expect(s.pedidos.get(id(5))!.status).toBe('expirado');
    expect(s.liberados).toEqual([id(6)]);
  });

  it('reservas huérfanas (expirado/abandonado con stock reservado): se liberan', async () => {
    const s = escenario({ pedidos: [pedido(7, 'expirado')], huerfanas: [id(7)] });
    expect(await barrerPedidos(s.deps)).toMatchObject({ liberados: 1 });
    expect(s.liberados).toEqual([id(7)]);
    expect(s.canjes).toEqual([id(7)]);
  });

  it('esperando_abono sin pay_links (Redis caído en el checkout): encola cod.iniciar con 2 min de gracia', async () => {
    const s = escenario({ pedidos: [pedido(8, 'esperando_abono')], sinLink: [id(8)] });
    expect(await barrerPedidos(s.deps)).toMatchObject({ encolados: 1 });
    expect(s.encolados).toEqual([id(8)]);
    expect(s.consultas.sinLink![0]).toEqual(new Date(AHORA.getTime() - 120_000));
    expect(s.consultas.sinLink![1]).toEqual(AHORA);
  });
});

describe('barrido: solicitudes de Addi de pedidos vencidos (D-040)', () => {
  const addi = (n: number, status: OrderStatus) => pedido(n, status, { payment_method: 'addi' });
  const pagoAddi = (n: number, order: number, status: string): PagoFinanciacion => ({
    id: `pago-${n}`,
    order_id: id(order),
    provider: 'addi',
    status,
  });

  it('Addi vencido en la misma corrida: expirado, libera stock y la solicitud abierta queda expired (sin llamar a Addi)', async () => {
    const s = escenario({
      pedidos: [addi(20, 'pendiente_pago')],
      vencer: [{ order_id: id(20), estado_actual: 'pendiente_pago', nuevo_estado: 'expirado' }],
      pagos: [pagoAddi(1, 20, 'declined'), pagoAddi(2, 20, 'pending')],
    });
    expect(await barrerPedidos(s.deps)).toEqual({ vencidos: 1, liberados: 0, encolados: 0, invalidadas: 1, omitidos: 0, errores: 0 });
    expect(s.pedidos.get(id(20))!.status).toBe('expirado');
    expect(s.liberados).toEqual([id(20)]);
    expect(s.invalidadas).toEqual(['pago-2']);
    expect(s.pagos.map((p) => p.status)).toEqual(['declined', 'expired']);
    expect(s.consultas.solicitudes).toBe(200);
  });

  it('idempotente: una segunda corrida no encuentra nada que invalidar', async () => {
    const s = escenario({ pedidos: [addi(21, 'expirado')], pagos: [pagoAddi(3, 21, 'created')] });
    expect(await barrerPedidos(s.deps)).toMatchObject({ invalidadas: 1, errores: 0 });
    expect(await barrerPedidos(s.deps)).toMatchObject({ invalidadas: 0, errores: 0 });
    expect(s.invalidadas).toEqual(['pago-3']);
  });

  it('pedido aún pendiente o ya pagado: la solicitud no se toca', async () => {
    const s = escenario({
      pedidos: [addi(22, 'pendiente_pago'), addi(23, 'pagado')],
      pagos: [pagoAddi(4, 22, 'pending'), pagoAddi(5, 23, 'approved')],
    });
    // La reserva del 22 sigue vigente: no está en `vencer`.
    expect(await barrerPedidos(s.deps)).toMatchObject({ vencidos: 0, invalidadas: 0 });
    expect(s.pagos.map((p) => p.status)).toEqual(['pending', 'approved']);
  });

  it('carrera con el callback (ya aprobado entre la consulta y el PATCH): no cuenta ni falla', async () => {
    const s = escenario({ pedidos: [addi(24, 'expirado')], pagos: [pagoAddi(6, 24, 'pending')] });
    const leer = s.deps.fuente.solicitudesFinanciacionVencidas.bind(s.deps.fuente);
    s.deps.fuente.solicitudesFinanciacionVencidas = async (l) => {
      const r = await leer(l);
      s.pagos[0]!.status = 'approved';
      return r;
    };
    expect(await barrerPedidos(s.deps)).toMatchObject({ invalidadas: 0, errores: 0 });
    expect(s.pagos[0]!.status).toBe('approved');
  });

  it('un fallo al invalidar cuenta como error, no detiene el resto y se reintenta en la siguiente corrida', async () => {
    const opciones: Parameters<typeof escenario>[0] = {
      pedidos: [addi(25, 'expirado'), addi(26, 'expirado')],
      pagos: [pagoAddi(7, 25, 'pending'), pagoAddi(8, 26, 'created')],
      invalidarFalla: 'pago-7',
    };
    const s = escenario(opciones);
    const errores: string[] = [];
    const original = console.error;
    console.error = (...a: unknown[]) => void errores.push(a.join(' '));
    try {
      expect(await barrerPedidos(s.deps)).toMatchObject({ invalidadas: 1, errores: 1 });
    } finally {
      console.error = original;
    }
    expect(s.invalidadas).toEqual(['pago-8']);
    expect(errores).toHaveLength(1);
    expect(errores[0]).toContain('invalidar');
    expect(errores[0]).toContain(id(25));
    delete opciones.invalidarFalla;
    expect(await barrerPedidos(s.deps)).toMatchObject({ invalidadas: 1, errores: 0 });
    expect(s.invalidadas).toEqual(['pago-8', 'pago-7']);
  });
});

describe('encoladorInicioCod (mismo id fijo que el checkout)', () => {
  function colaFalsa(previo: { fallido: boolean } | null) {
    const agregados: { nombre: string; datos: unknown; opts: { jobId?: string } }[] = [];
    let reintentado = false;
    const cola = {
      async getJob() {
        return previo ? { isFailed: async () => previo.fallido, retry: async () => void (reintentado = true) } : undefined;
      },
      async add(nombre: string, datos: unknown, opts: { jobId?: string }) {
        agregados.push({ nombre, datos, opts });
      },
    };
    return { cola, agregados, reintentado: () => reintentado };
  }

  it('sin job → lo agrega con el id cod.iniciar.{id}; fallido → retry; existente → nada', async () => {
    const a = colaFalsa(null);
    expect(await encoladorInicioCod(a.cola as never)(id(8))).toBe('encolado');
    expect(a.agregados[0]).toMatchObject({ nombre: 'cod.iniciar', datos: { order_id: id(8) }, opts: { jobId: `cod.iniciar.${id(8)}` } });
    const b = colaFalsa({ fallido: true });
    expect(await encoladorInicioCod(b.cola as never)(id(8))).toBe('reintentado');
    expect(b.reintentado()).toBe(true);
    const c = colaFalsa({ fallido: false });
    expect(await encoladorInicioCod(c.cola as never)(id(8))).toBe('existente');
    expect(c.agregados).toHaveLength(0);
  });
});
