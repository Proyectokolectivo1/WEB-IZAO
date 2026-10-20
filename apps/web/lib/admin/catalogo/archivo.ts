/** Lectura de archivos subidos (CSV o Excel) y armado de descargas del catálogo. Código puro. */
import { aCsv, parsearCsv } from './csv';
import { ErrorXlsx, crearXlsx, leerXlsx } from './xlsx';

export const MAX_BYTES_TABLA = 10 * 1024 * 1024;
export const FORMATOS = ['csv', 'xlsx'] as const;
export type Formato = (typeof FORMATOS)[number];

export class ErrorArchivo extends Error {}

export function leerTablaDeArchivo(nombre: string, buffer: Buffer): string[][] {
  if (buffer.length === 0) throw new ErrorArchivo('El archivo está vacío.');
  if (buffer.length > MAX_BYTES_TABLA) throw new ErrorArchivo('El archivo supera los 10 MB. Divídelo en partes.');
  const n = nombre.toLowerCase();
  try {
    if (n.endsWith('.xlsx')) return leerXlsx(buffer);
    if (n.endsWith('.csv') || n.endsWith('.txt')) return parsearCsv(buffer.toString('utf8'));
  } catch (e) {
    throw new ErrorArchivo(e instanceof ErrorXlsx || e instanceof Error ? e.message : 'No se pudo leer el archivo.');
  }
  throw new ErrorArchivo('Formato no soportado: sube un archivo .csv o .xlsx.');
}

export function formatoDe(valor: string | null): Formato {
  return valor === 'xlsx' ? 'xlsx' : 'csv';
}

export function descargaTabla(
  filas: readonly (readonly string[])[],
  formato: Formato,
  base: string,
): { cuerpo: Buffer; tipo: string; nombre: string } {
  if (formato === 'xlsx') {
    return {
      cuerpo: crearXlsx(filas),
      tipo: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      nombre: `${base}.xlsx`,
    };
  }
  return { cuerpo: Buffer.from(aCsv(filas), 'utf8'), tipo: 'text/csv; charset=utf-8', nombre: `${base}.csv` };
}
