import { describe, expect, it } from 'vitest';
import { MasterShopClient } from './client';
import { FakeClock } from './clock';
import { MasterShopMock } from './mock';
import {
  emparejarPorSku,
  normalizarNombre,
  normalizarSku,
  sqlVinculacion,
  type MasterShopProduct,
  type VarianteIzao,
} from './products';

const LLAVE = 'llave-de-prueba-productos';

function entorno() {
  const clock = new FakeClock();
  const mock = new MasterShopMock({ apiKey: LLAVE, clock });
  return { mock, client: new MasterShopClient({ apiKey: LLAVE, fetch: mock.fetch, clock }) };
}

const UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function izao(n: number, sku: string, extra: Partial<VarianteIzao> = {}): VarianteIzao {
  return {
    variant_id: UUID(n),
    sku,
    product_name: `Producto ${n}`,
    mastershop_product_id: null,
    mastershop_variant_id: null,
    ...extra,
  };
}

function ms(idProduct: number, name: string, variants: Array<[number, string | null, boolean?]>): MasterShopProduct {
  return {
    idProduct,
    name,
    state: 'Activo',
    basePrice: 100000,
    stockTotal: 10,
    variants: variants.map(([idVariant, sku, enabled]) => ({
      idProduct,
      idVariant,
      sku,
      name: 'Default Variant',
      enabled: enabled ?? true,
      price: 100000,
      stock: 10,
    })),
  };
}

describe('cliente: productos contra el mock', () => {
  it('pagina hasta una página vacía aunque limit se recorte a 50', async () => {
    const { mock, client } = entorno();
    for (let i = 1; i <= 120; i++) mock.seedProduct({ idProduct: i, name: `P ${i}`, basePrice: 1000, variants: [{ idVariant: 1000 + i, sku: `S-${i}` }] });
    const todos = await client.listAllProducts();
    expect(todos).toHaveLength(120);
    const paginas = mock.requests.filter((r) => r.path === '/api/products');
    expect(paginas).toHaveLength(4); // 50 + 50 + 20 + vacía
  });

  it('el listado no trae variantes: el detalle con includeAllVariations sí', async () => {
    const { mock, client } = entorno();
    mock.seedProduct({ idProduct: 7, name: 'Uno', basePrice: 89000, variants: [{ idVariant: 70, sku: 'IZAO-MEN-035' }] });
    const [resumen] = await client.listProducts({ page: 1 });
    expect(resumen).toMatchObject({ idProduct: 7, name: 'Uno' });
    const detalle = await client.getProduct(7);
    expect(detalle?.variants).toEqual([
      { idProduct: 7, idVariant: 70, sku: 'IZAO-MEN-035', name: 'Default Variant', enabled: true, price: 89000, stock: 0 },
    ]);
    expect(mock.requests.at(-1)?.query.includeAllVariations).toBe('true');
  });

  it('getProduct devuelve null en 404 y listAllProductsWithVariants une listado y detalle', async () => {
    const { mock, client } = entorno();
    mock.seedProduct({ idProduct: 1, name: 'A', basePrice: 1, variants: [{ idVariant: 11, sku: 'A-1' }, { idVariant: 12, sku: 'A-2', isEnable: 0 }] });
    expect(await client.getProduct(999)).toBeNull();
    const todos = await client.listAllProductsWithVariants();
    expect(todos.map((p) => p.variants.map((v) => [v.sku, v.enabled]))).toEqual([[['A-1', true], ['A-2', false]]]);
  });

  it('valida page y el idProduct', async () => {
    const { client } = entorno();
    await expect(client.listProducts({ page: 0 })).rejects.toMatchObject({ kind: 'validacion' });
    await expect(client.getProduct(-1)).rejects.toMatchObject({ kind: 'validacion' });
  });
});

describe('normalización', () => {
  it('SKU sin espacios y en mayúsculas', () => {
    expect(normalizarSku(' iz-0001 -100 ')).toBe('IZ-0001-100');
  });
  it('nombre sin tildes, tamaño ni signos', () => {
    expect(normalizarNombre('ONE MILLION LUCKY 100ML')).toBe('one million lucky');
    expect(normalizarNombre('Raíz  Vésper – 50 ml')).toBe('raiz vesper');
  });
});

