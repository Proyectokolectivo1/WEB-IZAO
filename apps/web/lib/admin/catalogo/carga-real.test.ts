import { describe, expect, it } from 'vitest';
import {
  RE_PROHIBIDO_FINAL,
  construirCarga,
  limpiarDescripcion,
  literal,
  normalizarNombre,
  sqlArchivarSeed,
  sqlCarga,
  sqlPublicarCo,
  sqlRestaurarSeed,
} from './carga-real';

const ENC = ['Nombre_del_Producto*', 'Descripción*', 'Categoría*', 'Producto_Variable (SI/NO)*', 'Precio*', 'Peso_kg*', 'SKU'];
const fila = (nombre: string, desc: string, sku: string, precio = '115000', variable = 'NO', peso = '1'): string[] => [
  nombre, desc, 'Salud, belleza y cuidado personal', variable, precio, peso, sku,
];

describe('limpiarDescripcion (regla 7)', () => {
  it('quita emojis, conserva aroma e ideal para y separa párrafos', () => {
    const r = limpiarDescripcion('🌹  DEVOTION 100ML  🌹 \n\\n ✨ Aroma : Una fragancia floral. \n\\n 👩 Ideal para : Mujeres elegantes.', 'Devotion 100 ml');
    expect(r.parrafos).toEqual(['Aroma: Una fragancia floral.', 'Ideal para: Mujeres elegantes.']);
    expect(r.html).toBe('<p>Aroma: Una fragancia floral.</p><p>Ideal para: Mujeres elegantes.</p>');
    expect(/\p{Extended_Pictographic}/u.test(r.html)).toBe(false);
  });

  it('retira menciones de otra tienda, imitaciones y afirmaciones de originalidad/afiliación', () => {
    const r = limpiarDescripcion(
      'Una fragancia dulce. En Amelié Store te la traemos. Es un dupe elegante de otra marca. Producto 100% original y certificado. Distribuidor oficial autorizado. Cálida y envolvente.',
      'X',
    );
    expect(r.parrafos.join(' ')).toBe('Una fragancia dulce. Cálida y envolvente.');
    expect(r.avisos.map((a) => a.tipo)).toEqual(['tienda', 'imitacion', 'afirmacion', 'afirmacion', 'texto_corto']);
    expect(RE_PROHIBIDO_FINAL.test(r.html)).toBe(false);
  });

  it('quita «auténtica»/«genuino» como palabra sin perder la oración', () => {
    const r = limpiarDescripcion('Descubre la frescura auténtica de Hugo, una fragancia genuina y dinámica.', 'Hugo');
    expect(r.parrafos[0]).toBe('Descubre la frescura de Hugo, una fragancia y dinámica.');
  });

  it('descarta el encabezado que repite el nombre (con y sin emoji de cierre)', () => {
    expect(limpiarDescripcion('✨ Victoria – Lattafa (100 ml) ✨ Un perfume luminoso.', 'Victoria Lattafa 100 ml').parrafos[0]).toBe('Un perfume luminoso.');
    expect(limpiarDescripcion('🧴 Amber Rouge – Orientica Premium 100ML Una fragancia intensa.', 'Amber Rouge Orientica Premium 100 ml').parrafos[0]).toBe(
      'Una fragancia intensa.',
    );
    // Un «100 ml» dentro de una oración real no se confunde con un título.
    expect(limpiarDescripcion('Perfume de 100 ml para el día a día.', 'Otro nombre').parrafos[0]).toBe('Perfume de 100 ml para el día a día.');
  });

  it('recorta el texto cortado en el origen a la última oración completa', () => {
    const r = limpiarDescripcion('Un perfume cálido y elegante. Combina notas de vainilla y una esencia...', 'X');
    expect(r.parrafos).toEqual(['Un perfume cálido y elegante.']);
    expect(r.avisos.map((a) => a.tipo)).toContain('truncada');
  });

  it('sin oración completa recorta a la última coma y pide revisión', () => {
    const r = limpiarDescripcion('Una fragancia floral y oriental con jazmín, rosa y vainilla, que da como resultado una esencia...', 'X');
    expect(r.parrafos[0]).toBe('Una fragancia floral y oriental con jazmín, rosa y vainilla.');
    expect(r.avisos.map((a) => a.tipo)).toContain('truncada_sin_corte');
  });

  it('escapa HTML y genera una descripción corta de oraciones completas', () => {
    const r = limpiarDescripcion('Notas <b>cítricas</b> & frescas. Segunda oración.', 'X');
    expect(r.html).toContain('&lt;b&gt;');
    expect(r.html).toContain('&amp;');
    expect(r.corta.endsWith('.')).toBe(true);
  });

  it('marca como corta una descripción que casi desaparece', () => {
    expect(limpiarDescripcion('En Amelié Store te traemos esta joya.', 'X').avisos.map((a) => a.tipo)).toContain('texto_corto');
  });
});

describe('normalizarNombre', () => {
  it('normaliza espacios y la medida', () => {
    expect(normalizarNombre('  Mayar   Natural 100ML ')).toBe('Mayar Natural 100 ml');
  });
  it('pasa a título lo que está todo en mayúsculas y respeta siglas', () => {
    expect(normalizarNombre('DEVOTION DOLCE & GABBANA 100ML')).toBe('Devotion Dolce & Gabbana 100 ml');
    expect(normalizarNombre('CLUB DE NUIT EDP D&G 100ML')).toBe('Club de Nuit EDP D&G 100 ml');
  });
  it('deja intacto lo que ya tiene mayúsculas y minúsculas', () => {
    expect(normalizarNombre('Yara Tous Amarilla Lattafa Perfumes 100ML')).toBe('Yara Tous Amarilla Lattafa Perfumes 100 ml');
  });
});

