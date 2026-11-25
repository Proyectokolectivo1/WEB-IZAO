import { describe, expect, it, vi } from 'vitest';
import {
  eventoAgregado,
  eventoCompra,
  eventoInicioCheckout,
  pixelActivo,
  rastrear,
  rastrearCompraUnaVez,
  type DatosCompra,
  type VentanaPixel,
} from './pixel-cliente';

function ventana(id: string | null = '111111111111111') {
  const fbq = vi.fn();
  const w: VentanaPixel = { fbq, ...(id ? { __izaoPixelId: id } : {}) };
  return { w, fbq };
}

function almacen() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

const COMPRA_CO: DatosCompra = { numero: 'IZ-CO-000123', total: '99000', lineas: [{ contentId: 'SKU-1', cantidad: 1, precio: '90000' }] };

describe('eventos del navegador', () => {
  it('sin Pixel en la página no hace nada', () => {
    expect(rastrear('AddToCart', {}, undefined, {})).toBe(false);
    expect(rastrear('AddToCart', {}, undefined, null)).toBe(false);
    const { w, fbq } = ventana(null);
    expect(rastrear('AddToCart', {}, undefined, w)).toBe(false);
    expect(fbq).not.toHaveBeenCalled();
  });

  it('envía con trackSingle al Pixel de la página y eventID cuando lo hay', () => {
    const { w, fbq } = ventana();
    rastrear('ViewContent', { value: 1 }, undefined, w);
    rastrear('Purchase', { value: 2 }, 'purchase_X', w);
    expect(fbq).toHaveBeenNthCalledWith(1, 'trackSingle', '111111111111111', 'ViewContent', { value: 1 });
    expect(fbq).toHaveBeenNthCalledWith(2, 'trackSingle', '111111111111111', 'Purchase', { value: 2 }, { eventID: 'purchase_X' });
  });

  it('pixelActivo compara con el id del documento', () => {
    expect(pixelActivo('111111111111111', ventana().w)).toBe(true);
    expect(pixelActivo('222222222222222', ventana().w)).toBe(false);
  });

  it('si fbq lanza, no rompe la compra', () => {
    const w: VentanaPixel = {
      fbq: () => {
        throw new Error('x');
      },
      __izaoPixelId: '111111111111111',
    };
    expect(rastrear('AddToCart', {}, undefined, w)).toBe(false);
  });
});

describe('montos y contenido', () => {
  it('AddToCart en COP: valor = precio por cantidad, SKU como content_id', () => {
    const p = eventoAgregado({ variantId: 'v1', sku: 'SKU-1', cantidad: 2, precio: '90000', nombre: 'Aroma' }, 'co');
    expect(p).toMatchObject({ value: 180000, currency: 'COP', content_ids: ['SKU-1'], num_items: 2, content_name: 'Aroma' });
  });

  it('AddToCart en USD: de centavos a decimal', () => {
    const p = eventoAgregado({ variantId: 'v1', sku: null, cantidad: 3, precio: '4990', nombre: 'Aroma' }, 'ec');
    expect(p).toMatchObject({ value: 149.7, currency: 'USD', content_ids: ['v1'] });
  });

  it('InitiateCheckout suma todas las líneas', () => {
    const p = eventoInicioCheckout(
      [
        { variantId: 'a', sku: 'A', cantidad: 1, precio: '1000' },
        { variantId: 'b', sku: 'B', cantidad: 2, precio: '2500' },
      ],
      'co',
    );
    expect(p.value).toBe(6000);
    expect(p.content_ids).toEqual(['A', 'B']);
  });

  it('Purchase usa el total del pedido y un eventID determinista', () => {
    const e = eventoCompra(COMPRA_CO, 'co');
    expect(e.eventId).toBe('purchase_IZ-CO-000123');
    expect(e.parametros.value).toBe(99000);
    expect(e.parametros.currency).toBe('COP');
    const usd = eventoCompra({ numero: 'IZ-EC-000001', total: '9982', lineas: [{ contentId: 'S', cantidad: 1, precio: '9982' }] }, 'ec');
    expect(usd.parametros.value).toBe(99.82);
  });
});

describe('Purchase único por pedido', () => {
  it('se envía una vez y las recargas no lo repiten', () => {
    const { w, fbq } = ventana();
    const a = almacen();
    expect(rastrearCompraUnaVez(COMPRA_CO, 'co', { w, almacen: a })).toBe('enviado');
    expect(rastrearCompraUnaVez(COMPRA_CO, 'co', { w, almacen: a })).toBe('repetido');
    expect(rastrearCompraUnaVez(COMPRA_CO, 'co', { w, almacen: a })).toBe('repetido');
    expect(fbq).toHaveBeenCalledTimes(1);
    expect(fbq).toHaveBeenCalledWith(
      'trackSingle',
      '111111111111111',
      'Purchase',
      expect.objectContaining({ value: 99000, currency: 'COP' }),
      { eventID: 'purchase_IZ-CO-000123' },
    );
  });

  it('otro pedido sí se envía', () => {
    const { w, fbq } = ventana();
    const a = almacen();
    rastrearCompraUnaVez(COMPRA_CO, 'co', { w, almacen: a });
    rastrearCompraUnaVez({ ...COMPRA_CO, numero: 'IZ-CO-000124' }, 'co', { w, almacen: a });
    expect(fbq).toHaveBeenCalledTimes(2);
  });

  it('sin Pixel no marca el pedido (si luego hay Pixel, se enviará)', () => {
    const a = almacen();
    expect(rastrearCompraUnaVez(COMPRA_CO, 'co', { w: {}, almacen: a })).toBe('sin_pixel');
    expect(a.m.size).toBe(0);
  });

  it('con el almacenamiento bloqueado envía igual (Meta deduplica por eventID)', () => {
    const { w, fbq } = ventana();
    const roto = {
      getItem: () => {
        throw new Error('bloqueado');
      },
      setItem: () => {
        throw new Error('bloqueado');
      },
    };
    expect(rastrearCompraUnaVez(COMPRA_CO, 'co', { w, almacen: roto })).toBe('enviado');
    expect(fbq).toHaveBeenCalledTimes(1);
  });
});
