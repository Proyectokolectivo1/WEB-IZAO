import { describe, expect, it } from 'vitest';
import { descargaTabla, ErrorArchivo, leerTablaDeArchivo } from './archivo';
import { aCsv, parsearCsv } from './csv';
import {
  COLUMNAS,
  construirImportacion,
  crearCatalogos,
  filasDeExportacion,
  fusionarImagenes,
  neutralizarFormula,
  parsearNombreImagen,
  tablaAFilas,
  type ProductoExportable,
} from './importacion';
import { crearXlsx, leerXlsx } from './xlsx';
import { crearZip, leerZip } from './zip';

const catalogos = crearCatalogos({
  marcas: [{ id: 'b1', name: 'Casa Árabe', slug: 'casa-arabe' }],
  generos: [{ id: 'g1', name: 'Unisex', slug: 'unisex' }],
  familias: [{ id: 'f1', name: 'Oriental', slug: 'oriental' }],
  concentraciones: [{ id: 'c1', name: 'Eau de Parfum', slug: 'edp' }],
  categorias: [
    { id: 'k1', name: 'Hombre', slug: 'hombre', parent_id: null },
    { id: 'k2', name: 'Amaderados', slug: 'amaderados', parent_id: 'k1' },
  ],
});

function tabla(...filas: Record<string, string>[]): string[][] {
  return [[...COLUMNAS], ...filas.map((f) => COLUMNAS.map((c) => f[c] ?? ''))];
}
function importar(...filas: Record<string, string>[]) {
  const leida = tablaAFilas(tabla(...filas));
  return construirImportacion(leida.filas, catalogos);
}

describe('csv', () => {
  it('lee comillas, saltos de línea dentro de celdas, BOM y punto y coma', () => {
    const t = parsearCsv('﻿sku;nombre\r\nA1;"Oud ""Noche"";\nrojo"\r\nA2;Rosa\r\n\r\n');
    expect(t).toEqual([['sku', 'nombre'], ['A1', 'Oud "Noche";\nrojo'], ['A2', 'Rosa']]);
  });
  it('ida y vuelta con aCsv', () => {
    const filas = [['a', 'b,c', 'd"e'], ['', 'ñ', 'x\ny']];
    expect(parsearCsv(aCsv(filas))).toEqual(filas);
  });
});

describe('zip y xlsx', () => {
  it('zip: ida y vuelta y rechazo de datos dañados o demasiado grandes', () => {
    const z = crearZip([{ nombre: 'a/b.txt', datos: Buffer.from('hola'.repeat(100)) }, { nombre: 'ñ.bin', datos: Buffer.from([1, 2, 3]) }]);
    const e = leerZip(z, { maxEntradas: 10, maxBytesEntrada: 1000, maxBytesTotal: 5000 });
    expect(e.map((x) => x.nombre)).toEqual(['a/b.txt', 'ñ.bin']);
    expect(e[0]!.datos.toString()).toBe('hola'.repeat(100));
    expect(() => leerZip(z, { maxEntradas: 1, maxBytesEntrada: 1000, maxBytesTotal: 5000 })).toThrow();
    expect(() => leerZip(z, { maxEntradas: 10, maxBytesEntrada: 100, maxBytesTotal: 5000 })).toThrow();
    expect(() => leerZip(Buffer.from('no soy un zip, de verdad que no'), { maxEntradas: 10, maxBytesEntrada: 100, maxBytesTotal: 100 })).toThrow();
    const roto = Buffer.from(z);
    roto[40] = (roto[40] ?? 0) ^ 0xff;
    expect(() => leerZip(roto, { maxEntradas: 10, maxBytesEntrada: 1000, maxBytesTotal: 5000 })).toThrow();
  });

  it('xlsx: ida y vuelta conserva ceros, decimales, tildes y caracteres XML', () => {
    const filas = [['sku', 'precio', 'nombre'], ['007', '49.90', 'Rosa & <Oud> "ñ"'], [], ['', 'x', '']];
    const leido = leerXlsx(crearXlsx(filas));
    expect(leido[0]).toEqual(['sku', 'precio', 'nombre']);
    expect(leido[1]).toEqual(['007', '49.90', 'Rosa & <Oud> "ñ"']);
    expect(leido[2]).toEqual([]);
    expect(leido[3]).toEqual(['', 'x']);
  });

  it('xlsx: lee cadenas compartidas, números y booleanos como los guarda Excel', () => {
    const e = (nombre: string, texto: string) => ({ nombre, datos: Buffer.from(texto) });
    const libro = crearZip([
      e('xl/workbook.xml', '<workbook><sheets><sheet name="Datos" sheetId="1" r:id="rId9"/></sheets></workbook>'),
      e('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId9" Type="x" Target="worksheets/hoja7.xml"/></Relationships>'),
      e('xl/sharedStrings.xml', '<sst><si><t>sku</t></si><si><r><t>Ro</t></r><r><t>sa</t></r></si></sst>'),
      e(
        'xl/worksheets/hoja7.xml',
        '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="b"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>1.89900E5</v></c></row></sheetData></worksheet>',
      ),
    ]);
    expect(leerXlsx(libro)).toEqual([['sku', '', 'sí'], ['Rosa', '189900']]);
  });

  it('xlsx: un archivo que no es xlsx da un error claro', () => {
    expect(() => leerXlsx(Buffer.from('hola'))).toThrow(/Excel/);
  });
});

