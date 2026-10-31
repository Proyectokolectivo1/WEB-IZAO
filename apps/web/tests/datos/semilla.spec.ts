/**
 * Convención de datos (§30 F1: "con 400 productos por país de prueba"). Sin navegador.
 * Si estas cifras cambian, cambian los resultados esperados de todas las pruebas de catálogo.
 */
import { expect, test } from '@playwright/test';
import { MODO_EJEMPLO, VISIBLES_POR_PAIS } from '../support/entorno';
import { productosSemilla, visiblesEn, visiblesSoloEn } from '../support/semilla';

test.describe('datos de prueba del seed', () => {
  test('§30 F1 hay 520 productos y 400 visibles por país', () => {
    test.skip(MODO_EJEMPLO, 'con STORE_DATOS=ejemplo los datos son los de ejemplo de la tienda, no el seed de 520');
    expect(productosSemilla()).toHaveLength(520);
    expect(visiblesEn('co')).toHaveLength(VISIBLES_POR_PAIS);
    expect(visiblesEn('ec')).toHaveLength(VISIBLES_POR_PAIS);
  });

  test('§5.2 hay productos visibles en un país y ausentes en el otro (para probar la visibilidad)', () => {
    // Los datos de ejemplo de la tienda solo ocultan productos en EC; el seed los tiene exclusivos de cada país.
    if (!MODO_EJEMPLO) expect(visiblesSoloEn('ec', 'co').length).toBeGreaterThanOrEqual(1);
    expect(visiblesSoloEn('co', 'ec').length).toBeGreaterThanOrEqual(1);
  });

  test('los slugs son únicos y los borradores no son visibles en ningún país', () => {
    const slugs = productosSemilla().map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    const co = new Set(visiblesEn('co'));
    const ec = new Set(visiblesEn('ec'));
    for (const p of productosSemilla().filter((x) => x.status !== 'active')) {
      expect(co.has(p)).toBe(false);
      expect(ec.has(p)).toBe(false);
    }
  });

  test('§7.3 existen nombres con tilde para la búsqueda tolerante', () => {
    const conTilde = visiblesEn('co').filter((p) => /[áéíóúñ]/i.test(p.name));
    expect(conTilde.length).toBeGreaterThan(5);
  });
});
