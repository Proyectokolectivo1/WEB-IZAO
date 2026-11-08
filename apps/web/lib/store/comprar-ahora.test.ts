import { describe, expect, it } from 'vitest';
import { agregarLinea, rutaCheckout, type LineaCarrito } from './carrito/logica';
import { varianteDirecta } from './ficha-util';
import { T } from './textos';
import type { VarianteProducto } from './types';

const variante = (o: Partial<VarianteProducto> = {}): VarianteProducto => ({
  id: 'v1',
  sku: 'SKU-1',
  is_default: true,
  option_value_ids: [],
  price: 150000,
  compare_at_price: null,
  stock_disponible: 4,
  in_stock: true,
  stock_bajo: false,
  image: null,
  ...o,
});

const linea = (o: Partial<LineaCarrito> = {}): LineaCarrito => ({
  variantId: 'v1',
  productId: 'p1',
  slug: 'noche',
  nombre: 'Noche',
  presentacion: '100 ml',
  cantidad: 1,
  precio: '150000',
  tachado: null,
  max: 4,
  imagen: null,
  ...o,
});

describe('Comprar ahora', () => {
  it('va al checkout del país', () => {
    expect(rutaCheckout('co')).toBe('/co/checkout');
    expect(rutaCheckout('ec')).toBe('/ec/checkout');
  });

  it('desde la tarjeta solo compra directo con una única presentación disponible', () => {
    expect(varianteDirecta([variante()])?.id).toBe('v1');
  });

  it('con varias presentaciones no elige por la persona', () => {
    expect(varianteDirecta([variante(), variante({ id: 'v2', is_default: false })])).toBeNull();
    // Aunque solo una tenga existencias: sigue habiendo una elección que mostrar.
    expect(varianteDirecta([variante({ in_stock: false }), variante({ id: 'v2' })])).toBeNull();
  });

  it('sin existencias o sin variantes no hay compra directa', () => {
    expect(varianteDirecta([variante({ in_stock: false, stock_disponible: 0 })])).toBeNull();
    expect(varianteDirecta([])).toBeNull();
  });

  it('suma al bolso con la misma acción que «Agregar» (una línea por presentación, con tope)', () => {
    let l = agregarLinea([], linea({ cantidad: 2 }));
    l = agregarLinea(l, linea({ cantidad: 1 }));
    expect(l).toHaveLength(1);
    expect(l[0]!.cantidad).toBe(3);
  });

  it('los textos están en el diccionario y son distintos entre sí', () => {
    expect(T.tarjeta.agregar).toBe('Agregar al bolso');
    expect(T.tarjeta.comprarAhora).toBe('Comprar ahora');
    expect(T.ficha.comprarAhora).toBe(T.tarjeta.comprarAhora);
    expect(T.tarjeta.comprarAhoraDe('Noche')).toContain('Noche');
  });
});
