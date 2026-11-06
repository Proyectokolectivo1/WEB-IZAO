import { describe, expect, it } from 'vitest';
import { esquemaSubida } from './esquema';

describe('esquemaSubida', () => {
  it('el alt es obligatorio', () => {
    expect(esquemaSubida.safeParse({ kind: 'product', alt: '' }).success).toBe(false);
    expect(esquemaSubida.safeParse({ kind: 'product', alt: '  ab ' }).success).toBe(false);
    expect(esquemaSubida.safeParse({ kind: 'product' }).success).toBe(false);
  });

  it('solo admite los tipos de la tabla media', () => {
    expect(esquemaSubida.safeParse({ kind: 'avatar', alt: 'Frasco' }).success).toBe(false);
    expect(esquemaSubida.safeParse({ kind: 'banner', alt: 'Frasco sobre mármol' }).success).toBe(true);
  });

  it('la variante de banner admite la imagen única y los conjuntos antiguos', () => {
    expect(esquemaSubida.parse({ kind: 'banner', alt: 'Frasco', variante: 'unica' }).variante).toBe('unica');
    expect(esquemaSubida.parse({ kind: 'banner', alt: 'Frasco', variante: 'movil' }).variante).toBe('movil');
    expect(esquemaSubida.parse({ kind: 'banner', alt: 'Frasco', variante: '' }).variante).toBeUndefined();
    expect(esquemaSubida.safeParse({ kind: 'banner', alt: 'Frasco', variante: 'tablet' }).success).toBe(false);
  });

  it('recorte45 se interpreta desde el formulario', () => {
    expect(esquemaSubida.parse({ kind: 'product', alt: 'Frasco', recorte45: 'true' }).recorte45).toBe(true);
    expect(esquemaSubida.parse({ kind: 'product', alt: 'Frasco' }).recorte45).toBe(false);
  });
});
