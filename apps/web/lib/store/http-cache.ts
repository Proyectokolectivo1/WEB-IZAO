import { createHash } from 'node:crypto';

/** Políticas de caché de las lecturas públicas del catálogo (ventanas alineadas con `VIGENCIA` de `fetcher.ts`). */
export const CACHE_CATALOGO = {
  /** Listado y conteo: el navegador reutiliza 30 s; el servidor intermedio, 60 s y sirve viejo mientras revalida. */
  listado: 'public, max-age=30, s-maxage=60, stale-while-revalidate=120',
  /** Ficha y relacionados. */
  ficha: 'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
} as const;

/** ETag débil del contenido: dos respuestas iguales dan la misma etiqueta. */
export function etagDe(texto: string): string {
  return `W/"${createHash('sha1').update(texto).digest('base64url').slice(0, 27)}"`;
}

function coincide(cabecera: string | null, etag: string): boolean {
  if (!cabecera) return false;
  if (cabecera.trim() === '*') return true;
  const sinDebil = (v: string) => v.trim().replace(/^W\//, '');
  return cabecera.split(',').some((v) => sinDebil(v) === sinDebil(etag));
}

/**
 * JSON con `Cache-Control` y `ETag`; si la petición trae `If-None-Match` con la misma etiqueta responde 304 sin cuerpo
 * (el navegador revalida barato en vez de volver a bajar el lote entero).
 */
export function jsonCacheable(req: Request, cuerpo: unknown, cacheControl: string): Response {
  const texto = JSON.stringify(cuerpo);
  const etag = etagDe(texto);
  const base = { 'Cache-Control': cacheControl, ETag: etag, Vary: 'Accept-Encoding' };
  if (coincide(req.headers.get('if-none-match'), etag)) return new Response(null, { status: 304, headers: base });
  return new Response(texto, { status: 200, headers: { ...base, 'Content-Type': 'application/json' } });
}
