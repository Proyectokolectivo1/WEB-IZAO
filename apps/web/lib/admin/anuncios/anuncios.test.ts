import { beforeEach, describe, expect, it, vi } from 'vitest';

const { auditar, revalidar } = vi.hoisted(() => ({ auditar: vi.fn(async (_e: unknown) => true), revalidar: vi.fn() }));
vi.mock('@/lib/admin/auditoria', () => ({ auditarCambio: auditar }));
vi.mock('next/cache', () => ({ revalidateTag: revalidar }));
vi.mock('server-only', () => ({}));

import { clienteFalso } from '../crud/cliente-falso';
import { esquemaAnuncio, esquemaRotacion } from './anuncios';
import { alternarAnuncioBd, eliminarAnuncioBd, guardarAnuncioBd, guardarRotacionBd, leerRotacion, moverAnuncioBd } from './servidor';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const comun = { actor: 'u1', ip: null };

beforeEach(() => {
  auditar.mockClear();
  revalidar.mockClear();
});

describe('esquema de la cinta superior', () => {
  it('acepta una frase con o sin enlace y recorta espacios', () => {
    const d = esquemaAnuncio.parse({ country_code: 'CO', text: '  Envío gratis a toda Colombia ', link_url: '', is_active: 'on' });
    expect(d).toMatchObject({ text: 'Envío gratis a toda Colombia', link_url: null, is_active: true, id: null });
    expect(esquemaAnuncio.safeParse({ country_code: 'CO', text: 'Ver ofertas', link_url: '/co/catalogo' }).success).toBe(true);
    expect(esquemaAnuncio.safeParse({ country_code: 'CO', text: 'Ver ofertas', link_url: 'https://wa.me/573000000000' }).success).toBe(true);
  });

  it('rechaza frases vacías o largas, enlaces peligrosos y enlaces a otro país', () => {
    expect(esquemaAnuncio.safeParse({ country_code: 'CO', text: 'ab' }).success).toBe(false);
    expect(esquemaAnuncio.safeParse({ country_code: 'CO', text: 'x'.repeat(121) }).success).toBe(false);
    for (const url of ['javascript:alert(1)', 'http://sitio.com', '//otro.com', 'catalogo']) {
      expect(esquemaAnuncio.safeParse({ country_code: 'CO', text: 'Oferta', link_url: url }).success).toBe(false);
    }
    expect(esquemaAnuncio.safeParse({ country_code: 'CO', text: 'Oferta', link_url: '/ec/catalogo' }).success).toBe(false);
  });

  it('regla 7: no afirma originalidad ni certificados', () => {
    const r = esquemaAnuncio.safeParse({ country_code: 'CO', text: 'Perfumes 100% originales' });
    expect(r.success).toBe(false);
    expect(!r.success && r.error.issues[0]?.path).toEqual(['text']);
  });

  it('la velocidad va de 2 a 30 segundos enteros', () => {
    expect(esquemaRotacion.parse({ country_code: 'CO', seconds: '4' }).seconds).toBe(4);
    for (const v of ['1', '31', '2.5', '', 'x']) expect(esquemaRotacion.safeParse({ country_code: 'CO', seconds: v }).success).toBe(false);
  });
});

describe('servidor de la cinta superior', () => {
  it('crea al final de la lista del país, audita e invalida solo ese país', async () => {
    const { cliente, llamadas } = clienteFalso({
      'announcements.select': { data: [{ sort_order: 30 }] },
      'announcements.insert': { data: { id: A } },
    });
    const datos = esquemaAnuncio.parse({ country_code: 'EC', text: 'Envío gratis a todo Ecuador', is_active: 'on' });
    expect(await guardarAnuncioBd({ cliente, datos, ...comun })).toEqual({ ok: true, id: A });
    expect(llamadas.find((l) => l.clave === 'announcements.insert')?.args[0]).toMatchObject({ country_code: 'EC', sort_order: 40, is_active: true });
    expect(revalidar).toHaveBeenCalledWith('content:EC');
    expect(revalidar).not.toHaveBeenCalledWith('content:CO');
    expect(auditar).toHaveBeenCalledWith(expect.objectContaining({ accion: 'anuncios.creado', entidad: 'announcements' }));
  });

  it('editar no cambia el país de la frase y guarda el diff', async () => {
    const { cliente, llamadas } = clienteFalso({
      'announcements.select': { data: { id: A, country_code: 'CO', text: 'Antes', link_url: null, is_active: true } },
      'announcements.update': { data: null },
    });
    const datos = esquemaAnuncio.parse({ id: A, country_code: 'EC', text: 'Después', is_active: 'on' });
    expect((await guardarAnuncioBd({ cliente, datos, ...comun })).ok).toBe(true);
    const cambios = llamadas.find((l) => l.clave === 'announcements.update')?.args[0] as Record<string, unknown>;
    expect(cambios).not.toHaveProperty('country_code');
    expect(cambios).toMatchObject({ text: 'Después' });
    expect(revalidar).toHaveBeenCalledWith('content:CO');
  });

  it('activar o desactivar y borrar auditan; una frase que ya no existe se avisa', async () => {
    const { cliente } = clienteFalso({
      'announcements.select': { data: { country_code: 'CO', is_active: true } },
      'announcements.update': { data: null },
      'announcements.delete': { data: null },
    });
    expect((await alternarAnuncioBd({ cliente, id: A, activo: false, ...comun })).ok).toBe(true);
    expect(auditar).toHaveBeenCalledWith(expect.objectContaining({ accion: 'anuncios.desactivado' }));
    expect((await eliminarAnuncioBd({ cliente, id: A, ...comun })).ok).toBe(true);
    expect(auditar).toHaveBeenCalledWith(expect.objectContaining({ accion: 'anuncios.eliminado' }));
    const vacio = clienteFalso({ 'announcements.select': { data: null } });
    expect(await alternarAnuncioBd({ cliente: vacio.cliente, id: A, activo: true, ...comun })).toMatchObject({ ok: false });
  });

  it('mover renumera de 10 en 10 y solo escribe lo que cambia', async () => {
    const { cliente, llamadas } = clienteFalso({
      'announcements.select': [
        { data: { country_code: 'CO' } },
        { data: [{ id: A, sort_order: 10 }, { id: B, sort_order: 20 }] },
      ],
      'announcements.update': { data: null },
    });
    expect((await moverAnuncioBd({ cliente, id: B, direccion: 'arriba', ...comun })).ok).toBe(true);
    const escritos = llamadas.filter((l) => l.clave === 'announcements.update').map((l) => l.args[0]);
    expect(escritos).toEqual([{ sort_order: 10 }, { sort_order: 20 }]);
  });

  it('guarda y lee la velocidad de rotación del país', async () => {
    const { cliente, llamadas } = clienteFalso({
      'country_settings.select': { data: { announcement_rotation_seconds: 4 } },
      'country_settings.update': { data: null },
    });
    expect(await leerRotacion(cliente, 'CO')).toBe(4);
    expect((await guardarRotacionBd({ cliente, datos: { country_code: 'CO', seconds: 7 }, ...comun })).ok).toBe(true);
    expect(llamadas.find((l) => l.clave === 'country_settings.update')?.args[0]).toEqual({ announcement_rotation_seconds: 7 });
    expect(auditar).toHaveBeenCalledWith(expect.objectContaining({ accion: 'anuncios.rotacion_ajustada' }));
    expect(revalidar).toHaveBeenCalledWith('content:CO');
  });
});
