/**
 * Vista previa de la vinculación por SKU (solo lectura). Escribe en `--salida`:
 * - `vista-previa.json`: clasificación completa (nuevas, sin cambio, conflictos, sin equivalente, sugerencias).
 * - `vinculacion.sql`: `UPDATE` idempotente de las nuevas, para que el dueño lo apruebe y lo ejecute.
 *
 * Uso (desde `apps/worker`, sin imprimir secretos):
 *   pnpm exec tsx --env-file=<archivo .env> src/jobs/sync/vinculacion-productos.cli.ts --salida <carpeta>
 * Variables: SUPABASE_URL, SUPABASE_SECRET_KEY, APP_ENCRYPTION_KEY.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { sqlVinculacion } from '@izao/mastershop';
import { crearFuenteVinculacionPostgrest, vistaPreviaVinculacion } from './vinculacion-productos.js';

function requerida(nombre: string): string {
  const v = process.env[nombre];
  if (v === undefined || v.trim() === '') throw new Error(`Falta la variable ${nombre}.`);
  return v.trim();
}

async function main(): Promise<void> {
  const i = process.argv.indexOf('--salida');
  const salida = resolve(i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : '.');
  mkdirSync(salida, { recursive: true });

  const fuente = crearFuenteVinculacionPostgrest({
    supabaseUrl: requerida('SUPABASE_URL'),
    secretKey: requerida('SUPABASE_SECRET_KEY'),
    claveCifrado: requerida('APP_ENCRYPTION_KEY'),
  });
  const { vista } = await vistaPreviaVinculacion({ fuente });
  const ahora = new Date();
  writeFileSync(join(salida, 'vista-previa.json'), JSON.stringify(vista, null, 1));
  const sql = sqlVinculacion(vista, ahora);
  if (sql !== null) writeFileSync(join(salida, 'vinculacion.sql'), sql);

  const t = vista.totales;
  console.log(
    [
      `Variantes Izao: ${t.variantesIzao} · productos MasterShop: ${t.productosMasterShop} (${t.variantesMasterShop} variantes)`,
      `Nuevas por SKU: ${t.nuevas} · sin cambio: ${t.sinCambio} · conflictos: ${t.conflictos} · sin equivalente: ${t.sinEquivalente}`,
      `Sugerencias por nombre: ${vista.sugerenciasPorNombre.length} · SKU ambiguos: ${vista.skuAmbiguos.length} · deshabilitadas en MasterShop: ${vista.deshabilitadasEnMasterShop.length}`,
      `MasterShop sin usar: ${vista.masterShopSinUsar.length}`,
      sql === null ? 'Sin SQL: no hay variantes nuevas que vincular.' : `SQL: ${join(salida, 'vinculacion.sql')}`,
    ].join('\n'),
  );
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : 'Error inesperado.');
  process.exitCode = 1;
});
