import { describe, expect, it } from 'vitest';
import {
  aFormulario,
  agregarOpcion,
  agregarValor,
  combinacionesFaltantes,
  construirEntrada,
  duplicarForm,
  esquemaProductoForm,
  etiquetaVariante,
  generarVariantes,
  leerFiltrosProductos,
  mover,
  normalizarImagenes,
  parametrosFiltros,
  parsearMonto,
  productoNuevo,
  quitarValor,
  quitarVariante,
  resumenPorPais,
  separarLista,
  variantesSinVinculo,
  type ProductoBd,
  type ProductoForm,
} from './productos';

/** UUID deterministas: 00000000-0000-4000-8000-00000000000N. */
function generador(inicio = 0) {
  let n = inicio;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
}

function valido(ajustes: Partial<ProductoForm> = {}): ProductoForm {
  const f = productoNuevo(generador());
  const v = f.variants[0]!;
  return {
    ...f,
    name: 'Oud Nocturno',
    slug: 'oud-nocturno',
    variants: [
      {
        ...v,
        sku: 'OUD-100',
        countries: [
          { country_code: 'CO', is_active: true, price: '189.900', compare_at_price: '', cost: '90000', stock: '12', low_stock_threshold: '3' },
          { country_code: 'EC', is_active: true, price: '49.90', compare_at_price: '59,90', cost: '', stock: '4', low_stock_threshold: '' },
        ],
      },
    ],
    ...ajustes,
  };
}

describe('parsearMonto', () => {
  it('COP: enteros y miles', () => {
    expect(parsearMonto('90000', 'COP')).toEqual({ ok: true, valor: 90000n });
    expect(parsearMonto('$ 189.900', 'COP')).toEqual({ ok: true, valor: 189900n });
    expect(parsearMonto('1.234.567', 'COP')).toEqual({ ok: true, valor: 1234567n });
  });
  it('COP: rechaza decimales y basura', () => {
    expect(parsearMonto('90.00', 'COP').ok).toBe(false);
    expect(parsearMonto('90,5', 'COP').ok).toBe(false);
    expect(parsearMonto('-5', 'COP').ok).toBe(false);
    expect(parsearMonto('', 'COP').ok).toBe(false);
    expect(parsearMonto('abc', 'COP').ok).toBe(false);
  });
  it('USD: pasa a centavos sin pasar por float', () => {
    expect(parsearMonto('49.90', 'USD')).toEqual({ ok: true, valor: 4990n });
    expect(parsearMonto('49,9', 'USD')).toEqual({ ok: true, valor: 4990n });
    expect(parsearMonto('1,234.50', 'USD')).toEqual({ ok: true, valor: 123450n });
    expect(parsearMonto('0.10', 'USD')).toEqual({ ok: true, valor: 10n });
    expect(parsearMonto('7', 'USD')).toEqual({ ok: true, valor: 700n });
  });
  it('USD: rechaza más de 2 decimales y topes absurdos', () => {
    expect(parsearMonto('1.999', 'USD').ok).toBe(false);
    expect(parsearMonto('99999999999999', 'COP').ok).toBe(false);
  });
});

describe('listas, mover y filtros', () => {
  it('separa por coma, barra o salto de línea sin repetidos', () => {
    expect(separarLista('Bergamota, limón | Bergamota\n  Cedro ,')).toEqual(['Bergamota', 'limón', 'Cedro']);
    expect(separarLista('')).toEqual([]);
  });
  it('mover no se sale de los bordes', () => {
    expect(mover([1, 2, 3], 0, -1)).toEqual([1, 2, 3]);
    expect(mover([1, 2, 3], 0, 1)).toEqual([2, 1, 3]);
    expect(mover([1, 2, 3], 2, -2)).toEqual([3, 1, 2]);
  });
  it('lee filtros de la URL con valores seguros', () => {
    const f = leerFiltrosProductos({ q: ' oud ', estado: 'hackeado', pais: 'EC', marca: 'no-uuid', page: '-3' });
    expect(f).toEqual({ q: 'oud', estado: '', marca: '', pais: 'EC', pagina: 1 });
    expect(parametrosFiltros({ ...f, estado: 'active' })).toEqual({ q: 'oud', estado: 'active', pais: 'EC' });
  });
});

describe('normalizarImagenes', () => {
  it('deja una principal y una hover; ignora repetidas', () => {
    const r = normalizarImagenes([
      { media_id: 'a', role: 'primary' as const },
      { media_id: 'b', role: 'primary' as const },
      { media_id: 'c', role: 'hover' as const },
      { media_id: 'd', role: 'hover' as const },
      { media_id: 'a', role: 'gallery' as const },
    ]);
    expect(r.map((x) => x.role)).toEqual(['primary', 'gallery', 'hover', 'gallery']);
  });
  it('si no hay principal, la primera de galería lo es', () => {
    expect(normalizarImagenes([{ media_id: 'a', role: 'hover' as const }, { media_id: 'b', role: 'gallery' as const }]).map((x) => x.role)).toEqual(['hover', 'primary']);
  });
});

