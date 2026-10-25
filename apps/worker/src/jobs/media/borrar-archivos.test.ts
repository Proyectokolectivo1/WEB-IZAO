import { describe, expect, it, vi } from 'vitest';
import {
  borrarArchivosPendientes,
  fuenteBorradosPostgrest,
  resolverDentro,
  rutasDeFila,
  type FilaBorrado,
  type FuenteBorrados,
} from './borrar-archivos.js';

const fila = (o: Partial<FilaBorrado> = {}): FilaBorrado => ({
  id: 'a', base_path: 'warranty/2026/10/u1', variants: { '640': 'warranty/2026/10/u1-640.webp' }, attempts: 0, ...o,
});

function fuente(filas: FilaBorrado[]) {
  const f = { pendientes: vi.fn().mockResolvedValue(filas), eliminar: vi.fn().mockResolvedValue(undefined), registrarFallo: vi.fn().mockResolvedValue(undefined) };
  return f satisfies FuenteBorrados;
}

describe('borrarArchivosPendientes', () => {
  it('borra base y variantes y luego la fila', async () => {
    const f = fuente([fila()]);
    const borrar = vi.fn().mockResolvedValue(undefined);
    const r = await borrarArchivosPendientes({ fuente: f, mediaRoot: '/m', borrar });
    expect(borrar).toHaveBeenCalledTimes(2);
    expect(f.eliminar).toHaveBeenCalledWith('a');
    expect(r).toEqual({ borrados: 1, fallidos: 0 });
  });

  it('si falla sube attempts, guarda last_error y no elimina la fila', async () => {
    const f = fuente([fila({ attempts: 2 })]);
    const borrar = vi.fn().mockRejectedValue(Object.assign(new Error('x'), { code: 'EBUSY' }));
    const r = await borrarArchivosPendientes({ fuente: f, mediaRoot: '/m', borrar });
    expect(f.eliminar).not.toHaveBeenCalled();
    expect(f.registrarFallo).toHaveBeenCalledWith('a', 3, 'EBUSY');
    expect(r.fallidos).toBe(1);
  });

  it('una fila fallida no frena a las siguientes', async () => {
    const f = fuente([fila({ id: 'a' }), fila({ id: 'b' })]);
    const borrar = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined);
    await borrarArchivosPendientes({ fuente: f, mediaRoot: '/m', borrar });
    expect(f.eliminar).toHaveBeenCalledWith('b');
  });

  it('rechaza rutas fuera de la raíz', async () => {
    const f = fuente([fila({ base_path: '../etc/passwd', variants: {} })]);
    const borrar = vi.fn();
    await borrarArchivosPendientes({ fuente: f, mediaRoot: '/m', borrar });
    expect(borrar).not.toHaveBeenCalled();
    expect(f.registrarFallo).toHaveBeenCalledWith('a', 1, 'ruta_fuera_de_raiz');
    expect(() => resolverDentro('/m', '/abs')).toThrow();
  });

  it('rutasDeFila no repite y tolera variants nulo', () => {
    expect(rutasDeFila(fila({ variants: null }))).toEqual(['warranty/2026/10/u1']);
  });
});

describe('fuenteBorradosPostgrest', () => {
  it('lee pendientes con tope de intentos, elimina y registra fallos', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('[]', { status: 200 }));
    const f = fuenteBorradosPostgrest({ supabaseUrl: 'https://x.co/', secretKey: 'k', fetchImpl });
    await f.pendientes(5);
    await f.eliminar('i d');
    await f.registrarFallo('i', 2, 'EBUSY');
    const urls = fetchImpl.mock.calls.map((c) => [c[0], (c[1] as RequestInit).method]);
    expect(urls[0]?.[0]).toContain('attempts=lt.10');
    expect(urls[1]).toEqual(['https://x.co/rest/v1/media_file_deletions?id=eq.i%20d', 'DELETE']);
    expect(urls[2]?.[1]).toBe('PATCH');
  });
});
