import { describe, expect, it } from 'vitest';
import { COLORES_POR_DEFECTO } from '@izao/ui/tema';
import {
  coloresEfectivos,
  contrastesDe,
  esquemaApariencia,
  fallosGraves,
  leerAlcance,
  normalizarHex,
  tipografiaGlobal,
  tokensDePais,
  tokensGlobales,
} from './apariencia';

const COMPLETO = {
  color_bg: '#fdfbf7',
  color_surface: '#EADCC9',
  color_accent: '#CBA8A8',
  color_muted: '#8E7564',
  color_ink: '#382e2b',
  color_ink_hover: '#4A3D39',
  color_success: '#5E7A5A',
  color_danger: '#A4483B',
  pair: '2',
  base_size_px: '17',
  heading_weight: '600',
  heading_letter_spacing: '0.02em',
  label_letter_spacing: '0.14em',
  store_name: ' Izao Perfumería ',
  logo_media_id: '',
  favicon_media_id: '',
};

describe('normalizarHex y alcance', () => {
  it('normaliza a 6 dígitos en mayúscula y rechaza lo que no es hex', () => {
    expect(normalizarHex('#abc')).toBe('#AABBCC');
    expect(normalizarHex(' #382e2b ')).toBe('#382E2B');
    for (const malo of ['382E2B', '#12345', 'rgb(1,2,3)', 'red', '#GGGGGG', '']) expect(normalizarHex(malo), malo).toBeNull();
  });

  it('el alcance por defecto es el global', () => {
    expect(leerAlcance(undefined)).toBe('global');
    expect(leerAlcance('ec')).toBe('EC');
    expect(leerAlcance('MX')).toBe('global');
  });
});

describe('esquemaApariencia (global)', () => {
  it('normaliza colores y números', () => {
    const d = esquemaApariencia('global').parse(COMPLETO);
    expect(d.colores).toMatchObject({ bg: '#FDFBF7', ink: '#382E2B', 'ink-hover': '#4A3D39' });
    expect(d.tipografia).toEqual({ pair: 2, heading_font: 'Playfair Display', body_font: 'Jost', base_size_px: 17, heading_weight: 600, heading_letter_spacing: '0.02em', label_letter_spacing: '0.14em' });
    expect(d.store_name).toBe('Izao Perfumería');
    expect(d.acepto_contraste).toBe(false);
    expect(d.logo_media_id).toBeNull();
  });

  it('exige todos los colores y rechaza valores fuera de rango', () => {
    const s = esquemaApariencia('global');
    expect(s.safeParse({ ...COMPLETO, color_bg: '' }).success).toBe(false);
    expect(s.safeParse({ ...COMPLETO, color_bg: 'blanco' }).success).toBe(false);
    expect(s.safeParse({ ...COMPLETO, pair: '7' }).success).toBe(false);
    expect(s.safeParse({ ...COMPLETO, base_size_px: '19' }).success).toBe(false);
    expect(s.safeParse({ ...COMPLETO, base_size_px: '14' }).success).toBe(false);
    expect(s.safeParse({ ...COMPLETO, heading_weight: '550' }).success).toBe(false);
    expect(s.safeParse({ ...COMPLETO, heading_letter_spacing: '2px' }).success).toBe(false);
    expect(s.safeParse({ ...COMPLETO, logo_media_id: 'no-uuid' }).success).toBe(false);
  });
});

describe('esquemaApariencia (país)', () => {
  const vacio = Object.fromEntries(Object.keys(COMPLETO).map((k) => [k, ''])) as Record<string, string>;

  it('todo vacío = hereda todo', () => {
    const d = esquemaApariencia('EC').parse(vacio);
    expect(Object.values(d.colores).every((v) => v === null)).toBe(true);
    expect(Object.values(d.tipografia).every((v) => v === null)).toBe(true);
    expect(tokensDePais(d)).toEqual({});
  });

  it('solo se guarda lo que el país cambia, y lo inválido sigue fallando', () => {
    const d = esquemaApariencia('EC').parse({ ...vacio, color_accent: '#abc', pair: '4' });
    expect(tokensDePais(d)).toEqual({ 'color-accent': '#AABBCC', typography: { pair: 4, heading_font: 'Libre Caslon Display', body_font: 'Karla' } });
    expect(esquemaApariencia('EC').safeParse({ ...vacio, color_accent: 'x' }).success).toBe(false);
  });
});

