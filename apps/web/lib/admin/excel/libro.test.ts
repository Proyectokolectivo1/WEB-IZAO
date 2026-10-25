import { describe, expect, it } from 'vitest';
import { leerZip } from '../catalogo/zip';
import { leerXlsx } from '../catalogo/xlsx';
import { bpAFraccion, crearLibroXlsx, textoSeguro } from './libro';

function entradas(buffer: Buffer): Map<string, string> {
  return new Map(leerZip(buffer, { maxEntradas: 50, maxBytesEntrada: 10_000_000, maxBytesTotal: 20_000_000 }).map((e) => [e.nombre, e.datos.toString('utf8')]));
}

describe('crearLibroXlsx', () => {
  const libro = crearLibroXlsx([
    {
      nombre: 'Resumen',
      columnas: [{ titulo: 'Concepto', ancho: 30 }, { titulo: 'Valor' }],
      filas: [
        ['Ventas brutas', { tipo: 'monto', valor: 1_234_567n, moneda: 'COP' }],
        ['Ventas en USD', { tipo: 'monto', valor: 9982n, moneda: 'USD' }],
        ['Margen', { tipo: 'bp', valor: 1250n }],
        ['Sin dato', { tipo: 'bp', valor: null }],
        ['Pedidos', { tipo: 'entero', valor: 42 }],
        ['=CMD()', null],
      ],
    },
    { nombre: 'Resumen', columnas: [{ titulo: 'A' }], filas: [] },
    { nombre: 'Gastos/[x]', columnas: [{ titulo: 'A' }], filas: [['hola']] },
  ]);

  it('escribe los montos como números exactos con formato de moneda, sin pasar por float', () => {
    const e = entradas(libro);
    const hoja = e.get('xl/worksheets/sheet1.xml') ?? '';
    expect(hoja).toContain('<v>1234567</v>');
    expect(hoja).toContain('<v>99.82</v>');
    expect(hoja).toContain('<v>0.1250</v>');
    expect(hoja).toContain('<v>42</v>');
    // La celda sin dato no se escribe.
    expect(hoja).not.toContain('Sin dato</t></is></c><c');
  });

  it('declara los formatos, congela el encabezado y activa filtros', () => {
    const e = entradas(libro);
    expect(e.get('xl/styles.xml')).toContain('0.00%');
    const hoja = e.get('xl/worksheets/sheet1.xml') ?? '';
    expect(hoja).toContain('state="frozen"');
    expect(hoja).toContain('<autoFilter ref="A1:B7"/>');
    expect(hoja).toContain('<col min="1" max="1" width="30" customWidth="1"/>');
  });

  it('sanea y deduplica los nombres de hoja', () => {
    const libroXml = entradas(libro).get('xl/workbook.xml') ?? '';
    expect(libroXml).toContain('name="Resumen"');
    expect(libroXml).toContain('name="Resumen 2"');
    expect(libroXml).toContain('name="Gastos  x"');
    expect(entradas(libro).has('xl/worksheets/sheet3.xml')).toBe(true);
  });

  it('la primera hoja se puede volver a leer', () => {
    const filas = leerXlsx(libro);
    expect(filas[0]).toEqual(['Concepto', 'Valor']);
    expect(filas[1]?.[0]).toBe('Ventas brutas');
    expect(filas[1]?.[1]).toBe('1234567');
  });

  it('neutraliza fórmulas en texto', () => {
    expect(textoSeguro('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(textoSeguro('+57 300')).toBe("'+57 300");
    expect(textoSeguro('Ana')).toBe('Ana');
    expect(entradas(libro).get('xl/worksheets/sheet1.xml')).toContain("&apos;=CMD()".replace('&apos;', "'"));
  });

  it('una fracción de puntos básicos es exacta', () => {
    expect(bpAFraccion(1250n)).toBe('0.1250');
    expect(bpAFraccion(5n)).toBe('0.0005');
    expect(bpAFraccion(-5n)).toBe('-0.0005');
    expect(bpAFraccion(10000n)).toBe('1.0000');
  });

  it('exige al menos una hoja', () => {
    expect(() => crearLibroXlsx([])).toThrow();
  });
});
