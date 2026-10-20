import { describe, expect, it } from 'vitest';
import {
  agregarLinea,
  cambiarCantidad,
  contarUnidades,
  leer,
  quitarLinea,
  serializar,
  vistaPrevia,
  type LineaCarrito,
} from './logica';

const linea = (o: Partial<LineaCarrito> = {}): LineaCarrito => ({
  variantId: 'v1',
  productId: 'p1',
  slug: 'noche',
  nombre: 'Noche',
  presentacion: '100 ml',
  cantidad: 1,
  precio: '150000',
  tachado: null,
  max: 3,
  imagen: null,
  ...o,
});

describe('carrito', () => {
  it('suma cantidades de la misma variante y respeta el tope', () => {
    let l = agregarLinea([], linea({ cantidad: 2 }));
    l = agregarLinea(l, linea({ cantidad: 5 }));
    expect(l).toHaveLength(1);
    expect(l[0]!.cantidad).toBe(3);
    expect(contarUnidades(l)).toBe(3);
  });

  it('cantidad 0 quita la línea; no pasa del máximo', () => {
    const l = [linea({ cantidad: 2 })];
    expect(cambiarCantidad(l, 'v1', 0)).toEqual([]);
    expect(cambiarCantidad(l, 'v1', 99)[0]!.cantidad).toBe(3);
    expect(quitarLinea(l, 'v1')).toEqual([]);
  });

  it('ida y vuelta por localStorage y descarta basura sin lanzar', () => {
    const l = [linea(), linea({ variantId: 'v2', precio: '99000', tachado: '120000' })];
    expect(leer(serializar(l))).toEqual(l);
    expect(leer(null)).toEqual([]);
    expect(leer('{no es json')).toEqual([]);
    expect(leer(JSON.stringify({ v: 99, lineas: l }))).toEqual([]);
    const sucio = JSON.stringify({ v: 1, lineas: [{ ...linea(), precio: '12.5' }, { ...linea({ variantId: 'v3' }), cantidad: 99 }, null, 7] });
    const r = leer(sucio);
    expect(r).toHaveLength(1);
    expect(r[0]!.cantidad).toBe(3);
  });

  it('subtotal de vista previa con el motor de precios, en unidad menor y sin floats', () => {
    const l = [linea({ cantidad: 2, precio: '149900', tachado: '199900' }), linea({ variantId: 'v2', precio: '89900' })];
    const v = vistaPrevia(l, 'co', new Date('2026-10-20T00:00:00Z'));
    expect(v.subtotal).toBe(149900n * 2n + 89900n);
    expect(v.ahorro).toBe(50000n * 2n);
  });

  it('Ecuador en centavos', () => {
    const v = vistaPrevia([linea({ precio: '4990', cantidad: 3 })], 'ec', new Date());
    expect(v.subtotal).toBe(14970n);
  });

  it('carrito vacío vale cero', () => {
    expect(vistaPrevia([], 'co', new Date())).toEqual({ subtotal: 0n, ahorro: 0n });
  });
});