describe('qué se guarda', () => {
  it('tokensGlobales conserva las claves ajenas y normaliza las del formulario', () => {
    const d = esquemaApariencia('global').parse(COMPLETO);
    const t = tokensGlobales({ 'color-line': 'rgba(0,0,0,0.1)', '--color-bg': '#000000', 'color-extra': '#111111' }, d.colores);
    expect(t['color-line']).toBe('rgba(0,0,0,0.1)');
    expect(t['color-extra']).toBe('#111111');
    expect(t['color-bg']).toBe('#FDFBF7');
    expect(t).not.toHaveProperty('--color-bg');
  });

  it('tipografiaGlobal fija la pareja con los nombres de sus fuentes', () => {
    const d = esquemaApariencia('global').parse(COMPLETO);
    expect(tipografiaGlobal({ otra: 1 }, d.tipografia)).toMatchObject({
      otra: 1,
      pair: 2,
      heading_font: 'Playfair Display',
      body_font: 'Jost',
      base_size_px: 17,
      heading_weight: 600,
    });
  });
});

describe('tipografías del catálogo', () => {
  const vacio = Object.fromEntries(Object.keys(COMPLETO).map((k) => [k, ''])) as Record<string, string>;
  const SIN_PAREJA = { ...COMPLETO, pair: '', heading_font: 'Prata', body_font: 'Figtree' };

  it('elegir dos fuentes del catálogo las guarda y no inventa una pareja', () => {
    const d = esquemaApariencia('global').parse(SIN_PAREJA);
    expect(d.tipografia).toMatchObject({ pair: null, heading_font: 'Prata', body_font: 'Figtree' });
    expect(tipografiaGlobal({ pair: 3, otra: 1 }, d.tipografia)).toMatchObject({ pair: 3, otra: 1, heading_font: 'Prata', body_font: 'Figtree' });
  });

  it('si las dos fuentes forman una pareja curada se guarda su número', () => {
    const d = esquemaApariencia('global').parse({ ...COMPLETO, pair: '', heading_font: 'Fraunces', body_font: 'Inter Tight' });
    expect(d.tipografia.pair).toBe(3);
  });

  it('rechaza fuentes fuera del catálogo (nada de nombres libres hacia la tienda)', () => {
    const s = esquemaApariencia('global');
    expect(s.safeParse({ ...SIN_PAREJA, heading_font: 'Comic Sans MS' }).success).toBe(false);
    expect(s.safeParse({ ...SIN_PAREJA, body_font: "x'; } body{display:none" }).success).toBe(false);
  });

  it('en el global ambas fuentes son obligatorias; en un país se hereda lo vacío', () => {
    expect(esquemaApariencia('global').safeParse({ ...COMPLETO, pair: '', heading_font: '', body_font: '' }).success).toBe(false);
    expect(esquemaApariencia('global').safeParse({ ...COMPLETO, pair: '', heading_font: 'Prata', body_font: '' }).success).toBe(false);
    const d = esquemaApariencia('EC').parse({ ...vacio, heading_font: 'Prata' });
    expect(tokensDePais(d)).toEqual({ typography: { heading_font: 'Prata' } });
  });
});

describe('contraste', () => {
  it('la paleta por defecto no tiene fallos graves y advierte del texto secundario', () => {
    const r = contrastesDe({ ...COLORES_POR_DEFECTO });
    expect(fallosGraves(r)).toEqual([]);
    expect(r.find((x) => x.descripcion.startsWith('Texto secundario'))?.advertencia).toBe(true);
  });

  it('un texto claro sobre fondo claro es un fallo grave', () => {
    const efectivos = coloresEfectivos(null, { ink: '#E0D8CC' });
    const graves = fallosGraves(contrastesDe(efectivos));
    expect(graves.length).toBeGreaterThan(0);
    expect(graves.every((g) => g.uso === 'cuerpo' && !g.cumple)).toBe(true);
  });

  it('los colores del país se montan sobre los del sitio', () => {
    const e = coloresEfectivos({ 'color-bg': '#FFFFFF' }, { accent: '#112233', ink: null });
    expect(e.bg).toBe('#FFFFFF');
    expect(e.accent).toBe('#112233');
    expect(e.ink).toBe(COLORES_POR_DEFECTO.ink);
  });
});
