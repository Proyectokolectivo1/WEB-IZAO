import { beforeEach, describe, expect, it, vi } from 'vitest';

const { auditar, invalidar } = vi.hoisted(() => ({ auditar: vi.fn(async (_e: unknown) => true), invalidar: vi.fn() }));
vi.mock('@/lib/admin/auditoria', () => ({ auditarCambio: auditar }));
vi.mock('next/cache', () => ({ revalidateTag: invalidar }));

import { clienteFalso } from '../crud/cliente-falso';
import { esquemaApariencia } from './apariencia';
import { guardarAparienciaBd, leerApariencia, quitarOverridePaisBd } from './servidor';

const comun = { actor: 'u1', ip: null };
const SITIO = {
  store_name: 'Izao Perfumería',
  color_tokens: { 'color-bg': '#FDFBF7', 'color-ink': '#382E2B', 'color-line': 'rgba(56, 46, 43, 0.12)' },
  typography: { pair: 1, base_size_px: 16 },
  logo_media_id: null,
  favicon_media_id: null,
};
const FORM = {
  color_bg: '#FDFBF7',
  color_surface: '#EADCC9',
  color_accent: '#CBA8A8',
  color_muted: '#8E7564',
  color_ink: '#382E2B',
  color_ink_hover: '#4A3D39',
  color_success: '#5E7A5A',
  color_danger: '#A4483B',
  pair: '3',
  base_size_px: '17',
  heading_weight: '500',
  heading_letter_spacing: '0em',
  label_letter_spacing: '0.14em',
  store_name: 'Izao',
};
const vacioPais = Object.fromEntries(Object.keys(FORM).map((k) => [k, ''])) as Record<string, string>;

beforeEach(() => {
  auditar.mockClear();
  invalidar.mockClear();
});

describe('leerApariencia', () => {
  it('trae el tema del sitio, el override del país y las imágenes de marca', async () => {
    const { cliente } = clienteFalso({
      'site_settings.select': { data: { ...SITIO, logo_media_id: 'm1' } },
      'theme_overrides.select': { data: { tokens: { 'color-accent': '#112233' } } },
      'media.select': { data: { id: 'm1', variants: { '400': 'site/logo-400.webp' }, alt: 'Logo' } },
    });
    const a = await leerApariencia(cliente, 'EC');
    expect(a.override).toEqual({ 'color-accent': '#112233' });
    expect(a.logo).toEqual({ id: 'm1', ruta: 'site/logo-400.webp', alt: 'Logo' });
    expect(a.favicon).toBeNull();
    expect(a.storeName).toBe('Izao Perfumería');
  });
});

describe('guardarAparienciaBd (global)', () => {
  it('guarda tokens y tipografía conservando lo ajeno, audita e invalida ambos países', async () => {
    const { cliente, llamadas } = clienteFalso({ 'site_settings.select': { data: SITIO }, 'site_settings.update': {} });
    const r = await guardarAparienciaBd({ cliente, datos: esquemaApariencia('global').parse(FORM), ...comun });
    expect(r).toEqual({ ok: true, id: 'global' });
    const fila = llamadas.find((l) => l.clave === 'site_settings.update')!.args[0] as Record<string, Record<string, unknown>>;
    expect(fila.color_tokens).toMatchObject({ 'color-line': 'rgba(56, 46, 43, 0.12)', 'color-ink': '#382E2B' });
    expect(fila.typography).toMatchObject({ pair: 3, heading_font: 'Fraunces', body_font: 'Inter Tight', base_size_px: 17 });
    expect(fila).toMatchObject({ store_name: 'Izao', logo_media_id: null });
    expect(auditar).toHaveBeenCalledWith(expect.objectContaining({ accion: 'apariencia.global_guardada', entidad: 'site_settings' }));
    expect(invalidar).toHaveBeenCalledWith('content:CO');
    expect(invalidar).toHaveBeenCalledWith('content:EC');
  });

  it('bloquea un contraste grave sin aceptación, y lo permite con ella', async () => {
    const malo = { ...FORM, color_ink: '#E0D8CC' };
    const sin = clienteFalso({ 'site_settings.select': { data: SITIO }, 'site_settings.update': {} });
    expect(await guardarAparienciaBd({ cliente: sin.cliente, datos: esquemaApariencia('global').parse(malo), ...comun })).toMatchObject({
      ok: false,
      errores: { acepto_contraste: expect.any(String) },
    });
    expect(sin.llamadas.some((l) => l.clave === 'site_settings.update')).toBe(false);
    expect(auditar).not.toHaveBeenCalled();

    const con = clienteFalso({ 'site_settings.select': { data: SITIO }, 'site_settings.update': {} });
    const r = await guardarAparienciaBd({ cliente: con.cliente, datos: esquemaApariencia('global').parse({ ...malo, acepto_contraste: 'on' }), ...comun });
    expect(r.ok).toBe(true);
  });
});

describe('guardarAparienciaBd (país)', () => {
  it('hace upsert del override solo con lo que cambia e invalida solo ese país', async () => {
    const { cliente, llamadas } = clienteFalso({
      'site_settings.select': { data: SITIO },
      'theme_overrides.select': { data: null },
      'theme_overrides.upsert': {},
    });
    const datos = esquemaApariencia('EC').parse({ ...vacioPais, color_accent: '#E8C9C9', pair: '5' });
    expect(await guardarAparienciaBd({ cliente, datos, ...comun })).toEqual({ ok: true, id: 'EC' });
    const up = llamadas.find((l) => l.clave === 'theme_overrides.upsert')!;
    expect(up.args[0]).toEqual({ country_code: 'EC', tokens: { 'color-accent': '#E8C9C9', typography: { pair: 5, heading_font: 'Marcellus', body_font: 'Mulish' } } });
    expect(up.args[1]).toEqual({ onConflict: 'country_code' });
    expect(invalidar).toHaveBeenCalledTimes(1);
    expect(invalidar).toHaveBeenCalledWith('content:EC');
  });

  it('el contraste del país se evalúa sobre el tema del sitio con sus cambios encima', async () => {
    const { cliente } = clienteFalso({ 'site_settings.select': { data: SITIO }, 'theme_overrides.select': { data: null }, 'theme_overrides.upsert': {} });
    const datos = esquemaApariencia('EC').parse({ ...vacioPais, color_bg: '#382E2B' }); // fondo oscuro con tinta oscura
    expect(await guardarAparienciaBd({ cliente, datos, ...comun })).toMatchObject({ ok: false, errores: { acepto_contraste: expect.any(String) } });
  });

  it('quitar los ajustes deja el override vacío y audita el antes', async () => {
    const { cliente, llamadas } = clienteFalso({
      'site_settings.select': { data: SITIO },
      'theme_overrides.select': { data: { tokens: { 'color-accent': '#112233' } } },
      'theme_overrides.upsert': {},
    });
    expect(await quitarOverridePaisBd({ cliente, pais: 'EC', ...comun })).toEqual({ ok: true, id: 'EC' });
    expect(llamadas.find((l) => l.clave === 'theme_overrides.upsert')!.args[0]).toEqual({ country_code: 'EC', tokens: {} });
    expect(auditar).toHaveBeenCalledWith(expect.objectContaining({ accion: 'apariencia.pais_restablecida', diff: { antes: { 'color-accent': '#112233' }, despues: {} } }));
    expect(invalidar).toHaveBeenCalledWith('content:EC');
  });
});