describe('archivo', () => {
  it('elige el lector por extensión y rechaza lo demás', () => {
    expect(leerTablaDeArchivo('a.csv', Buffer.from('sku\nA'))).toEqual([['sku'], ['A']]);
    expect(leerTablaDeArchivo('a.XLSX', crearXlsx([['sku'], ['A']]))).toEqual([['sku'], ['A']]);
    expect(() => leerTablaDeArchivo('a.pdf', Buffer.from('x'))).toThrow(ErrorArchivo);
    expect(() => leerTablaDeArchivo('a.csv', Buffer.alloc(0))).toThrow(ErrorArchivo);
  });
  it('arma descargas en ambos formatos', () => {
    expect(descargaTabla([['a']], 'csv', 'x')).toMatchObject({ nombre: 'x.csv' });
    expect(descargaTabla([['a']], 'xlsx', 'x')).toMatchObject({ nombre: 'x.xlsx' });
  });
});

describe('construirImportacion · descripciones', () => {
  it('depura el HTML de la descripción y de la descripción corta', () => {
    const { productos, errores } = importar({
      sku: 'A1', producto_slug: 'rosa', nombre: 'Rosa', marca: 'casa arabe', precio_co: '100000',
      descripcion_corta: 'Fresco<script>x</script>', descripcion: '<p onclick="x()">Hola</p><a href="javascript:alert(1)">z</a>',
    });
    expect(errores).toEqual([]);
    expect(productos[0]?.payload.product.short_description).toBe('Fresco');
    expect(productos[0]?.payload.product.description_html).toBe('<p>Hola</p><a>z</a>');
  });
});

