// Lista (SOLO LECTURA, no borra nada) los archivos de MEDIA_ROOT sin fila en la base.
// Se ejecuta dentro del contenedor del worker (tiene MEDIA_ROOT, SUPABASE_URL y SUPABASE_SECRET_KEY):
//   bash infra/scripts/media-huerfanos.sh
// Archivo "referenciado" = base_path o valor de `variants` de public.media, o de public.media_file_deletions
// (esos últimos los borra el worker solo). Se escanean solo kinds públicos; warranty/, labels/ y agent-screenshots/
// pertenecen a otros módulos y se cuentan aparte sin evaluarlos. Los .tmp de más de 1 h se listan como "temporales".
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const RAIZ = path.resolve(process.env.MEDIA_ROOT || '/srv/izao/media');
const URL_BASE = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const CLAVE = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
if (!URL_BASE || !CLAVE) {
  console.error('Faltan SUPABASE_URL o SUPABASE_SECRET_KEY en el entorno del contenedor.');
  process.exit(2);
}
const PRIVADAS = new Set(['warranty', 'labels', 'agent-screenshots']);
const EDAD_TMP_MS = 3600_000;

async function leerTabla(tabla, columnas) {
  const filas = [];
  for (let desde = 0; ; desde += 1000) {
    const r = await fetch(`${URL_BASE}/rest/v1/${tabla}?select=${columnas}&order=id`, {
      headers: { apikey: CLAVE, authorization: `Bearer ${CLAVE}`, range: `${desde}-${desde + 999}` },
    });
    if (!r.ok) throw new Error(`${tabla}: HTTP ${r.status}`);
    const lote = await r.json();
    filas.push(...lote);
    if (lote.length < 1000) return filas;
  }
}

function rutasDe(fila) {
  const v = Object.values(fila.variants ?? {}).filter((x) => typeof x === 'string' && x);
  return [fila.base_path, ...v].filter(Boolean).map((p) => path.posix.normalize(String(p).replace(/^\/+/, '')));
}

async function recorrer(dir, rel = '') {
  const salida = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) salida.push(...(await recorrer(path.join(dir, e.name), r)));
    else if (e.isFile()) salida.push(r);
  }
  return salida;
}

const referenciadas = new Set();
const esperadas = new Set(); // solo variantes: base_path es un prefijo, no un archivo
for (const f of await leerTabla('media', 'id,base_path,variants')) {
  rutasDe(f).forEach((p) => referenciadas.add(p));
  rutasDe({ variants: f.variants }).forEach((p) => esperadas.add(p));
}
const pendientes = new Set();
for (const f of await leerTabla('media_file_deletions', 'id,base_path,variants')) rutasDe(f).forEach((p) => pendientes.add(p));

const huerfanos = [];
const temporales = [];
let privados = 0;
let bytes = 0;
let total = 0;
const ahora = Date.now();
for (const rel of await recorrer(RAIZ)) {
  if (PRIVADAS.has(rel.split('/')[0])) { privados++; continue; }
  total++;
  if (referenciadas.has(rel) || pendientes.has(rel)) continue;
  const s = await stat(path.join(RAIZ, rel));
  if (rel.endsWith('.tmp')) {
    if (ahora - s.mtimeMs > EDAD_TMP_MS) temporales.push({ rel, bytes: s.size });
    continue;
  }
  bytes += s.size;
  huerfanos.push({ rel, bytes: s.size, modificado: new Date(s.mtimeMs).toISOString() });
}
// Rutas en la base cuyo archivo no existe (informativo).
const enDisco = new Set(await recorrer(RAIZ));
const faltantes = [...esperadas].filter((p) => !enDisco.has(p));

console.log(`# Media huérfana (dry-run, nada se borró) — ${new Date().toISOString()}`);
console.log(`archivos públicos en disco: ${total} · referenciadas en base: ${referenciadas.size} · pendientes de borrado: ${pendientes.size} · privados no evaluados: ${privados}`);
console.log(`HUERFANOS: ${huerfanos.length} (${(bytes / 1048576).toFixed(2)} MiB)`);
for (const h of huerfanos) console.log(`  huerfano\t${h.bytes}\t${h.modificado}\t${h.rel}`);
console.log(`TEMPORALES > 1 h: ${temporales.length}`);
for (const t of temporales) console.log(`  temporal\t${t.bytes}\t${t.rel}`);
console.log(`EN BASE SIN ARCHIVO: ${faltantes.length} (informativo; se muestran 20; suelen ser datos de prueba del seed)`);
for (const p of faltantes.slice(0, 20)) console.log(`  faltante\t${p}`);
