import { beforeEach, describe, expect, it, vi } from 'vitest';
import { puede, type AccionId, type Rol } from '@/lib/auth/permissions';

const m = vi.hoisted(() => ({
  rol: 'operator' as 'admin' | 'operator',
  bd: {
    cancelar: vi.fn(async () => ({ ok: true as const, mensaje: 'ok' })),
    pagado: vi.fn(async () => ({ ok: true as const, mensaje: 'ok' })),
    nota: vi.fn(async () => ({ ok: true as const, mensaje: 'ok' })),
    reintentar: vi.fn(async () => ({ ok: true as const, mensaje: 'ok' })),
    reimprimir: vi.fn(async () => ({ ok: true as const, mensaje: 'ok' })),
  },
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/cabeceras', () => ({ ipDelCliente: async () => null }));
vi.mock('@/lib/auth/supabase/servicio', () => ({ crearClienteServicio: () => ({}) }));
vi.mock('@/app/api/webhooks/mastershop/cola', () => ({ reintentarEnvioMasterShop: vi.fn() }));
vi.mock('@/lib/admin/pedidos/externos-servidor', () => ({
  confirmarStockPedido: vi.fn(),
  crearCancelarEnMasterShop: () => vi.fn(),
}));
vi.mock('@/lib/admin/pedidos/cola-cobro', () => ({ encolarCobro: vi.fn() }));
vi.mock('@/lib/admin/pedidos/cobro-servidor', () => ({ linkCobroBd: vi.fn(), reenviarCobroBd: vi.fn() }));
vi.mock('@/lib/admin/pedidos/acciones-servidor', () => ({
  cancelarPedidoBd: m.bd.cancelar,
  marcarPagadoBd: m.bd.pagado,
  agregarNotaBd: m.bd.nota,
  reintentarEnvioBd: m.bd.reintentar,
  reimprimirEtiquetaBd: m.bd.reimprimir,
}));
// El control de permisos real (`puede`) con un rol fijo por prueba.
vi.mock('@/lib/admin/crud/servidor', () => ({
  adminDeAccion: async (_modulo: string, accion: AccionId) =>
    puede(m.rol, accion)
      ? { admin: { userId: 'u1', rol: m.rol } }
      : { error: { ok: false, mensaje: 'No tienes permiso para esta acción.' } },
}));

import { agregarNota, cancelarPedido, marcarPagado, reimprimirEtiqueta, reintentarEnvio } from './acciones';

const ID = '11111111-1111-4111-8111-111111111111';

/** §24.3: cancelar y marcar pagado solo administrador; el resto, operador y administrador. */
const CASOS: { nombre: string; llamar: () => Promise<{ ok: boolean }>; bd: keyof typeof m.bd; operador: boolean }[] = [
  { nombre: 'cancelar', llamar: () => cancelarPedido(ID, 'motivo'), bd: 'cancelar', operador: false },
  { nombre: 'marcar pagado', llamar: () => marcarPagado(ID, 'ref 1'), bd: 'pagado', operador: false },
  { nombre: 'nota interna', llamar: () => agregarNota(ID, 'hola'), bd: 'nota', operador: true },
  { nombre: 'reintentar envío', llamar: () => reintentarEnvio(ID), bd: 'reintentar', operador: true },
  { nombre: 'reimprimir etiqueta', llamar: () => reimprimirEtiqueta(ID), bd: 'reimprimir', operador: true },
];

beforeEach(() => Object.values(m.bd).forEach((f) => f.mockClear()));

describe.each(CASOS)('$nombre', ({ llamar, bd, operador }) => {
  it(`administrador: permitido`, async () => {
    m.rol = 'admin' satisfies Rol;
    expect((await llamar()).ok).toBe(true);
    expect(m.bd[bd]).toHaveBeenCalledTimes(1);
  });

  it(`operador: ${operador ? 'permitido' : 'denegado sin tocar la base'}`, async () => {
    m.rol = 'operator' satisfies Rol;
    const r = await llamar();
    expect(r.ok).toBe(operador);
    expect(m.bd[bd]).toHaveBeenCalledTimes(operador ? 1 : 0);
  });
});

describe('entrada', () => {
  it('rechaza identificadores que no son UUID sin llamar a la base', async () => {
    m.rol = 'admin';
    expect((await cancelarPedido('no-es-uuid', 'motivo')).ok).toBe(false);
    expect((await agregarNota("1'; drop table orders;--", 'x')).ok).toBe(false);
    expect(m.bd.cancelar).not.toHaveBeenCalled();
    expect(m.bd.nota).not.toHaveBeenCalled();
  });
});