describe('construirImportacion', () => {
  it('agrupa variantes por producto y convierte el dinero por país', () => {
    const { productos, errores } = importar(
      {
        sku: 'OUD-50', producto_slug: 'oud-nocturno', nombre: 'Oud Nocturno', marca: 'casa arabe', genero: 'Unisex',
        categorias: 'Hombre|Hombre > Amaderados', notas_salida: 'Bergamota, limón', opcion_1_nombre: 'Tamaño', opcion_1_valor: '50 ml',
        peso_kg: '0,3', visible_co: 'sí', precio_co: '189.900', costo_co: '90000', stock_co: '4', visible_ec: 'no', precio_ec: '49,90', tachado_ec: '59.90', por_defecto: 'x',
      },
      { sku: 'OUD-100', producto_slug: 'oud-nocturno', opcion_1_nombre: 'Tamaño', opcion_1_valor: '100 ml', precio_co: '259900', mastershop_product_id_co: '777', mastershop_product_id_ec: '888', mastershop_variant_id_ec: '889', precio_ec: '99.90' },
    );
    expect(errores).toEqual([]);
    expect(productos).toHaveLength(1);
    const p = productos[0]!;
    expect(p.filas).toEqual([2, 3]);
    expect(p.payload.product).toMatchObject({ slug: 'oud-nocturno', name: 'Oud Nocturno', brand_id: 'b1', gender_id: 'g1', notes_top: ['Bergamota', 'limón'] });
    expect(p.payload.category_ids).toEqual(['k1', 'k2']);
    expect(p.payload.countries).toEqual([{ country_code: 'CO', is_visible: true }, { country_code: 'EC', is_visible: false }]);
    expect(p.payload.options).toEqual([{ name: 'Tamaño', sort_order: 0, values: [{ value: '50 ml', sort_order: 0 }, { value: '100 ml', sort_order: 1 }] }]);
    const [v1, v2] = p.payload.variants!;
    expect(v1).toMatchObject({ sku: 'OUD-50', weight_kg: 0.3, is_default: true, option_values: [{ option: 'Tamaño', value: '50 ml' }] });
    expect(v1!.countries).toEqual([
      { country_code: 'CO', price: '189900', is_active: true, cost: '90000', stock: 4 },
      { country_code: 'EC', price: '4990', is_active: true, compare_at_price: '5990' },
    ]);
    expect(v2).toMatchObject({ sku: 'OUD-100' });
    expect(v2!.countries).toEqual([
      { country_code: 'CO', price: '259900', is_active: true, mastershop_product_id: 777 },
      { country_code: 'EC', price: '9990', is_active: true, mastershop_product_id: 888, mastershop_variant_id: 889 },
    ]);
    expect(v2!.is_default).toBeUndefined();
  });

  it('celda vacía no manda el dato (no borra)', () => {
    const { productos } = importar({ sku: 'A1', producto_slug: 'rosa', stock_co: '9' });
    expect(productos[0]!.payload.product).toEqual({ slug: 'rosa' });
    expect(productos[0]!.payload.variants![0]!.countries).toEqual([{ country_code: 'CO', stock: 9 }]);
    expect(productos[0]!.payload.category_ids).toBeUndefined();
  });

  it('reporta cada problema con fila, columna y SKU y no envía ese producto', () => {
    const r = importar(
      { sku: 'A1', producto_slug: 'bueno', nombre: 'Bueno', precio_co: '1000' },
      { sku: 'B1', producto_slug: 'malo', marca: 'Inventada', precio_co: '12,50', precio_ec: '1.999', stock_co: '-1', visible_co: 'quizá', mastershop_product_id_ec: 'abc' },
      { sku: 'B 2', producto_slug: 'malo' },
      { sku: 'A1', producto_slug: 'otro' },
      { sku: '', producto_slug: 'sinsku' },
      { sku: 'C1', producto_slug: '', nombre: '' },
    );
    expect(r.productos.map((p) => p.slug)).toEqual(['bueno']);
    expect(r.omitidos).toBe(3);
    const claves = r.errores.map((e) => `${e.fila}:${e.columna}`);
    expect(claves).toEqual(expect.arrayContaining(['3:marca', '3:precio_co', '3:precio_ec', '3:stock_co', '3:visible_co', '3:mastershop_product_id_ec', '4:sku', '5:sku', '6:sku', '7:producto_slug']));
    expect(r.errores.find((e) => e.fila === 5)?.mensaje).toMatch(/fila 2/);
    expect(r.errores.every((e) => e.mensaje.length > 5)).toBe(true);
  });

  it('exige tachado mayor que el precio y opciones completas y consistentes', () => {
    const r = importar(
      { sku: 'A', producto_slug: 'p', precio_co: '1000', tachado_co: '900', opcion_1_nombre: 'Tamaño' },
      { sku: 'B', producto_slug: 'p', opcion_1_nombre: 'Color', opcion_1_valor: 'Rojo' },
    );
    expect(r.productos).toEqual([]);
    expect(r.errores.map((e) => e.columna)).toEqual(expect.arrayContaining(['tachado_co', 'opcion_1_valor']));
  });

  it('tablaAFilas: exige la columna sku, ignora columnas desconocidas y filas vacías', () => {
    expect(tablaAFilas([['nombre'], ['x']]).error).toMatch(/sku/);
    const t = tablaAFilas([['SKU', 'Producto Slug', 'color raro'], ['A', 'a', 'z'], ['', '', '']]);
    expect(t.ignoradas).toEqual(['color_raro']);
    expect(t.filas).toEqual([{ fila: 2, valores: { sku: 'A', producto_slug: 'a' } }]);
  });
});