describe('emparejarPorSku', () => {
  it('clasifica nuevas, sin cambio, conflictos y sin equivalente', () => {
    const vista = emparejarPorSku(
      [
        izao(1, 'iz-1'),
        izao(2, 'IZ-2', { mastershop_product_id: 20, mastershop_variant_id: 200 }),
        izao(3, 'IZ-3', { mastershop_product_id: 99, mastershop_variant_id: 999 }),
        izao(4, 'IZ-4'),
      ],
      [ms(10, 'Diez', [[100, 'IZ-1']]), ms(20, 'Veinte', [[200, 'IZ-2']]), ms(30, 'Treinta', [[300, 'IZ-3'], [301, 'OTRO']])],
    );
    expect(vista.nuevas.map((e) => [e.sku, e.propuesto.idProduct, e.propuesto.idVariant])).toEqual([['iz-1', 10, 100]]);
    expect(vista.sinCambio.map((e) => e.sku)).toEqual(['IZ-2']);
    expect(vista.conflictos.map((e) => [e.sku, e.actual.idProduct, e.propuesto.idProduct])).toEqual([['IZ-3', 99, 30]]);
    expect(vista.sinEquivalente.map((e) => e.sku)).toEqual(['IZ-4']);
    expect(vista.masterShopSinUsar.map((v) => v.idVariant)).toEqual([301]);
    expect(vista.totales).toMatchObject({ variantesIzao: 4, productosMasterShop: 3, variantesMasterShop: 4, nuevas: 1 });
  });

  it('no empareja SKU repetidos en MasterShop ni variantes deshabilitadas', () => {
    const vista = emparejarPorSku(
      [izao(1, 'DUP'), izao(2, 'OFF')],
      [ms(10, 'A', [[100, 'DUP']]), ms(11, 'B', [[110, 'dup']]), ms(12, 'C', [[120, 'OFF', false]])],
    );
    expect(vista.nuevas).toEqual([]);
    expect(vista.skuAmbiguos).toEqual([{ sku: 'DUP', variantes: [{ idProduct: 10, idVariant: 100 }, { idProduct: 11, idVariant: 110 }] }]);
    expect(vista.deshabilitadasEnMasterShop).toEqual([{ sku: 'OFF', idProduct: 12, idVariant: 120 }]);
    expect(vista.sinEquivalente.map((v) => v.sku)).toEqual(['OFF']);
  });

  it('respeta un vínculo manual aunque el SKU no exista en MasterShop', () => {
    const vista = emparejarPorSku([izao(1, 'IZ-1', { mastershop_product_id: 5, mastershop_variant_id: 50 })], []);
    expect(vista.sinEquivalente).toEqual([]);
    expect(vista.conflictos).toEqual([]);
  });

  it('sugiere por nombre (sin tamaño) pero no lo aplica', () => {
    const vista = emparejarPorSku(
      [izao(1, 'IZ-0001-100', { product_name: 'One Million Lucky' })],
      [ms(249511, 'ONE MILLION LUCKY 100ML', [[697831, 'IZAO-MEN-035']])],
    );
    expect(vista.nuevas).toEqual([]);
    expect(vista.sugerenciasPorNombre).toEqual([
      {
        variant_id: UUID(1),
        sku: 'IZ-0001-100',
        product_name: 'One Million Lucky',
        candidato: { idProduct: 249511, idVariant: 697831, sku: 'IZAO-MEN-035', nombre: 'ONE MILLION LUCKY 100ML' },
      },
    ]);
  });

  it('es idempotente: tras aplicar, la segunda vista previa no propone cambios', () => {
    const productos = [ms(10, 'Diez', [[100, 'IZ-1']])];
    const primera = emparejarPorSku([izao(1, 'IZ-1')], productos);
    const aplicada = primera.nuevas.map((e) =>
      izao(1, e.sku, { mastershop_product_id: e.propuesto.idProduct, mastershop_variant_id: e.propuesto.idVariant }),
    );
    const segunda = emparejarPorSku(aplicada, productos);
    expect(segunda.nuevas).toEqual([]);
    expect(segunda.sinCambio).toHaveLength(1);
    expect(sqlVinculacion(segunda, new Date(0))).toBeNull();
  });
});

describe('sqlVinculacion', () => {
  it('genera un UPDATE que solo llena variantes sin vínculo y con el mismo SKU', () => {
    const vista = emparejarPorSku([izao(1, "IZ-'1")], [ms(10, 'Diez', [[100, "IZ-'1"]])]);
    const sql = sqlVinculacion(vista, new Date('2026-11-06T00:00:00Z'))!;
    expect(sql).toContain(`('${UUID(1)}'::uuid, 'IZ-''1', 10, 100)`);
    expect(sql).toContain('v.mastershop_product_id is null');
    expect(sql).toContain('v.sku = x.sku');
    expect(sql.startsWith('-- Vinculación')).toBe(true);
    expect(sql).toMatch(/begin;[\s\S]*commit;/);
  });

  it('rechaza IDs que no son UUID o enteros positivos', () => {
    const base = emparejarPorSku([izao(1, 'A')], [ms(10, 'Diez', [[100, 'A']])]);
    const mala = { nuevas: [{ ...base.nuevas[0]!, variant_id: "x'; drop table t; --" }] };
    expect(() => sqlVinculacion(mala, new Date(0))).toThrow(/variant_id/);
    const malId = { nuevas: [{ ...base.nuevas[0]!, propuesto: { ...base.nuevas[0]!.propuesto, idVariant: 1.5 } }] };
    expect(() => sqlVinculacion(malId, new Date(0))).toThrow(/ID de MasterShop/);
  });
});
