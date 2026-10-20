import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  COLORES_POR_DEFECTO,
  combinacionesDeTexto,
  construirCssTema,
  evaluarContrastes,
  ratioContraste,
  resolverColores,
  resolverTipografia,
} from './index';

describe('contraste WCAG', () => {
  it('calcula la relación conocida negro/blanco = 21', () => {
    expect(ratioContraste('#000000', '#FFFFFF')).toBeCloseTo(21, 1);
  });

  const resultados = evaluarContrastes(combinacionesDeTexto({ ...COLORES_POR_DEFECTO }));
  const por = (desc: string) => resultados.find((r) => r.descripcion.startsWith(desc))!;

  it('todo el texto de cuerpo cumple AA (4.5:1)', () => {
    const cuerpo = resultados.filter((r) => r.uso === 'cuerpo');
    for (const r of cuerpo) expect(r.ratio, r.descripcion).toBeGreaterThanOrEqual(4.5);
  });

  it('muted solo sirve para texto grande: cumple 3:1 pero advierte bajo 4.5:1', () => {
    const r = por('Texto secundario');
    expect(r.cumple).toBe(true);
    expect(r.advertencia).toBe(true);
    expect(r.ratio).toBeLessThan(4.5);
  });

  it('accent nunca es texto: es decorativo y queda bajo 3:1 con el fondo', () => {
    const r = por('Acento sobre fondo');
    expect(r.advertencia).toBe(true);
    expect(r.ratio).toBeLessThan(3);
  });
});

describe('resolver y construir el tema', () => {
  it('sin datos usa los valores por defecto', () => {
    const css = construirCssTema(resolverColores(), resolverTipografia());
    expect(css).toContain('--color-bg:#FDFBF7');
    expect(css).toContain('--tema-base:16px');
    expect(css).toContain('--font-par1-titulos');
  });

  it('aplica capas en orden: defecto < global < país, con claves del seed', () => {
    const c = resolverColores({ 'color-bg': '#ffffff', '--color-ink': '#111111' }, { 'color-bg': '#EEEEEE' });
    expect(c.colores.bg).toBe('#EEEEEE');
    expect(c.colores.ink).toBe('#111111');
    expect(c.colores.surface).toBe(COLORES_POR_DEFECTO.surface);
  });

  it('ignora valores peligrosos o inválidos (sin inyección de CSS)', () => {
    const c = resolverColores({
      'color-bg': 'red;}body{display:none',
      'color-ink': 'url(x)',
      'color-line': 'rgba(56, 46, 43, 0.12)',
    });
    expect(c.colores.bg).toBe(COLORES_POR_DEFECTO.bg);
    expect(c.colores.ink).toBe(COLORES_POR_DEFECTO.ink);
    expect(c.linea).toBe('rgba(56, 46, 43, 0.12)');
    const css = construirCssTema(c, resolverTipografia());
    expect(css).not.toContain('display:none');
  });

  it('acota la escala base a 15–18 px y valida la pareja', () => {
    expect(resolverTipografia({ base_size_px: 30 }).baseSizePx).toBe(18);
    expect(resolverTipografia({ base_size_px: 10 }).baseSizePx).toBe(15);
    expect(resolverTipografia({ pair: 9 }).par).toBe(1);
    expect(resolverTipografia({ pair: 4 }).par).toBe(4);
    expect(resolverTipografia({ pair: 1 }, { pair: 6, heading_weight: 640 }).pesoTitulos).toBe(600);
  });
});

describe('tokens.css', () => {
  it('repite exactamente los colores por defecto', () => {
    const css = readFileSync(fileURLToPath(new URL('../tokens.css', import.meta.url)), 'utf8');
    for (const [k, v] of Object.entries(COLORES_POR_DEFECTO)) {
      expect(css, k).toMatch(new RegExp(`--color-${k}:\\s*${v};`, 'i'));
    }
  });
});