describe('exportación', () => {
  const exp: ProductoExportable = {
    marca: 'Casa Árabe', genero: 'Unisex', familia: '', concentracion: '', categorias: ['Hombre'],
    bd: {
      product: {
        id: 'p1', name: '=Oud', slug: 'oud', short_description: null, description_html: null, brand_id: 'b1', gender_id: 'g1', family_id: null,
        concentration_id: null, notes_top: ['Bergamota', 'Limón'], notes_heart: [], notes_base: [], occasion: [], season: [], longevity: null,
        sillage: null, seo_title: null, seo_description: null, status: 'active',
      },
      categoryIds: ['k1'],
      countries: [{ country_code: 'CO', is_visible: true, is_featured: false, featured_rank: null, badges: [] }],
      options: [{ id: 'o1', name: 'Tamaño', sort_order: 0, values: [{ id: 'v1', value: '50 ml', sort_order: 0 }] }],
      variants: [{
        id: 'x', sku: 'OUD-50', option_value_ids: ['v1'], weight_kg: '0.300', is_default: true,
        image_id: null, sort_order: 0,
        countries: [
          { country_code: 'CO', is_active: true, price: 189900, compare_at_price: null, cost: '90000', stock: 4, low_stock_threshold: null, mastershop_product_id: 5, mastershop_variant_id: null },
          { country_code: 'EC', is_active: true, price: 4990, compare_at_price: 5990, cost: null, stock: 1, low_stock_threshold: null, mastershop_product_id: 6, mastershop_variant_id: 7 },
        ],
      }],
      images: [],
    },
  };

  it('exporta el dinero en unidad mayor y neutraliza fórmulas', () => {
    const filas = filasDeExportacion([exp]);
    expect(filas[0]).toEqual([...COLUMNAS]);
    const fila = Object.fromEntries(COLUMNAS.map((c, i) => [c, filas[1]![i]]));
    expect(fila).toMatchObject({
      sku: 'OUD-50', nombre: "'=Oud", marca: 'Casa Árabe', categorias: 'Hombre', notas_salida: 'Bergamota|Limón',
      precio_co: '189900', costo_co: '90000', stock_co: '4', visible_co: 'sí', precio_ec: '49.90', tachado_ec: '59.90',
      visible_ec: '', peso_kg: '0.3', estado: 'activo', por_defecto: 'sí', opcion_1_nombre: 'Tamaño', opcion_1_valor: '50 ml',
      mastershop_product_id_co: '5', mastershop_variant_id_co: '', mastershop_product_id_ec: '6', mastershop_variant_id_ec: '7',
    });
  });

  it('lo exportado se puede volver a importar sin cambiar nada', () => {
    const tabla = parsearCsv(aCsv(filasDeExportacion([exp])));
    const r = construirImportacion(tablaAFilas(tabla).filas, catalogos);
    expect(r.errores).toEqual([]);
    const v = r.productos[0]!.payload.variants![0]!;
    expect(v.countries).toEqual([
      { country_code: 'CO', price: '189900', is_active: true, cost: '90000', stock: 4, mastershop_product_id: 5 },
      { country_code: 'EC', price: '4990', is_active: true, compare_at_price: '5990', stock: 1, mastershop_product_id: 6, mastershop_variant_id: 7 },
    ]);
    expect(r.productos[0]!.payload.product.name).toBe('=Oud');
  });

  it('neutralizarFormula', () => {
    expect(neutralizarFormula('=1+1')).toBe("'=1+1");
    expect(neutralizarFormula('-5')).toBe('-5');
    expect(neutralizarFormula('-cmd')).toBe("'-cmd");
    expect(neutralizarFormula('Rosa')).toBe('Rosa');
  });
});

describe('imágenes por SKU', () => {
  it('interpreta SKU_n.ext', () => {
    expect(parsearNombreImagen('AVT-100_1.jpg')).toEqual({ sku: 'AVT-100', posicion: 1 });
    expect(parsearNombreImagen('carpeta/A_B_12.WEBP')).toEqual({ sku: 'A_B', posicion: 12 });
    expect(parsearNombreImagen('sin-numero.jpg')).toBeNull();
    expect(parsearNombreImagen('A_0.jpg')).toBeNull();
    expect(parsearNombreImagen('A_1.gif')).toBeNull();
  });

  it('fusiona: 1 principal, 2 cursor, 3+ galería reemplazando ese lugar', () => {
    const existentes = [
      { media_id: 'p', role: 'primary' as const, sort_order: 0 },
      { media_id: 'h', role: 'hover' as const, sort_order: 1 },
      { media_id: 'g1', role: 'gallery' as const, sort_order: 2 },
    ];
    const r = fusionarImagenes(existentes, [{ media_id: 'n1', posicion: 1 }, { media_id: 'n3', posicion: 3 }, { media_id: 'n4', posicion: 4 }]);
    expect(r).toEqual([
      { media_id: 'n1', role: 'primary', sort_order: 0 },
      { media_id: 'h', role: 'hover', sort_order: 1 },
      { media_id: 'n3', role: 'gallery', sort_order: 2 },
      { media_id: 'n4', role: 'gallery', sort_order: 3 },
    ]);
    expect(fusionarImagenes([], [{ media_id: 'x', posicion: 2 }]).map((i) => i.role)).toEqual(['primary']);
  });
});
