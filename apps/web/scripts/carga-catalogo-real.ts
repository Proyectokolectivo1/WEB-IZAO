/**
 * Prepara la carga del catálogo real desde el Excel de MasterShop. SOLO LEE el Excel y ESCRIBE archivos locales:
 * no se conecta a ninguna base. Lo aplica el dueño o el líder, revisando antes la vista previa.
 *
 * Uso (desde apps/web):
 *   pnpm exec tsx scripts/carga-catalogo-real.ts --xlsx "D:\MASTERShop_Carga_Productos_LISTA_PARA_SUBIR.xlsx" --salida scripts/carga-catalogo-real
 *
 * Salida: vista-previa.md, 01-carga.sql, 02-archivar-seed.sql, 02b-restaurar-seed.sql, 03-publicar-co.sql
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { leerXlsx } from '../lib/admin/catalogo/xlsx';
import { construirCarga, resumen, sqlArchivarSeed, sqlCarga, sqlPublicarCo, sqlRestaurarSeed, vistaPreviaMarkdown } from '../lib/admin/catalogo/carga-real';

/** Fila de ejemplo de la plantilla: repite «Devotion» (que ya es IZAO-WOM-001) y queda fuera del rango 001–100. */
const BORRADORES = {
  'IZAO-MEN-101': 'fila de ejemplo de la plantilla: duplica a IZAO-WOM-001; se carga como borrador hasta que el dueño decida',
} as const;

function argumento(nombre: string): string | undefined {
  const i = process.argv.indexOf(nombre);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const xlsx = argumento('--xlsx');
if (!xlsx) throw new Error('Falta --xlsx <ruta del Excel>.');
const salida = resolve(argumento('--salida') ?? '.');
mkdirSync(salida, { recursive: true });

const r = construirCarga(leerXlsx(readFileSync(xlsx)), { borradores: BORRADORES });
writeFileSync(join(salida, 'vista-previa.md'), vistaPreviaMarkdown(r), 'utf8');
if (r.problemas.length > 0) {
  console.error(`Hay ${r.problemas.length} filas con problemas: no se generó el SQL.`);
  console.error(JSON.stringify(r.problemas, null, 2));
  process.exit(1);
}
writeFileSync(join(salida, '01-carga.sql'), sqlCarga(r.productos), 'utf8');
writeFileSync(join(salida, '02-archivar-seed.sql'), sqlArchivarSeed(), 'utf8');
writeFileSync(join(salida, '02b-restaurar-seed.sql'), sqlRestaurarSeed(), 'utf8');
writeFileSync(join(salida, '03-publicar-co.sql'), sqlPublicarCo(), 'utf8');
console.log(JSON.stringify(resumen(r), null, 2));