describe('vínculo MasterShop', () => {
  const v = [{ activaEnCO: true, mastershopProductId: null }, { activaEnCO: true, mastershopProductId: 7 }, { activaEnCO: false, mastershopProductId: null }];
  it('exige vínculo solo si está activo, visible en CO y la variante activa en CO', () => {
    expect(variantesSinVinculo({ status: 'active', visibleEnCO: true, variantes: v })).toEqual([0]);
    expect(variantesSinVinculo({ status: 'draft', visibleEnCO: true, variantes: v })).toEqual([]);
    expect(variantesSinVinculo({ status: 'active', visibleEnCO: false, variantes: v })).toEqual([]);
  });
});

describe('construirEntrada · descripciones', () => {
  it('depura el HTML de la descripción y del resumen con la lista blanca de la tienda', () => {
    const f = valido({
      status: 'draft',
      short_description: '<p>Resumen</p><script>alert(1)</script>',
      description_html: '<h2>Notas</h2><img src=x onerror=alert(1)><a href="javascript:alert(1)" onclick="x()">enlace</a><iframe src="//m"></iframe>',
    });
    const r = construirEntrada(f);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entrada.product.short_description).toBe('<p>Resumen</p>');
    expect(r.entrada.product.description_html).toBe('<h2>Notas</h2><a>enlace</a>');
  });

  it('una descripción que queda vacía tras depurar se guarda como nula', () => {
    const r = construirEntrada(valido({ status: 'draft', description_html: '<script>x</script>' }));
    expect(r.ok && r.entrada.product.description_html).toBeNull();
  });
});

