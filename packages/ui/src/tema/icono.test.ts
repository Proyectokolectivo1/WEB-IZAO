import { describe, expect, it } from 'vitest';
import { COLORES_POR_DEFECTO } from './defaults';
import { construirIconoPorDefecto } from './icono';

describe('construirIconoPorDefecto', () => {
  it('es un SVG válido con los colores del tema por defecto y sin texto de terceros', () => {
    const svg = construirIconoPorDefecto();
    expect(svg.startsWith('<svg ')).toBe(true);
    expect(svg).toContain(COLORES_POR_DEFECTO.ink);
    expect(svg).toContain(COLORES_POR_DEFECTO.bg);
    expect(svg).not.toMatch(/<script|<image|href=/i);
  });
});
