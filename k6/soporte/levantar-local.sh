#!/usr/bin/env bash
# Levanta la tienda local para las pruebas de carga: build de ejemplo (`pnpm --filter @izao/web build:e2e`) + Supabase falso.
# Nunca apunta a producción ni a Supabase real. Uso: bash k6/soporte/levantar-local.sh   (puertos 3110 web y 38398 falso)
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
mkdir -p "$RAIZ/k6/.resultados"
FALSO_PUERTO=38398 node "$RAIZ/k6/soporte/supabase-checkout-falso.mjs" > "$RAIZ/k6/.resultados/falso.log" 2>&1 &
cd "$RAIZ/apps/web"
NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 \
SUPABASE_URL=http://127.0.0.1:38398 SUPABASE_PUBLISHABLE_KEY=llave-publica-de-prueba SUPABASE_SECRET_KEY=llave-de-servicio-de-prueba \
APP_ENCRYPTION_KEY="$(node -e "process.stdout.write(Buffer.alloc(32,'izao-e2e').toString('base64'))")" \
NEXT_DIST_DIR=.next-ejemplo STORE_DATOS=ejemplo STORE_DATOS_PERMITIR_EJEMPLO=1 SITE_URL=http://127.0.0.1:3110 \
node ../../node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3110 > "$RAIZ/k6/.resultados/web.log" 2>&1 &
echo "web http://127.0.0.1:3110 · falso http://127.0.0.1:38398 (logs en k6/.resultados/)"