describe('construirCarga', () => {
  const tabla = [
    ENC,
    fila('DEVOTION DOLCE & GABBANA 100ML', 'Aroma: floral. Ideal para mujeres.', 'IZAO-MEN-101'),
    fila('DEVOTION DOLCE & GABBANA 100ML', 'Aroma: floral. Ideal para mujeres.', 'IZAO-WOM-001'),
    fila('Hombre Fresco 100ML', 'Perfume fresco para hombres.', 'izao-men-002', '95000'),
  ];

  it('mapea género y categoría por el prefijo, precio entero y slugs únicos', () => {
    const r = construirCarga(tabla, { borradores: { 'IZAO-MEN-101': 'ejemplo' } });
    expect(r.problemas).toEqual([]);
    expect(r.productos.map((p) => [p.sku, p.generoSlug, p.categoriaSlug, p.precioCo, p.estado])).toEqual([
      ['IZAO-MEN-101', 'hombre', 'hombre', 115000, 'draft'],
      ['IZAO-WOM-001', 'mujer', 'mujer', 115000, 'active'],
      ['IZAO-MEN-002', 'hombre', 'hombre', 95000, 'active'],
    ]);
    const slugs = r.productos.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(slugs[0]).toBe('devotion-dolce-gabbana-100-ml-men-101');
    expect(slugs[1]).toBe('devotion-dolce-gabbana-100-ml');
    expect(r.duplicadosNombre).toEqual([{ nombre: 'Devotion Dolce & Gabbana 100 ml', skus: ['IZAO-MEN-101', 'IZAO-WOM-001'] }]);
    expect(r.productos[0]!.revisar.join(' ')).toContain('el texto habla de mujer');
  });

  it('rechaza SKU repetidos, formato, precio no entero, variable y peso inválido', () => {
    const r = construirCarga([
      ENC,
      fila('A', 'texto uno.', 'IZAO-MEN-001'),
      fila('B', 'texto dos.', 'IZAO-MEN-001'),
      fila('C', 'texto tres.', 'XX-1'),
      fila('D', 'texto cuatro.', 'IZAO-MEN-004', '95000.50'),
      fila('E', 'texto cinco.', 'IZAO-MEN-005', '95000', 'SI'),
      fila('F', 'texto seis.', 'IZAO-MEN-006', '95000', 'NO', '0'),
      fila('', 'texto siete.', 'IZAO-MEN-007'),
    ]);
    expect(r.productos.map((p) => p.sku)).toEqual(['IZAO-MEN-001']);
    expect(r.problemas.map((p) => p.fila)).toEqual([3, 4, 5, 6, 7, 8]);
  });

  it('avisa si falta una columna', () => {
    expect(construirCarga([['Nombre_del_Producto*'], ['x']]).problemas.length).toBeGreaterThan(0);
  });

  it('ningún texto resultante conserva palabras prohibidas', () => {
    const r = construirCarga([ENC, fila('Perfume', 'Fragancia 100% original y auténtica con certificado. Notas dulces.', 'IZAO-WOM-010')]);
    expect(RE_PROHIBIDO_FINAL.test(r.productos[0]!.descripcionHtml)).toBe(false);
    expect(r.productos[0]!.descripcionHtml).toBe('<p>Notas dulces.</p>');
  });
});

describe('SQL generado', () => {
  const { productos } = construirCarga([ENC, fila("L'Eau d'Or", "Notas de 'vainilla'. Ideal para ti.", 'IZAO-WOM-003', '135000', 'NO', '1')]);

  it('la carga es idempotente por SKU, solo CO, stock 0, sin visibilidad y sin borrar', () => {
    const sql = sqlCarga(productos);
    expect(sql).toContain("where not exists (select 1 from public.product_variants v where v.sku = c.sku)");
    expect(sql).toContain("select n.pid, 'CO', false from _nuevos n");
    expect(sql).toContain("select v.id, 'CO', true, n.precio_co, 0");
    expect(sql).toContain('on conflict do nothing');
    expect(sql).not.toMatch(/\bdelete\b|\btruncate\b|\bdrop table public/i);
    expect(sql).not.toContain("'EC'");
    expect(sql).toContain("'L''Eau d''Or'");
    expect(sql).toContain('135000');
    expect(sql).toContain('begin;');
    expect(sql).toContain('commit;');
  });

  it('el archivado conserva el estado anterior, no borra y solo toca productos del seed', () => {
    const a = sqlArchivarSeed();
    expect(a).toContain("'estado_anterior', s.estado_anterior");
    expect(a).toContain("v.sku !~ '^IZ-[0-9]+-'");
    expect(a).not.toMatch(/\bdelete\b|\btruncate\b/i);
    const r = sqlRestaurarSeed();
    expect(r).toContain("attributes - 'archivado_por_carga_real'");
    expect(r).not.toMatch(/\bdelete\b|\btruncate\b/i);
  });

  it('la publicación exige vínculo MasterShop y no publica borradores', () => {
    const p = sqlPublicarCo();
    expect(p).toContain('v.mastershop_product_id is null');
    expect(p).toContain("p.status = 'active'");
    expect(p).toContain("pc.country_code = 'CO'");
  });

  it('literal escapa comillas y devuelve null', () => {
    expect(literal("a'b")).toBe("'a''b'");
    expect(literal(null)).toBe('null');
  });
});
