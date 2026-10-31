/**
 * Entorno compartido de las pruebas e2e.
 *
 * Los valores de Supabase son de PRUEBA y apuntan a un servidor falso local
 * (`supabase-falso.mjs`): las pruebas nunca llaman a Supabase real ni a ningún
 * proveedor. Los pone `playwright.config.ts` en el proceso de `next start`; tienen
 * prioridad sobre cualquier `.env.local`.
 */
import path from 'node:path';

export const PUERTO_WEB = Number(process.env.E2E_PUERTO_WEB ?? 3100);
export const PUERTO_SUPABASE_FALSO = Number(process.env.E2E_PUERTO_SUPABASE ?? 54399);

export const URL_WEB = `http://127.0.0.1:${PUERTO_WEB}`;
export const URL_SUPABASE_FALSO = `http://127.0.0.1:${PUERTO_SUPABASE_FALSO}`;

/** Raíz de `apps/web` (donde está `.next`). */
export const RAIZ_WEB = path.resolve(__dirname, '../..');
/**
 * `STORE_DATOS=ejemplo`: pruebas sin llaves. Se sirve la copia construida por `preparar-build-ejemplo.mjs`
 * (apps/.e2e-web), que usa los datos de ejemplo de la tienda; las expectativas salen de ahí (`support/semilla.ts`).
 */
export const MODO_EJEMPLO = process.env.STORE_DATOS === 'ejemplo';
/** Carpeta desde la que se sirve la tienda (`next start`) y donde está el build. */
export const DIR_SERVIDOR = process.env.E2E_DIR_SERVIDOR ?? (MODO_EJEMPLO ? path.resolve(RAIZ_WEB, '../.e2e-web') : RAIZ_WEB);
/** Raíz del monorepo. */
export const RAIZ_REPO = path.resolve(RAIZ_WEB, '../..');
/** Salidas locales (ignoradas por git). */
export const DIR_RESULTADOS = path.resolve(__dirname, '../.resultados');

/** Clave maestra de prueba: 32 bytes en base64, derivada de una frase fija. No es un secreto. */
const CLAVE_DE_PRUEBA = Buffer.alloc(32, 'izao-e2e').toString('base64');

/** Variables que recibe el servidor de la tienda durante las pruebas. */
export function entornoDePrueba(): Record<string, string> {
  return {
    NODE_ENV: 'production',
    NEXT_TELEMETRY_DISABLED: '1',
    SUPABASE_URL: URL_SUPABASE_FALSO,
    SUPABASE_PUBLISHABLE_KEY: 'llave-publica-de-prueba',
    SUPABASE_SECRET_KEY: 'llave-de-servicio-de-prueba',
    APP_ENCRYPTION_KEY: CLAVE_DE_PRUEBA,
    ...(MODO_EJEMPLO ? { STORE_DATOS: 'ejemplo', NEXT_PUBLIC_STORE_DATOS: 'ejemplo' } : {}),
  };
}

export const PAISES = ['co', 'ec'] as const;
export type Pais = (typeof PAISES)[number];

/** Tamaño de lote del listado (§7.1). */
export const TAMANO_LOTE = 25;
/** Productos visibles por país en los datos de prueba (§30 F1). */
export const VISIBLES_POR_PAIS = 400;
