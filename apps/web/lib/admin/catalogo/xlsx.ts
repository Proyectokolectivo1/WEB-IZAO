/**
 * Lectura y escritura mínima de hojas .xlsx (una tabla de texto), sin dependencias: un .xlsx es un ZIP con XML.
 * Lee la primera hoja (cadenas compartidas, cadenas en línea, números, booleanos). Escribe cadenas en línea,
 * que Excel, LibreOffice y Google Sheets abren sin problema.
 */
import { ErrorZip, crearZip, leerZip } from './zip';

const LIMITES = { maxEntradas: 200, maxBytesEntrada: 40 * 1024 * 1024, maxBytesTotal: 80 * 1024 * 1024 };
export const MAX_COLUMNAS = 200;

export class ErrorXlsx extends Error {}

function descodificar(texto: string): string {
  return texto.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_m, e: string) => {
    const k = e.toLowerCase();
    if (k === 'amp') return '&';
    if (k === 'lt') return '<';
    if (k === 'gt') return '>';
    if (k === 'quot') return '"';
    if (k === 'apos') return "'";
    const n = k.startsWith('#x') ? Number.parseInt(k.slice(2), 16) : Number.parseInt(k.slice(1), 10);
    return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
  });
}

function escapar(texto: string): string {
  return texto
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** `A` -> 0, `AB` -> 27. */
export function columnaAIndice(letras: string): number {
  let n = 0;
  for (const c of letras.toUpperCase()) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

export function indiceAColumna(indice: number): string {
  let n = indice + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function textosEn(xml: string): string {
  // Concatena los <t>; ignora los <rPh> (lectura fonética).
  const sinFonetica = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  let salida = '';
  for (const m of sinFonetica.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) salida += descodificar(m[1] ?? '');
  return salida;
}

function numeroATexto(crudo: string): string {
  const v = crudo.trim();
  if (/e/i.test(v)) {
    const n = Number(v);
    if (Number.isFinite(n) && Number.isSafeInteger(n)) return String(n);
  }
  return v;
}

/** Lee la primera hoja como tabla de texto. Las filas vacías se conservan como `[]`. */
export function leerXlsx(buffer: Buffer): string[][] {
  let archivos;
  try {
    archivos = leerZip(buffer, LIMITES);
  } catch (e) {
    throw new ErrorXlsx(e instanceof ErrorZip ? 'El archivo de Excel está dañado o no es .xlsx.' : 'No se pudo leer el archivo de Excel.');
  }
  const por = new Map(archivos.map((a) => [a.nombre.replace(/^\/+/, ''), a.datos.toString('utf8')]));

  let rutaHoja = 'xl/worksheets/sheet1.xml';
  const libro = por.get('xl/workbook.xml');
  const rels = por.get('xl/_rels/workbook.xml.rels');
  if (libro && rels) {
    const rid = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(libro)?.[1];
    if (rid) {
      for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
        const etiqueta = m[0];
        if (new RegExp(`\\bId="${rid.replace(/[^\w]/g, '')}"`).test(etiqueta)) {
          const destino = /\bTarget="([^"]+)"/.exec(etiqueta)?.[1];
          if (destino) rutaHoja = destino.startsWith('/') ? destino.slice(1) : `xl/${destino.replace(/^\.\//, '')}`;
        }
      }
    }
  }
  const hoja = por.get(rutaHoja);
  if (!hoja) throw new ErrorXlsx('No se encontró ninguna hoja en el archivo de Excel.');

  const compartidas: string[] = [];
  const xmlCompartidas = por.get('xl/sharedStrings.xml');
  if (xmlCompartidas) {
    for (const m of xmlCompartidas.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) compartidas.push(textosEn(m[1] ?? ''));
  }

  const filas: string[][] = [];
  let numeroFila = 0;
  for (const fila of hoja.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const r = /\br="(\d+)"/.exec(fila[1] ?? '')?.[1];
    numeroFila = r ? Number(r) : numeroFila + 1;
    if (numeroFila > 100_000) throw new ErrorXlsx('La hoja tiene demasiadas filas.');
    const celdas: string[] = [];
    let siguiente = 0;
    for (const c of (fila[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const atributos = c[1] ?? '';
      const ref = /\br="([A-Za-z]+)\d+"/.exec(atributos)?.[1];
      const col = ref ? columnaAIndice(ref) : siguiente;
      if (col >= MAX_COLUMNAS) continue;
      siguiente = col + 1;
      const tipo = /\bt="([^"]+)"/.exec(atributos)?.[1] ?? 'n';
      const cuerpo = c[2] ?? '';
      let valor = '';
      if (tipo === 'inlineStr') valor = textosEn(cuerpo);
      else {
        const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(cuerpo)?.[1];
        if (v !== undefined) {
          if (tipo === 's') valor = compartidas[Number(v)] ?? '';
          else if (tipo === 'b') valor = v.trim() === '1' ? 'sí' : 'no';
          else if (tipo === 'str' || tipo === 'e') valor = descodificar(v);
          else valor = numeroATexto(v);
        }
      }
      while (celdas.length < col) celdas.push('');
      celdas[col] = valor;
    }
    while (filas.length < numeroFila - 1) filas.push([]);
    filas[numeroFila - 1] = celdas;
  }
  return filas;
}

/** Crea un .xlsx de una hoja. Todo se guarda como texto para no perder ceros a la izquierda ni decimales. */
export function crearXlsx(filas: readonly (readonly string[])[], nombreHoja = 'Productos'): Buffer {
  const xmlFilas = filas
    .map((fila, i) => {
      const celdas = fila
        .map((valor, j) =>
          valor === ''
            ? ''
            : `<c r="${indiceAColumna(j)}${i + 1}" t="inlineStr"><is><t xml:space="preserve">${escapar(valor)}</t></is></c>`,
        )
        .join('');
      return `<row r="${i + 1}">${celdas}</row>`;
    })
    .join('');
  const hoja = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>${xmlFilas}</sheetData></worksheet>`;
  const libro = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${escapar(nombreHoja.slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const relsLibro = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const tipos = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;
  const e = (nombre: string, texto: string) => ({ nombre, datos: Buffer.from(texto, 'utf8') });
  return crearZip([
    e('[Content_Types].xml', tipos),
    e('_rels/.rels', rels),
    e('xl/workbook.xml', libro),
    e('xl/_rels/workbook.xml.rels', relsLibro),
    e('xl/worksheets/sheet1.xml', hoja),
  ]);
}