describe('construirEntrada', () => {
  it('convierte dinero a unidad menor según la moneda del país', () => {
    const f = valido({ status: 'draft' });
    const r = construirEntrada(f);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [co, ec] = r.entrada.variants![0]!.countries!;
    expect(co).toMatchObject({ country_code: 'CO', price: '189900', cost: '90000', compare_at_price: null, stock: 12, low_stock_threshold: 3 });
    expect(ec).toMatchObject({ country_code: 'EC', price: '4990', compare_at_price: '5990', stock: 4 });
    expect(r.entrada.variants![0]!.sort_order).toBe(0);
  });

  it('un país sin precio y desactivado no se envía (la base lo borra)', () => {
    const f = valido({ status: 'draft' });
    f.variants[0]!.countries[1] = { country_code: 'EC', is_active: false, price: '', compare_at_price: '', cost: '', stock: '0', low_stock_threshold: '' };
    const r = construirEntrada(f);
    expect(r.ok && r.entrada.variants![0]!.countries!.map((c) => c.country_code)).toEqual(['CO']);
  });

  it('exige precio si el país está activo y marca el campo', () => {
    const f = valido();
    f.variants[0]!.countries[0]!.price = '';
    const r = construirEntrada(f);
    expect(r).toMatchObject({ ok: false, errores: { 'variants.0.CO.price': 'Escribe el precio.' } });
  });

  it('el precio tachado debe superar al precio', () => {
    const f = valido();
    f.variants[0]!.countries[0]!.compare_at_price = '100.000';
    const r = construirEntrada(f);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errores['variants.0.CO.compare_at_price']).toMatch(/mayor/);
  });

  it('producto activo y visible en CO sin vínculo MasterShop no se publica', () => {
    const f = valido({ status: 'active' });
    f.countries[0]!.is_visible = true;
    const r = construirEntrada(f);
    expect(!r.ok && r.errores['variants.0.mastershop_product_id']).toMatch(/MasterShop/);
    f.variants[0]!.mastershop_product_id = '1234';
    expect(construirEntrada(f).ok).toBe(true);
  });

  it('en borrador o solo visible en Ecuador no pide vínculo', () => {
    const f = valido({ status: 'active' });
    f.countries[1]!.is_visible = true;
    expect(construirEntrada(f).ok).toBe(true);
  });

  it('no deja mostrar un país donde ninguna variante está activa', () => {
    const f = valido();
    f.variants[0]!.countries[1]!.is_active = false;
    f.countries[1]!.is_visible = true;
    const r = construirEntrada(f);
    expect(!r.ok && Object.keys(r.errores)).toContain('countries.EC.is_visible');
  });

  it('exige una sola variante por defecto, SKU único y sin espacios', () => {
    const f = valido();
    const dos = { ...f.variants[0]!, id: '00000000-0000-4000-8000-0000000000aa', sku: 'oud-100', is_default: true };
    const r = construirEntrada({ ...f, variants: [f.variants[0]!, dos] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errores.variants).toMatch(/Solo una/);
    expect(r.errores['variants.1.sku']).toMatch(/repetido/);
    expect(construirEntrada(valido({ variants: [{ ...f.variants[0]!, sku: 'A B' }] })).ok).toBe(false);
  });

  it('valida opciones: nombre, valores y una elección por opción', () => {
    const nuevo = generador();
    let f = valido();
    f = agregarOpcion(f, nuevo);
    f = agregarValor(f, f.options[0]!.id, nuevo(), '50 ml');
    f = agregarValor(f, f.options[0]!.id, nuevo(), '100 ml');
    let r = construirEntrada(f);
    expect(!r.ok && r.errores['options.0.name']).toBeTruthy();
    expect(!r.ok && r.errores['variants.0.options']).toMatch(/cada opción/);

    f.options[0]!.name = 'Tamaño';
    f = generarVariantes(f, nuevo);
    expect(f.variants).toHaveLength(2);
    expect(combinacionesFaltantes(f)).toEqual([]);
    f.variants[1]!.sku = 'OUD-50';
    f.variants[1]!.countries = f.variants[0]!.countries.map((c) => ({ ...c }));
    r = construirEntrada(f);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.entrada.options![0]).toMatchObject({ name: 'Tamaño', sort_order: 0 });
      expect(r.entrada.options![0]!.values!.map((x) => x.value)).toEqual(['50 ml', '100 ml']);
      expect(r.entrada.variants!.map((x) => x.option_value_ids!.length)).toEqual([1, 1]);
    }
  });

  it('rechaza valores repetidos y combinaciones repetidas', () => {
    const nuevo = generador();
    let f = valido();
    f = agregarOpcion(f, nuevo);
    f.options[0]!.name = 'Tamaño';
    f = agregarValor(f, f.options[0]!.id, nuevo(), '50 ml');
    f = agregarValor(f, f.options[0]!.id, nuevo(), '50 ML');
    f.variants[0]!.option_value_ids = [f.options[0]!.values[0]!.id];
    const r = construirEntrada(f);
    expect(!r.ok && r.errores['options.0.values.1']).toMatch(/repetido/);
  });

  it('manda imágenes con orden y una principal', () => {
    const f = valido({
      images: [
        { media_id: '00000000-0000-4000-8000-0000000000b1', role: 'gallery', ruta: 'x', alt: 'a' },
        { media_id: '00000000-0000-4000-8000-0000000000b2', role: 'hover', ruta: 'y', alt: 'b' },
      ],
    });
    const r = construirEntrada(f);
    expect(r.ok && r.entrada.images).toEqual([
      { media_id: '00000000-0000-4000-8000-0000000000b1', role: 'primary', sort_order: 0 },
      { media_id: '00000000-0000-4000-8000-0000000000b2', role: 'hover', sort_order: 1 },
    ]);
  });

  it('valida nombre y URL', () => {
    const r = construirEntrada(valido({ name: ' ', slug: 'Mala URL' }));
    expect(!r.ok && Object.keys(r.errores)).toEqual(expect.arrayContaining(['name', 'slug']));
  });
});

describe('operaciones sobre variantes', () => {
  it('quitar la variante por defecto asigna otra y nunca deja el producto sin variantes', () => {
    const nuevo = generador();
    const f = valido();
    expect(quitarVariante(f, f.variants[0]!.id).variants).toHaveLength(1);
    const g = { ...f, variants: [f.variants[0]!, { ...f.variants[0]!, id: nuevo(), is_default: false, sku: 'B' }] };
    const h = quitarVariante(g, g.variants[0]!.id);
    expect(h.variants).toHaveLength(1);
    expect(h.variants[0]!.is_default).toBe(true);
  });

  it('quitar un valor elimina las variantes que lo usan', () => {
    const nuevo = generador();
    let f = valido();
    f = agregarOpcion(f, nuevo);
    f.options[0]!.name = 'Tamaño';
    f = agregarValor(f, f.options[0]!.id, nuevo(), '50 ml');
    f = agregarValor(f, f.options[0]!.id, nuevo(), '100 ml');
    f = generarVariantes(f, nuevo);
    const id50 = f.options[0]!.values[0]!.id;
    const g = quitarValor(f, f.options[0]!.id, id50);
    expect(g.variants).toHaveLength(1);
    expect(g.variants[0]!.is_default).toBe(true);
    expect(etiquetaVariante(g.options, g.variants[0]!)).toBe('100 ml');
  });

  it('duplicar crea un borrador sin vínculo, invisible y con ids nuevos', () => {
    const f = valido({ id: '00000000-0000-4000-8000-0000000000f0', status: 'active' });
    f.countries[0]!.is_visible = true;
    f.variants[0]!.mastershop_product_id = '99';
    const d = duplicarForm(f, generador(500));
    expect(d.id).toBeUndefined();
    expect(d.status).toBe('draft');
    expect(d.slug).toBe('oud-nocturno-copia');
    expect(d.name).toBe('Oud Nocturno (copia)');
    expect(d.countries.every((c) => !c.is_visible)).toBe(true);
    expect(d.variants[0]).toMatchObject({ sku: 'OUD-100-COPIA', mastershop_product_id: '' });
    expect(d.variants[0]!.id).not.toBe(f.variants[0]!.id);
    expect(construirEntrada(d).ok).toBe(true);
  });
});

