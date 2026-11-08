/**
 * Vinculación por SKU por país (D-050, D-052). Cada país usa su propia llave de MasterShop. Escribe en `--salida`,
 * por país (`<salida>/<PAIS>/`):
 * - `vista-previa.json`: clasificación completa (nuevas, sin cambio, conflictos, sin equivalente, sugerencias).
 * - `vinculacion.sql`: `UPDATE` idempotente de `variant_countries` del país, para revisarlo y ejecutarlo.
 * Con `--aplicar` además escribe las nuevas en `variant_countries` (solo filas del país sin vínculo). Sin esa
 * bandera solo lee.
 *
 * Uso (desde `apps/worker`, sin imprimir secretos):
 *   pnpm exec tsx --env-file=<archivo .env> src/jobs/sync/vinculacion-productos.cli.ts --salida <carpeta> [--pais CO|EC] [--aplicar]
 * Variables: SUPABASE_URL, SUPABASE_SECRET_KEY, APP_ENCRYPTION_KEY.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { CountryCode } from '@izao/core/money';
import { sqlVinculacion } from '@izao/mastershop';
import { crearFuenteVinculacionPostgrest, vinculacionPorPais } from './vinculacion-productos.js';

const PAISES: readonly CountryCode[] = ['CO', 'EC'];

function requerida(nombre: string): string {
  const v = process.env[nombre];
  if (v === undefined || v.trim() === '') throw new Error(`Falta la variable ${nombre}.`);
  return v.trim();
}

function argumento(nombre: string): string | null {
  const i = process.argv.indexOf(nombre);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : null;
}

async function main(): Promise<void> {
  const salida = resolve(argumento('--salida') ?? '.');
  const pais = argumento('--pais');
  if (pais !== null && !PAISES.includes(pais as CountryCode)) throw new Error('--pais debe ser CO o EC.');
  const paises = pais === null ? PAISES : [pais as CountryCode];
  const aplicar = process.argv.includes('--aplicar');

  const fuente = crearFuenteVinculacionPostgrest({
    supabaseUrl: requerida('SUPABASE_URL'),
    secretKey: requerida('SUPABASE_SECRET_KEY'),
    claveCifrado: requerida('APP_ENCRYPTION_KEY'),
  });
  const resultados = await vinculacionPorPais({ fuente }, { paises, aplicar });
  const ahora = new Date();
  const lineas: string[] = [];
  for (const p of paises) {
    const r = resultados[p];
    if (!r || r.accion === 'sin_credenciales') {
      lineas.push(`${p}: sin llave activa de MasterShop (se omite).`);
      continue;
    }
    if (r.accion === 'error') {
      lineas.push(`${p}: error (${r.error}).`);
      process.exitCode = 1;
      continue;
    }
    const dir = join(salida, p);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'vista-previa.json'), JSON.stringify(r.vista, null, 1));
    const sql = sqlVinculacion(r.vista, ahora, p === 'EC' ? 'EC' : 'CO');
    if (sql !== null) writeFileSync(join(dir, 'vinculacion.sql'), sql);
    const t = r.vista.totales;
    lineas.push(
      `${p}: variantes ${t.variantesIzao} · productos MasterShop ${t.productosMasterShop} (${t.variantesMasterShop} variantes)`,
      `    nuevas ${t.nuevas} · sin cambio ${t.sinCambio} · conflictos ${t.conflictos} · sin equivalente ${t.sinEquivalente}`,
      `    sugerencias por nombre ${r.vista.sugerenciasPorNombre.length} · SKU ambiguos ${r.vista.skuAmbiguos.length} · MasterShop sin usar ${r.vista.masterShopSinUsar.length}`,
      r.accion === 'aplicado'
        ? `    aplicado: ${r.vinculadas} variantes vinculadas en variant_countries (${p}).`
        : sql === null
          ? '    sin SQL: no hay variantes nuevas que vincular.'
          : `    SQL: ${join(dir, 'vinculacion.sql')}`,
    );
  }
  console.log(lineas.join('\n'));
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : 'Error inesperado.');
  process.exitCode = 1;
});
