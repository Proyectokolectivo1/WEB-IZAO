/**
 * Página de prueba para el botón "Imprimir página de prueba" (§15.5): PDF mínimo válido de 4 × 6 pulgadas con
 * Helvetica (WinAnsi) y la fecha, generado sin dependencias. Solo texto ASCII o Latin-1 escapado.
 */

function escaparPdf(texto: string): string {
  let r = '';
  for (const ch of texto) {
    const c = ch.codePointAt(0)!;
    if (ch === '(' || ch === ')' || ch === '\\') r += `\\${ch}`;
    else if (c >= 32 && c < 127) r += ch;
    else if (c >= 160 && c <= 255) r += `\\${c.toString(8).padStart(3, '0')}`;
    else r += '?';
  }
  return r;
}

export function pdfPaginaPrueba(lineas: readonly string[]): Uint8Array {
  const contenido = [
    'BT',
    '/F1 16 Tf',
    '24 400 Td',
    '20 TL',
    ...lineas.map((l, i) => `${i === 0 ? '' : 'T* '}(${escaparPdf(l)}) Tj`),
    'ET',
    '2 w 12 12 264 408 re S',
  ].join('\n');
  const objetos = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 288 432] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Length ${contenido.length} >>\nstream\n${contenido}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objetos.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  // Todo el texto es ASCII (los acentos van escapados en octal), así que cada carácter es un byte.
  return new TextEncoder().encode(pdf);
}
