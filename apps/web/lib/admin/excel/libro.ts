/**
 * Libro de Excel (.xlsx) de varias hojas, sin dependencias (un .xlsx es un ZIP con XML; ver
 * `catalogo/xlsx.ts`). Los montos salen como números con formato de moneda —no como texto— y se escriben desde su
 * representación decimal exacta (`toDecimalString`), sin pasar por `float` (regla 1). Encabezados en negrita y
 * congelados, filtros automáticos y anchos de columna.
 */
import { CURRENCY_EXPONENT, money, toDecimalString, type CurrencyCode } from '@izao/core/money';
import { indiceAColumna } from '../catalogo/xlsx';
import { crearZip } from '../catalogo/zip';

export type Celda =
  | string
  | null
  | { tipo: 'monto'; valor: bigint; moneda: CurrencyCode }
  | { tipo: 'entero'; valor: number | bigint }
  /** Razón en puntos básicos (1250n = 12,5 %); `null` queda vacía. */
  | { tipo: 'bp'; valor: bigint | null };

export type Hoja = {
  nombre: string;
  columnas: readonly { titulo: string; ancho?: number }[];
  filas: readonly (readonly Celda[])[];
};

/** Índices de `cellXfs` en `styles.xml`. */
const ESTILO = { encabezado: 1, entero: 2, cop: 3, usd: 4, pct: 5 } as const;

function escapar(texto: string): string {
  return texto
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Evita que Excel interprete texto del usuario como fórmula (`=`, `+`, `-`, `@`): se antepone una comilla
 * tipográfica invisible para el cálculo. Los números van como celdas numéricas, no pasan por aquí.
 */
export function textoSeguro(valor: string): string {
  return /^[=+\-@\t\r]/.test(valor) ? `'${valor}` : valor;
}

/** Fracción decimal exacta de puntos básicos: `1250n` → `0.1250`; `-5n` → `-0.0005`. */
export function bpAFraccion(bp: bigint): string {
  const neg = bp < 0n;
  const abs = (neg ? -bp : bp).toString().padStart(5, '0');
  return `${neg ? '-' : ''}${abs.slice(0, abs.length - 4)}.${abs.slice(-4)}`;
}

function xmlCelda(ref: string, celda: Celda): string {
  if (celda === null) return '';
  if (typeof celda === 'string') {
    return celda === '' ? '' : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapar(textoSeguro(celda))}</t></is></c>`;
  }
  switch (celda.tipo) {
    case 'monto': {
      const estilo = CURRENCY_EXPONENT[celda.moneda] === 0 ? ESTILO.cop : ESTILO.usd;
      return `<c r="${ref}" s="${estilo}"><v>${toDecimalString(money(celda.valor, celda.moneda))}</v></c>`;
    }
    case 'entero':
      return `<c r="${ref}" s="${ESTILO.entero}"><v>${celda.valor.toString()}</v></c>`;
    case 'bp':
      return celda.valor === null ? '' : `<c r="${ref}" s="${ESTILO.pct}"><v>${bpAFraccion(celda.valor)}</v></c>`;
  }
}

function nombreHojaSeguro(nombre: string, usados: Set<string>): string {
  const base = nombre.replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Hoja';
  let candidato = base;
  for (let n = 2; usados.has(candidato.toLowerCase()); n += 1) candidato = `${base.slice(0, 31 - String(n).length - 1)} ${n}`;
  usados.add(candidato.toLowerCase());
  return candidato;
}

function xmlHoja(h: Hoja): string {
  const encabezado = `<row r="1">${h.columnas
    .map((c, j) => `<c r="${indiceAColumna(j)}1" s="${ESTILO.encabezado}" t="inlineStr"><is><t>${escapar(c.titulo)}</t></is></c>`)
    .join('')}</row>`;
  const cuerpo = h.filas
    .map((fila, i) => `<row r="${i + 2}">${fila.map((c, j) => xmlCelda(`${indiceAColumna(j)}${i + 2}`, c)).join('')}</row>`)
    .join('');
  const anchos = h.columnas.map((c, j) => `<col min="${j + 1}" max="${j + 1}" width="${c.ancho ?? 16}" customWidth="1"/>`).join('');
  const ultima = `${indiceAColumna(Math.max(h.columnas.length - 1, 0))}${h.filas.length + 1}`;
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<cols>${anchos}</cols><sheetData>${encabezado}${cuerpo}</sheetData>` +
    (h.columnas.length > 0 ? `<autoFilter ref="A1:${ultima}"/>` : '') +
    `</worksheet>`
  );
}

const ESTILOS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<numFmts count="3"><numFmt numFmtId="164" formatCode="&quot;$&quot;\\ #,##0"/><numFmt numFmtId="165" formatCode="&quot;$&quot;\\ #,##0.00"/><numFmt numFmtId="166" formatCode="0.00%"/></numFmts>` +
  `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
  `<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEFE6DA"/></patternFill></fill></fills>` +
  `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="6">` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>` +
  `<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `</cellXfs></styleSheet>`;

/** Crea el libro. Al menos una hoja; los nombres se sanean (≤ 31 caracteres, sin `[]:*?/\`, únicos). */
export function crearLibroXlsx(hojas: readonly Hoja[]): Buffer {
  if (hojas.length === 0) throw new RangeError('Un libro necesita al menos una hoja.');
  const usados = new Set<string>();
  const nombres = hojas.map((h) => nombreHojaSeguro(h.nombre, usados));
  const cabecera = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const libro =
    `${cabecera}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>` +
    nombres.map((n, i) => `<sheet name="${escapar(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
    `</sheets></workbook>`;
  const relsLibro =
    `${cabecera}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    hojas
      .map((_h, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
      .join('') +
    `<Relationship Id="rId${hojas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const rels = `${cabecera}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const tipos =
    `${cabecera}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    hojas
      .map((_h, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
      .join('') +
    `</Types>`;
  const e = (nombre: string, texto: string) => ({ nombre, datos: Buffer.from(texto, 'utf8') });
  return crearZip([
    e('[Content_Types].xml', tipos),
    e('_rels/.rels', rels),
    e('xl/workbook.xml', libro),
    e('xl/_rels/workbook.xml.rels', relsLibro),
    e('xl/styles.xml', ESTILOS),
    ...hojas.map((h, i) => e(`xl/worksheets/sheet${i + 1}.xml`, xmlHoja(h))),
  ]);
}

export const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
