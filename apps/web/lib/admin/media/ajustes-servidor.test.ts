import { beforeEach, describe, expect, it, vi } from 'vitest';

const { auditar } = vi.hoisted(() => ({ auditar: vi.fn(async (_e: unknown) => true) }));
vi.mock('@/lib/admin/auditoria', () => ({ auditarCambio: auditar }));
vi.mock('@/lib/auth/supabase/servicio', () => ({ crearClienteServicio: () => ({}) }));

import { clienteFalso } from '../crud/cliente-falso';
import { MENSAJE_SIN_COLUMNA, guardarAjustesMediaBd } from './ajustes-servidor';

const comun = { actor: 'u1', ip: null, ajustes: { calidad: 70, maxMb: 8 } };

beforeEach(() => auditar.mockClear());

describe('guardar ajustes de imagen', () => {
  it('guarda en site_settings.media_settings y audita el antes y el después', async () => {
    const { cliente, llamadas } = clienteFalso({
      'site_settings.select': { data: { media_settings: { webp_quality: 80, max_mb: 15 } } },
      'site_settings.update': { data: null },
    });
    const r = await guardarAjustesMediaBd({ cliente: cliente as never, ...comun });
    expect(r).toEqual({ ok: true });
    expect(llamadas.find((l) => l.clave === 'site_settings.update')?.args[0]).toEqual({ media_settings: { webp_quality: 70, max_mb: 8 } });
    expect(auditar).toHaveBeenCalledWith(
      expect.objectContaining({
        accion: 'media.ajustes_guardados',
        diff: { antes: { webp_quality: 80, max_mb: 15 }, despues: { webp_quality: 70, max_mb: 8 } },
      }),
    );
  });

  it('si la columna no existe lo dice y no audita', async () => {
    const { cliente } = clienteFalso({
      'site_settings.select': { error: { code: '42703', message: 'column site_settings.media_settings does not exist' } },
    });
    expect(await guardarAjustesMediaBd({ cliente: cliente as never, ...comun })).toEqual({ ok: false, mensaje: MENSAJE_SIN_COLUMNA });
    expect(auditar).not.toHaveBeenCalled();
  });
});