describe('esquemaProductoForm', () => {
  it('acepta el formulario generado y rellena textos ausentes', () => {
    const f = valido();
    expect(esquemaProductoForm.safeParse(JSON.parse(JSON.stringify(f))).success).toBe(true);
    const sinTextos = JSON.parse(JSON.stringify(f)) as Record<string, unknown>;
    delete sinTextos.notes_top;
    expect(esquemaProductoForm.parse(sinTextos).notes_top).toBe('');
  });
  it('rechaza ids que no son UUID y estados desconocidos', () => {
    const f = JSON.parse(JSON.stringify(valido())) as Record<string, unknown>;
    expect(esquemaProductoForm.safeParse({ ...f, status: 'publicado' }).success).toBe(false);
    expect(esquemaProductoForm.safeParse({ ...f, category_ids: ['uno'] }).success).toBe(false);
  });
});

describe('aFormulario', () => {
  const bd: ProductoBd = {
    product: {
      id: '00000000-0000-4000-8000-0000000000f1',
      name: 'Rosa',
      slug: 'rosa',
      short_description: null,
      description_html: null,
      brand_id: null,
      gender_id: null,
      family_id: null,
      concentration_id: null,
      notes_top: ['Rosa', 'Pimienta'],
      notes_heart: [],
      notes_base: [],
      occasion: [],
      season: [],
      longevity: 'alta',
      sillage: 'rara',
      seo_title: null,
      seo_description: null,
      status: 'active',
    },
    categoryIds: [],
    countries: [{ country_code: 'EC', is_visible: true, is_featured: false, featured_rank: null, badges: ['Nuevo'] }],
    options: [],
    variants: [
      {
        id: '00000000-0000-4000-8000-0000000000f2',
        sku: 'ROSA-1',
        option_value_ids: [],
        weight_kg: '0.500',
        is_default: true,
        mastershop_product_id: null,
        mastershop_variant_id: null,
        image_id: null,
        sort_order: 0,
        countries: [{ country_code: 'EC', is_active: true, price: 4990, compare_at_price: '5990', cost: null, stock: 3, low_stock_threshold: null }],
      },
    ],
    images: [],
  };

  it('muestra el dinero en unidad mayor y completa los dos países', () => {
    const f = aFormulario(bd);
    expect(f.variants[0]!.countries.map((c) => c.country_code)).toEqual(['CO', 'EC']);
    expect(f.variants[0]!.countries[1]).toMatchObject({ price: '49.90', compare_at_price: '59.90', cost: '' });
    expect(f.variants[0]!.countries[0]).toMatchObject({ is_active: false, price: '' });
    expect(f.variants[0]!.weight_kg).toBe('0.5');
    expect(f.countries.map((c) => c.is_visible)).toEqual([false, true]);
    expect(f.notes_top).toBe('Rosa, Pimienta');
    expect(f.longevity).toBe('alta');
    expect(f.sillage).toBe('');
  });

  it('ida y vuelta: lo cargado se vuelve a guardar sin cambiar el dinero', () => {
    const r = construirEntrada(aFormulario(bd));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.entrada.variants![0]!.countries).toEqual([
      { country_code: 'EC', is_active: true, price: '4990', compare_at_price: '5990', cost: null, stock: 3, low_stock_threshold: null },
    ]);
  });
});

describe('resumenPorPais', () => {
  it('toma el precio más bajo de las variantes activas y suma stock', () => {
    const r = resumenPorPais(
      [
        { countries: [{ country_code: 'CO', is_active: true, price: 200000, stock: 2 }, { country_code: 'EC', is_active: false, price: 5000, stock: 1 }] },
        { countries: [{ country_code: 'CO', is_active: true, price: '150000', stock: 5 }] },
      ],
      [{ country_code: 'CO', is_visible: true }],
    );
    expect(r.CO).toEqual({ visible: true, precioDesde: 150000n, stock: 7, variantesActivas: 2 });
    expect(r.EC).toEqual({ visible: false, precioDesde: null, stock: 1, variantesActivas: 0 });
  });
});
