import { MasterShopClient, sqlVinculacion } from '@izao/mastershop';
import { FakeClock, MasterShopMock } from '@izao/mastershop/mock';
import { describe, expect, it } from 'vitest';
import { fetchFalso } from '../fetch-falso.js';
import { aVarianteIzao, crearFuenteVinculacionPostgrest, vistaPreviaVinculacion } from './vinculacion-productos.js';

const LLAVE = 'llave-de-prueba-vinculacion';
const UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('aVarianteIzao', () => {
  it('toma el nombre del producto y descarta IDs inválidos', () => {
    expect(
      aVarianteIzao({ id: UUID(1), sku: 'IZ-1', products: { name: 'Uno' }, mastershop_product_id: 0, mastershop_variant_id: null }),
    ).toEqual({ variant_id: UUID(1), sku: 'IZ-1', product_name: 'Uno', mastershop_product_id: null, mastershop_variant_id: null });
  });
});

describe('crearFuenteVinculacionPostgrest', () => {
  it('pagina las variantes en lotes de 500 y solo hace GET', async () => {
    const total = 1030;
    const { f, llamadas } = fetchFalso((l) => {
      const offset = Number(/offset=(\d+)/.exec(l.url)?.[1] ?? '0');
      const n = Math.max(0, Math.min(500, total - offset));
      return {
        status: 200,
        cuerpo: Array.from({ length: n }, (_, i) => ({
          id: UUID(offset + i),
          sku: `IZ-${offset + i}`,
          products: { name: 'X' },
          mastershop_product_id: null,
          mastershop_variant_id: null,
        })),
      };
    });
    const fuente = crearFuenteVinculacionPostgrest({ supabaseUrl: 'https://db.test', secretKey: 's', claveCifrado: 'k', fetchImpl: f });
    expect(await fuente.variantes()).toHaveLength(total);
    expect(llamadas).toHaveLength(3);
    expect(llamadas.every((l) => l.metodo === 'GET')).toBe(true);
  });
});

describe('vistaPreviaVinculacion contra el mock', () => {
  it('empareja por SKU sin escribir nada en MasterShop', async () => {
    const clock = new FakeClock();
    const mock = new MasterShopMock({ apiKey: LLAVE, clock });
    mock.seedProduct({ idProduct: 249511, name: 'ONE MILLION LUCKY 100ML', basePrice: 89000, variants: [{ idVariant: 697831, sku: 'IZAO-MEN-035' }] });
    mock.seedProduct({ idProduct: 249510, name: 'Otro', basePrice: 128000, variants: [{ idVariant: 697830, sku: 'IZ-0002-50' }] });

    const { vista } = await vistaPreviaVinculacion({
      fuente: {
        credenciales: async () => ({ apiKey: LLAVE }),
        variantes: async () => [
          { variant_id: UUID(1), sku: 'IZ-0001-100', product_name: 'One Million Lucky', mastershop_product_id: null, mastershop_variant_id: null },
          { variant_id: UUID(2), sku: 'IZ-0002-50', product_name: 'Dos', mastershop_product_id: null, mastershop_variant_id: null },
        ],
      },
      crearCliente: (c) => new MasterShopClient({ apiKey: c.apiKey, fetch: mock.fetch, clock }),
    });

    expect(vista.nuevas.map((e) => [e.sku, e.propuesto.idVariant])).toEqual([['IZ-0002-50', 697830]]);
    expect(vista.sinEquivalente.map((e) => e.sku)).toEqual(['IZ-0001-100']);
    expect(vista.sugerenciasPorNombre[0]?.candidato.idVariant).toBe(697831);
    expect(sqlVinculacion(vista, new Date(0))).toContain(`('${UUID(2)}'::uuid, 'IZ-0002-50', 249510, 697830)`);
    expect(mock.requests.every((r) => r.method === 'GET')).toBe(true);
    expect(mock.orders.size).toBe(0);
  });

  it('falla sin credencial', async () => {
    await expect(
      vistaPreviaVinculacion({ fuente: { credenciales: async () => null, variantes: async () => [] } }),
    ).rejects.toThrow(/credencial/);
  });
});
