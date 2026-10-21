import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { puede, puedeVerRuta, type AccionId } from '@/lib/auth/permissions';

const m = vi.hoisted(() => ({
  rol: 'operator' as 'admin' | 'operator',
  bd: {
    crear: vi.fn(async () => ({ ok: true as const, mensaje: 'ok', id: 'x', token: 'tok' })),
    rotar: vi.fn(async () => ({ ok: true as const, mensaje: 'ok', token: 'tok' })),
    estado: vi.fn(async () => ({ ok: true as const, mensaje: 'ok' })),
    config: vi.fn(async () => ({ ok: true as const, mensaje: 'ok' })),
    prueba: vi.fn(async () => ({ ok: true as const, mensaje: 'ok' })),
    reimprimir: vi.fn(async () => ({ ok: true as const, mensaje: 'ok' })),
  },
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/cabeceras', () => ({ ipDelCliente: async () => null }));
vi.mock('@/lib/auth/supabase/servicio', () => ({ crearClienteServicio: () => ({}) }));
vi.mock('@/lib/admin/agentes/servidor', () => ({
  crearAgenteBd: m.bd.crear,
  rotarTokenBd: m.bd.rotar,
  cambiarEstadoAgenteBd: m.bd.estado,
  guardarConfigAgenteBd: m.bd.config,
  paginaPruebaBd: m.bd.prueba,
}));
vi.mock('@/lib/admin/pedidos/acciones-servidor', () => ({ reimprimirEtiquetaBd: m.bd.reimprimir }));
vi.mock('@/lib/admin/crud/servidor', () => ({
  adminDeAccion: async (_modulo: string, accion: AccionId) =>
    puede(m.rol, accion)
      ? { admin: { userId: 'u1', rol: m.rol } }
      : { error: { ok: false, mensaje: 'No tienes permiso para esta acción.' } },
}));

import {
  cambiarEstadoAgente,
  crearAgente,
  guardarConfigAgente,
  imprimirPaginaPrueba,
  reimprimirDesdeAgente,
  rotarToken,
} from './acciones';

const ID = '11111111-1111-4111-8111-111111111111';

/** §24.3: el operador ve el estado, reimprime y pide la página de prueba; todo lo demás es del administrador. */
const CASOS: { nombre: string; llamar: () => Promise<{ ok: boolean }>; bd: keyof typeof m.bd; operador: boolean }[] = [
  { nombre: 'crear agente', llamar: () => crearAgente('PC despacho'), bd: 'crear', operador: false },
  { nombre: 'rotar token', llamar: () => rotarToken(ID), bd: 'rotar', operador: false },
  { nombre: 'activar o desactivar', llamar: () => cambiarEstadoAgente(ID, false), bd: 'estado', operador: false },
  { nombre: 'guardar configuración', llamar: () => guardarConfigAgente(ID, { ok: false }, new FormData()), bd: 'config', operador: false },
  { nombre: 'página de prueba', llamar: () => imprimirPaginaPrueba(), bd: 'prueba', operador: true },
  { nombre: 'reimprimir', llamar: () => reimprimirDesdeAgente(ID), bd: 'reimprimir', operador: true },
];

beforeEach(() => Object.values(m.bd).forEach((f) => f.mockClear()));

describe.each(CASOS)('$nombre', ({ llamar, bd, operador }) => {
  it('administrador: permitido', async () => {
    m.rol = 'admin';
    expect((await llamar()).ok).toBe(true);
    expect(m.bd[bd]).toHaveBeenCalledTimes(1);
  });

  it(`operador: ${operador ? 'permitido' : 'denegado sin tocar la base'}`, async () => {
    m.rol = 'operator';
    const r = await llamar();
    expect(r.ok).toBe(operador);
    expect(m.bd[bd]).toHaveBeenCalledTimes(operador ? 1 : 0);
  });
});

describe('entrada y rutas', () => {
  it('rechaza identificadores que no son UUID', async () => {
    m.rol = 'admin';
    expect((await rotarToken('x')).ok).toBe(false);
    expect((await cambiarEstadoAgente('x', true)).ok).toBe(false);
    expect((await reimprimirDesdeAgente('x')).ok).toBe(false);
    expect(m.bd.rotar).not.toHaveBeenCalled();
  });

  it('una configuración inválida no llega a la base', async () => {
    m.rol = 'admin';
    const f = new FormData();
    f.set('mode', 'panel');
    f.set('print_copies', '99');
    const r = await guardarConfigAgente(ID, { ok: false }, f);
    expect(r.ok).toBe(false);
    expect(m.bd.config).not.toHaveBeenCalled();
  });

  it('el módulo y su detalle son visibles para ambos roles (la gestión se restringe por acción)', () => {
    expect(puedeVerRuta('operator', '/admin/agente-impresion')).toBe(true);
    expect(puede('operator', 'agente.gestionar')).toBe(false);
    expect(puede('admin', 'agente.gestionar')).toBe(true);
  });
});

describe('el token y su hash no llegan a páginas ni a auditoría', () => {
  const raiz = path.resolve(__dirname, '../../../..');
  function archivos(dir: string): string[] {
    return readdirSync(dir).flatMap((n) => {
      const p = path.join(dir, n);
      return statSync(p).isDirectory() ? archivos(p) : [p];
    });
  }
  const paginas = archivos(path.join(raiz, 'app/admin/(panel)/agente-impresion')).filter((f) => f.endsWith('page.tsx'));

  it.each(paginas)('%s no lee token_hash', (archivo) => {
    expect(readFileSync(archivo, 'utf8')).not.toMatch(/token_hash/);
  });

  it('la lectura de agentes elige columnas sin token_hash', () => {
    const texto = readFileSync(path.join(raiz, 'lib/admin/agentes/servidor.ts'), 'utf8');
    const columnas = /COLUMNAS_AGENTE = '([^']+)'/.exec(texto)?.[1] ?? '';
    expect(columnas).not.toBe('');
    expect(columnas).not.toContain('token_hash');
  });
});
