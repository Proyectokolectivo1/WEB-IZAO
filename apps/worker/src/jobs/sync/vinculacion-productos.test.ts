import { emparejarPorSku, MasterShopClient, sqlVinculacion, type VarianteIzao } from '@izao/mastershop';
import { FakeClock, MasterShopMock } from '@izao/mastershop/mock';
import { describe, expect, it } from 'vitest';
import { fetchFalso } from '../fetch-falso.js';
import {
  aVarianteIzao,
  crearFuenteVinculacionPostgrest,
  vinculacionPorPais,
  vistaPreviaVinculacion,
  type DepsVinculacion,
} from './vinculacion-productos.js';

const LLAVE = 'llave-de-prueba-vinculacion';
const LLAVE_EC = 'llave-de-prueba-vinculacion-ec';
const UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OPC = { supabaseUrl: 'https://db.test', secretKey: 's', claveCifrado: 'k' };
const libre = (n: number, sku: string, nombre = 'X'): VarianteIzao => ({
  variant_id: UUID(n),
  sku,
  product_name: nombre,
  mastershop_product_id: null,
  mastershop_variant_id: null,
});

describe('aVarianteIzao', () => {
  it('lee la fila de variant_countries con el SKU y el nombre embebidos, y descarta IDs inválidos', () => {
    expect(
      aVarianteIzao({ variant_id: UUID(1), mastershop_product_id: 0, mastershop_variant_id: null, product_variants: { sku: 'IZ-1', products: { name: 'Uno' } } }),
    ).toEqual({ variant_id: UUID(1), sku: 'IZ-1', product_name: 'Uno', mastershop_product_id: null, mastershop_variant_id: null });
  });
});

describe('crearFuenteVinculacionPostgrest (D-052)', () => {
  it('lee variant_countries del país, paginando en lotes de 500, solo con GET', async () => {
    const total = 1030;
    const { f, llamadas } = fetchFalso((l) => {
      const offset = Number(/offset=(\d+)/.exec(l.url)?.[1] ?? '0');
      const n = Math.max(0, Math.min(500, total - offset));
      return {
        status: 200,
        cuerpo: Array.from({ length: n }, (_, i) => ({
          variant_id: UUID(offset + i),
          mastershop_product_id: null,
          mastershop_variant_id: null,
          product_variants: { sku: `IZ-${offset + i}`, products: { name: 'X' } },
        })),
      };
    });
    const fuente = crearFuenteVinculacionPostgrest({ ...OPC, fetchImpl: f });
    expect(await fuente.variantes('EC')).toHaveLength(total);
    expect(llamadas).toHaveLength(3);
    expect(llamadas.every((l) => l.metodo === 'GET')).toBe(true);
    expect(llamadas.every((l) => l.url.includes('/variant_countries?country_code=eq.EC&'))).toBe(true);
    expect(llamadas.some((l) => l.url.includes('/product_variants?'))).toBe(false);
  });

  it('ignora los productos archivados: la consulta los excluye (D-055)', async () => {
    const { f, llamadas } = fetchFalso(() => ({ status: 200, cuerpo: [] }));
    await crearFuenteVinculacionPostgrest({ ...OPC, fetchImpl: f }).variantes('CO');
    const url = decodeURIComponent(llamadas[0]!.url);
    expect(url).toContain('products!inner(name,status)');
    expect(url).toContain('product_variants.products.status=neq.archived');
  });

  it('la llave es la del país', async () => {
    const { f, llamadas } = fetchFalso(() => ({ status: 200, cuerpo: [] }));
    expect(await crearFuenteVinculacionPostgrest({ ...OPC, fetchImpl: f }).credenciales('EC')).toBeNull();
    expect(llamadas[0]!.url).toContain('integration_credentials?provider=eq.mastershop&country_code=eq.EC');
  });

  it('escribe solo filas del país sin vínculo y nunca product_variants', async () => {
    const { f, llamadas } = fetchFalso((l) => ({ status: 200, cuerpo: l.url.includes(UUID(1)) ? [{ variant_id: UUID(1) }] : [] }));
    const fuente = crearFuenteVinculacionPostgrest({ ...OPC, fetchImpl: f });
    const vista = emparejarPorSku(
      [libre(1, 'A'), libre(2, 'B')],
      [
        {
          idProduct: 10,
          name: 'Diez',
          variants: [100, 101].map((idVariant, i) => ({ idProduct: 10, idVariant, sku: i === 0 ? 'A' : 'B', name: null, enabled: true, price: null, stock: null })),
        },
      ] as never,
    );
    expect(await fuente.guardarVinculos('EC', vista.nuevas)).toBe(1);
    expect(llamadas.map((l) => l.metodo)).toEqual(['PATCH', 'PATCH']);
    expect(llamadas[0]!.url).toContain(`variant_countries?variant_id=eq.${UUID(1)}&country_code=eq.EC&mastershop_product_id=is.null&mastershop_variant_id=is.null`);
    expect(llamadas[0]!.cuerpo).toEqual({ mastershop_product_id: 10, mastershop_variant_id: 100 });
    expect(llamadas.some((l) => l.url.includes('product_variants'))).toBe(false);
  });
});

