/** CSV (RFC 4180) con detección de delimitador (`,` `;` tabulador), BOM y saltos de línea de Windows. */

export const MAX_CELDAS = 2_000_000;

/** Delimitador más probable según la primera línea (fuera de comillas). */
export function detectarDelimitador(texto: string): string {
  let comillas = false;
  const cuentas: Record<string, number> = { ',': 0, ';': 0, '\t': 0 };
  for (const c of texto.slice(0, 20_000)) {
    if (c === '"') comillas = !comillas;
    else if (!comillas && c in cuentas) cuentas[c] = (cuentas[c] ?? 0) + 1;
    else if (!comillas && (c === '\n' || c === '\r')) break;
  }
  return (Object.entries(cuentas).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ',') as string;
}

/** Texto CSV -> filas de celdas. Ignora el BOM y las líneas totalmente vacías al final. */
export function parsearCsv(entrada: string): string[][] {
  const texto = entrada.charCodeAt(0) === 0xfeff ? entrada.slice(1) : entrada;
  const d = detectarDelimitador(texto);
  const filas: string[][] = [];
  let fila: string[] = [];
  let celda = '';
  let comillas = false;
  let celdas = 0;
  for (let i = 0; i < texto.length; i += 1) {
    const c = texto[i] as string;
    if (comillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          celda += '"';
          i += 1;
        } else comillas = false;
      } else celda += c;
    } else if (c === '"' && celda === '') {
      comillas = true;
    } else if (c === d) {
      fila.push(celda);
      celda = '';
      celdas += 1;
      if (celdas > MAX_CELDAS) throw new Error('El archivo tiene demasiadas celdas.');
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i += 1;
      fila.push(celda);
      filas.push(fila);
      fila = [];
      celda = '';
    } else celda += c;
  }
  if (celda !== '' || fila.length > 0) {
    fila.push(celda);
    filas.push(fila);
  }
  while (filas.length > 0 && filas[filas.length - 1]!.every((x) => x.trim() === '')) filas.pop();
  return filas;
}

/** Filas -> CSV con coma, comillas cuando hace falta y BOM para que Excel lea las tildes. */
export function aCsv(filas: readonly (readonly string[])[]): string {
  const celda = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return String.fromCharCode(0xfeff) + filas.map((f) => f.map(celda).join(',')).join('\r\n') + '\r\n';
}
