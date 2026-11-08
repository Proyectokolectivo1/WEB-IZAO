import { beforeEach, describe, expect, it, vi } from 'vitest';

const { auditar, revalidar } = vi.hoisted(() => ({ auditar: vi.fn(async (_e: unknown) => true), revalidar: vi.fn() }));
vi.mock('@/lib/admin/auditoria', () => ({ auditarCambio: auditar }));
vi.mock('next/cache', () => ({ revalidateTag: revalidar }));

import { clienteFalso } from '../crud/cliente-falso';
import { destinoDeUrl, esUrlDestinoValida, esquemaBanner, esquemaCarrusel, SECCIONES_TIENDA, urlDeDestino } from './banners';
import { guardarAjustesCarruselBd, leerAjustesCarrusel, resolverDestinoBd } from './servidor';

const D = '11111111-1111-4111-8111-111111111111';
const BASE = { country_code: 'CO', placement: 'hero', desktop_media_id: D, mobile_media_id: '', alt: 'Frasco sobre mármol', is_active: 'on' };
const comun = { actor: 'u1', ip: null };

beforeEach(() => {
  auditar.mockClear();
  revalidar.mockClear();
});

describe('destino: sección de la página', () => {
  it('se arma con el ancla de la tienda y se reconoce al editar', () => {
    expect(urlDeDestino({ tipo: 'seccion', clave: 'resenas' }, 'CO')).toBe('/co#seccion-reviews');
    expect(urlDeDestino({ tipo: 'seccion', clave: 'productos' }, 'EC')).toBe('/ec/catalogo#productos');
    expect(urlDeDestino({ tipo: 'seccion', clave: 'inventada' }, 'CO')).toBeNull();
    for (const s of SECCIONES_TIENDA) {
      for (const p of ['CO', 'EC'] as const) {
        const url = urlDeDestino({ tipo: 'seccion', clave: s.clave }, p)!;
        expect(destinoDeUrl(url)).toEqual({ tipo: 'seccion', clave: s.clave });
        expect(esUrlDestinoValida(url, p)).toBe(true);
      }
    }
  });

  it('una página sin ancla sigue siendo un enlace libre', () => {
    expect(destinoDeUrl('/co/catalogo')).toEqual({ tipo: 'url', url: '/co/catalogo' });
  });

  it('el formulario exige elegir una sección de la lista', () => {
    const base = { ...BASE, destino_tipo: 'seccion' };
    expect(esquemaBanner.safeParse(base).success).toBe(false);
    expect(esquemaBanner.safeParse({ ...base, destino_seccion: '#<script>' }).success).toBe(false);
    expect(esquemaBanner.safeParse({ ...base, destino_seccion: 'resenas' }).success).toBe(true);
  });

  it('enlaces libres: nada de javascript:, data:, http plano ni //otro-sitio', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,x', 'http://sitio.com', '//otro.com', '/co/a\\b']) {
      expect(esquemaBanner.safeParse({ ...BASE, destino_tipo: 'url', destino_url: url }).success).toBe(false);
    }
    expect(esquemaBanner.safeParse({ ...BASE, destino_tipo: 'url', destino_url: 'https://sitio.com/oferta' }).success).toBe(true);
    expect(esquemaBanner.safeParse({ ...BASE, destino_tipo: 'url', destino_url: '/co/catalogo#productos' }).success).toBe(true);
  });

  it('el servidor resuelve la sección a su ancla sin consultar la base', async () => {
    const { cliente, llamadas } = clienteFalso({});
    const base = { country_code: 'EC' as const, destino_producto_id: null, destino_variante_id: null, destino_categoria_id: null, destino_url: '' };
    expect(await resolverDestinoBd(cliente, { ...base, destino_tipo: 'seccion', destino_seccion: 'resenas' })).toEqual({ ok: true, url: '/ec#seccion-reviews' });
    expect(await resolverDestinoBd(cliente, { ...base, destino_tipo: 'seccion', destino_seccion: 'x' })).toMatchObject({
      ok: false,
      errores: { destino_seccion: expect.any(String) },
    });
    expect(llamadas).toHaveLength(0);
  });
});

describe('ajustes del carrusel', () => {
  it('acepta de 3 a 30 segundos enteros, también como texto del formulario', () => {
    expect(esquemaCarrusel.parse({ country_code: 'CO', interval_seconds: '6', show_in_catalog: 'on' })).toEqual({
      country_code: 'CO',
      interval_seconds: 6,
      show_in_catalog: true,
    });
    expect(esquemaCarrusel.parse({ country_code: 'EC', interval_seconds: '3' }).show_in_catalog).toBe(false);
    expect(esquemaCarrusel.parse({ country_code: 'EC', interval_seconds: '30' }).interval_seconds).toBe(30);
  });

  it('rechaza fuera de rango, decimales y vacío con mensaje claro', () => {
    for (const v of ['2', '31', '0', '-5', '4.5', '', 'abc']) {
      expect(esquemaCarrusel.safeParse({ country_code: 'CO', interval_seconds: v }).success).toBe(false);
    }
    const r = esquemaCarrusel.safeParse({ country_code: 'CO', interval_seconds: '2' });
    expect(!r.success && r.error.issues[0]?.message).toBe('Mínimo 3 segundos.');
  });

  it('guardar actualiza la sección hero conservando lo demás, audita e invalida solo ese país', async () => {
    const { cliente, llamadas } = clienteFalso({
      'home_sections.select': { data: [{ id: 'h1', config: { title: 'Hola', interval_seconds: 6 }, sort_order: 10 }] },
      'home_sections.update': { data: null },
    });
    const r = await guardarAjustesCarruselBd({ cliente, datos: { country_code: 'CO', interval_seconds: 9, show_in_catalog: false }, ...comun });
    expect(r.ok).toBe(true);
    const config = (llamadas.find((l) => l.clave === 'home_sections.update')?.args[0] as { config: Record<string, unknown> }).config;
    expect(config).toEqual({ title: 'Hola', interval_seconds: 9, show_in_catalog: false });
    expect(revalidar).toHaveBeenCalledWith('content:CO');
    expect(revalidar).not.toHaveBeenCalledWith('content:EC');
    expect(auditar).toHaveBeenCalledWith(expect.objectContaining({ accion: 'banners.carrusel_ajustado', entidad: 'home_sections' }));
  });

  it('si el país no tiene sección hero, la crea', async () => {
    const { cliente, llamadas } = clienteFalso({ 'home_sections.select': { data: [] }, 'home_sections.insert': { data: null } });
    expect((await guardarAjustesCarruselBd({ cliente, datos: { country_code: 'EC', interval_seconds: 5, show_in_catalog: true }, ...comun })).ok).toBe(true);
    expect(llamadas.find((l) => l.clave === 'home_sections.insert')?.args[0]).toMatchObject({
      country_code: 'EC',
      type: 'hero',
      config: { interval_seconds: 5, show_in_catalog: true },
    });
  });

  it('leer: sin dato usa la semilla (6 s, también en el catálogo)', async () => {
    const vacio = clienteFalso({ 'home_sections.select': { data: [] } });
    expect(await leerAjustesCarrusel(vacio.cliente, 'CO')).toEqual({ segundos: 6, enCatalogo: true });
    const guardado = clienteFalso({ 'home_sections.select': { data: [{ config: { interval_seconds: 12, show_in_catalog: false } }] } });
    expect(await leerAjustesCarrusel(guardado.cliente, 'CO')).toEqual({ segundos: 12, enCatalogo: false });
  });
});