describe('vinculación contra el mock (cada país con su cuenta)', () => {
  function cuentas() {
    const clock = new FakeClock();
    const co = new MasterShopMock({ apiKey: LLAVE, clock });
    co.seedProduct({ idProduct: 249511, name: 'ONE MILLION LUCKY 100ML', basePrice: 89000, variants: [{ idVariant: 697831, sku: 'IZAO-MEN-035' }] });
    co.seedProduct({ idProduct: 249510, name: 'Otro', basePrice: 128000, variants: [{ idVariant: 697830, sku: 'IZ-0002-50' }] });
    const ec = new MasterShopMock({ apiKey: LLAVE_EC, clock, currency: 'USD' });
    ec.seedProduct({ idProduct: 880001, name: 'Otro EC', basePrice: 49, variants: [{ idVariant: 990001, sku: 'IZ-0002-50' }] });
    const crearCliente: DepsVinculacion['crearCliente'] = (c, pais) =>
      new MasterShopClient({ apiKey: c.apiKey, fetch: (pais === 'EC' ? ec : co).fetch, clock, currency: pais === 'EC' ? 'USD' : 'COP' });
    return { co, ec, crearCliente };
  }

  it('empareja por SKU sin escribir nada en MasterShop', async () => {
    const { co, crearCliente } = cuentas();
    const { vista } = await vistaPreviaVinculacion({
      fuente: {
        credenciales: async () => ({ apiKey: LLAVE }),
        variantes: async () => [libre(1, 'IZ-0001-100', 'One Million Lucky'), libre(2, 'IZ-0002-50', 'Dos')],
      },
      crearCliente,
    });
    expect(vista.nuevas.map((e) => [e.sku, e.propuesto.idVariant])).toEqual([['IZ-0002-50', 697830]]);
    expect(vista.sinEquivalente.map((e) => e.sku)).toEqual(['IZ-0001-100']);
    expect(vista.sugerenciasPorNombre[0]?.candidato.idVariant).toBe(697831);
    expect(sqlVinculacion(vista, new Date(0))).toContain(`('${UUID(2)}'::uuid, 'IZ-0002-50', 249510, 697830)`);
    expect(co.requests.every((r) => r.method === 'GET')).toBe(true);
    expect(co.orders.size).toBe(0);
  });

  it('CO y EC con su propia llave e ids; aplicar escribe cada país en su fila', async () => {
    const { co, ec, crearCliente } = cuentas();
    const escritos: { pais: string; ids: number[] }[] = [];
    const vistas: string[] = [];
    const r = await vinculacionPorPais(
      {
        fuente: {
          credenciales: async (pais) => ({ apiKey: pais === 'EC' ? LLAVE_EC : LLAVE }),
          variantes: async (pais) => {
            vistas.push(pais);
            return [libre(2, 'IZ-0002-50')];
          },
          guardarVinculos: async (pais, nuevas) => {
            escritos.push({ pais, ids: nuevas.map((e) => e.propuesto.idVariant) });
            return nuevas.length;
          },
        },
        crearCliente,
      },
      { paises: ['CO', 'EC'], aplicar: true },
    );
    expect(r.CO).toMatchObject({ accion: 'aplicado', vinculadas: 1 });
    expect(r.EC).toMatchObject({ accion: 'aplicado', vinculadas: 1 });
    expect(escritos).toEqual([
      { pais: 'CO', ids: [697830] },
      { pais: 'EC', ids: [990001] },
    ]);
    expect(vistas).toEqual(['CO', 'EC']);
    expect(co.requests.every((q) => q.headers['ms-api-key'] === LLAVE)).toBe(true);
    expect(ec.requests.every((q) => q.headers['ms-api-key'] === LLAVE_EC)).toBe(true);
    expect(ec.requests.length).toBeGreaterThan(0);
  });

  it('un país sin llave o con error no frena al otro; sin aplicar no escribe', async () => {
    const { crearCliente } = cuentas();
    let escrituras = 0;
    const r = await vinculacionPorPais(
      {
        fuente: {
          credenciales: async (pais) => (pais === 'EC' ? null : { apiKey: LLAVE }),
          variantes: async () => [libre(2, 'IZ-0002-50')],
          guardarVinculos: async () => ++escrituras,
        },
        crearCliente,
      },
      { paises: ['EC', 'CO'] },
    );
    expect(r.EC).toEqual({ accion: 'sin_credenciales' });
    expect(r.CO).toMatchObject({ accion: 'vista_previa' });
    expect(escrituras).toBe(0);

    const conError = await vinculacionPorPais(
      {
        fuente: {
          credenciales: async (pais) => ({ apiKey: pais === 'EC' ? LLAVE_EC : LLAVE }),
          variantes: async (pais) => {
            if (pais === 'CO') throw new TypeError('caída');
            return [libre(2, 'IZ-0002-50')];
          },
        },
        crearCliente,
      },
      { paises: ['CO', 'EC'] },
    );
    expect(conError.CO).toEqual({ accion: 'error', error: 'TypeError' });
    expect(conError.EC).toMatchObject({ accion: 'vista_previa' });
  });

  it('vistaPreviaVinculacion falla sin credencial del país', async () => {
    await expect(
      vistaPreviaVinculacion({ fuente: { credenciales: async () => null, variantes: async () => [] } }, 'EC'),
    ).rejects.toThrow(/credencial activa de MasterShop para EC/);
  });
});
