import { beforeEach, describe, expect, it, vi } from 'vitest';

const { auditar, invalidar } = vi.hoisted(() => ({ auditar: vi.fn(async (_e: unknown) => true), invalidar: vi.fn() }));
vi.mock('@/lib/admin/auditoria', () => ({ auditarCambio: auditar }));
vi.mock('next/cache', () => ({ revalidateTag: invalidar }));

import { clienteFalso } from '../crud/cliente-falso';
import { entradaSeccion, esquemaSeccion } from './home';
import { alternarSeccionBd, eliminarSeccionBd, guardarSeccionBd, listarSecciones, moverSeccionBd } from './servidor';

const comun = { actor: 'u1', ip: null };
const fila = (id: string, type: string, sort_order: number, o: Record<string, unknown> = {}) => ({
  id,
  country_code: 'CO',
  type,
  config: {},
  sort_order,
  is_active: true,
  ...o,
});
const TRES = [fila('a', 'hero', 10), fila('b', 'categories', 20), fila('c', 'reviews', 30)];

beforeEach(() => {
  auditar.mockClear();
  invalidar.mockClear();
});

describe('listarSecciones', () => {
  it('descarta tipos desconocidos', async () => {
    const { cliente } = clienteFalso({ 'home_sections.select': { data: [...TRES, fila('x', 'rara', 40)] } });
    expect((await listarSecciones(cliente, 'CO')).map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('moverSeccionBd', () => {
  it('renumera en un solo upsert con filas completas, audita e invalida el país', async () => {
    const { cliente, llamadas } = clienteFalso({
      'home_sections.select': [{ data: TRES[1] }, { data: TRES }],
      'home_sections.upsert': {},
    });
    expect(await moverSeccionBd({ cliente, id: 'b', sentido: 'arriba', ...comun })).toEqual({ ok: true, id: 'b' });
    const up = llamadas.filter((l) => l.clave === 'home_sections.upsert');
    expect(up).toHaveLength(1);
    expect(up[0]!.args[0]).toEqual([
      fila('b', 'categories', 10),
      fila('a', 'hero', 20),
    ]);
    expect(up[0]!.args[1]).toEqual({ onConflict: 'id' });
    expect(auditar).toHaveBeenCalledWith(expect.objectContaining({ accion: 'home.orden_cambiado' }));
    expect(invalidar).toHaveBeenCalledWith('content:CO');
    expect(invalidar).not.toHaveBeenCalledWith('content:EC');
  });

  it('en el borde no escribe nada', async () => {
    const { cliente, llamadas } = clienteFalso({ 'home_sections.select': [{ data: TRES[0] }, { data: TRES }] });
    expect((await moverSeccionBd({ cliente, id: 'a', sentido: 'arriba', ...comun })).ok).toBe(true);
    expect(llamadas.some((l) => l.clave === 'home_sections.upsert')).toBe(false);
    expect(auditar).not.toHaveBeenCalled();
  });

  it('una sección inexistente se rechaza', async () => {
    const { cliente } = clienteFalso({ 'home_sections.select': { data: null } });
    expect(await moverSeccionBd({ cliente, id: 'z', sentido: 'abajo', ...comun })).toMatchObject({ ok: false });
  });
});

describe('guardarSeccionBd', () => {
  it('crea una sección al final del orden del país', async () => {
    const { cliente, llamadas } = clienteFalso({ 'home_sections.select': { data: TRES }, 'home_sections.insert': { data: { id: 'n' } } });
    const datos = esquemaSeccion.parse(entradaSeccion({ type: 'banner', title: 'Ofertas', is_active: 'on' }));
    expect(await guardarSeccionBd({ cliente, datos, pais: 'EC', ...comun })).toEqual({ ok: true, id: 'n' });
    expect(llamadas.find((l) => l.clave === 'home_sections.insert')!.args[0]).toEqual({
      country_code: 'EC',
      type: 'banner',
      config: { title: 'Ofertas' },
      sort_order: 40,
      is_active: true,
    });
    expect(invalidar).toHaveBeenCalledWith('content:EC');
  });

  it('edita sin cambiar el tipo ni el país y conserva las claves desconocidas del config', async () => {
    const { cliente, llamadas } = clienteFalso({
      'home_sections.select': { data: fila('b', 'advice', 20, { config: { title: 'Viejo', futuro: 1 } }) },
      'home_sections.update': {},
    });
    // El formulario dice "hero", pero la sección guardada es "advice": manda la guardada.
    const datos = esquemaSeccion.parse({ ...entradaSeccion({ type: 'hero', title: 'Nuevo' }), id: '11111111-1111-4111-8111-111111111111' });
    expect(await guardarSeccionBd({ cliente, datos, pais: 'EC', ...comun })).toMatchObject({ ok: true });
    const upd = llamadas.find((l) => l.clave === 'home_sections.update')!.args[0] as Record<string, unknown>;
    expect(upd).toEqual({ config: { title: 'Nuevo', futuro: 1 }, is_active: false });
    expect(Object.keys(upd)).not.toContain('country_code');
    expect(invalidar).toHaveBeenCalledWith('content:CO');
  });
});

describe('alternar y eliminar', () => {
  it('ocultar audita con la acción correcta', async () => {
    const { cliente } = clienteFalso({ 'home_sections.select': { data: TRES[0] }, 'home_sections.update': {} });
    expect((await alternarSeccionBd({ cliente, id: 'a', activa: false, ...comun })).ok).toBe(true);
    expect(auditar).toHaveBeenCalledWith(expect.objectContaining({ accion: 'home.seccion_desactivada' }));
  });

  it('eliminar guarda el registro anterior en la auditoría', async () => {
    const { cliente } = clienteFalso({ 'home_sections.select': { data: TRES[2] }, 'home_sections.delete': {} });
    expect(await eliminarSeccionBd({ cliente, id: 'c', ...comun })).toEqual({ ok: true });
    expect(auditar).toHaveBeenCalledWith(expect.objectContaining({ accion: 'home.seccion_eliminada', diff: { antes: expect.objectContaining({ id: 'c' }) } }));
  });
});
