import { describe, expect, it } from 'vitest';
import { CARRUSEL_SEGUNDOS, carruselEnCatalogo, enlaceBanner, segundosCarrusel } from './banners';

describe('ajustes del carrusel (los fija el panel)', () => {
  it('lee interval_seconds de la configuración y lo acota a 3–30 s', () => {
    expect(segundosCarrusel({ interval_seconds: 8 })).toBe(8);
    expect(segundosCarrusel({ interval_seconds: '12' })).toBe(12);
    expect(segundosCarrusel({ interval_seconds: 1 })).toBe(CARRUSEL_SEGUNDOS.minimo);
    expect(segundosCarrusel({ interval_seconds: 600 })).toBe(CARRUSEL_SEGUNDOS.maximo);
    expect(segundosCarrusel({ interval_seconds: 4.6 })).toBe(5);
  });

  it('sin dato o con basura usa el valor de la semilla', () => {
    for (const c of [null, undefined, {}, { interval_seconds: 'rápido' }, { interval_seconds: Number.NaN }, { interval_seconds: '' }]) {
      expect(segundosCarrusel(c)).toBe(CARRUSEL_SEGUNDOS.defecto);
    }
  });

  it('el catálogo muestra el carrusel salvo que el panel lo apague', () => {
    expect(carruselEnCatalogo(null)).toBe(true);
    expect(carruselEnCatalogo({})).toBe(true);
    expect(carruselEnCatalogo({ show_in_catalog: true })).toBe(true);
    expect(carruselEnCatalogo({ show_in_catalog: false })).toBe(false);
  });

  it('un ancla de sección se sigue como ruta del país; lo peligroso se descarta', () => {
    expect(enlaceBanner('/co#seccion-reviews', 'co')).toBe('/co#seccion-reviews');
    expect(enlaceBanner('/co/catalogo#productos', 'co')).toBe('/co/catalogo#productos');
    expect(enlaceBanner('/ec#seccion-reviews', 'co')).toBeNull();
    expect(enlaceBanner('javascript:alert(1)', 'co')).toBeNull();
    expect(enlaceBanner('data:text/html,x', 'co')).toBeNull();
    expect(enlaceBanner('http://sitio.com', 'co')).toBeNull();
  });
});
