import { NextResponse, type NextRequest } from 'next/server';
import { tienda } from '@/lib/store/datos';
import { TAMANO_LOTE, codificarCursor, decodificarCursor, parsearEstado } from '@/lib/store/filtros';
import { esPais } from '@/lib/store/pais';
import { CACHE_CATALOGO, jsonCacheable } from '@/lib/store/http-cache';

/**
 * `GET /api/catalog?country=co&cursor=…&orden=…&marca=…` (§7.1). Paginación keyset: el cursor es opaco (base64url).
 * Respuesta: `{ items, nextCursor, total, precioMin, precioMax }`. Los precios son enteros en unidad menor.
 */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const pais = p.get('country')?.toLowerCase();
  if (!esPais(pais)) return NextResponse.json({ error: 'pais' }, { status: 400 });

  const crudo = p.get('cursor');
  const cursor = crudo ? decodificarCursor(crudo) : null;
  if (crudo && !cursor) return NextResponse.json({ error: 'cursor' }, { status: 400 });

  const estado = parsearEstado(p);
  // `solo_total=1`: contador en vivo de los filtros (hoja móvil); no se manda la lista.
  const soloTotal = p.get('solo_total') === '1' && !cursor;
  try {
    const pagina = await tienda().catalogo(pais, {
      q: estado.q || undefined,
      filtros: estado.filtros,
      orden: estado.orden,
      cursor,
      limite: soloTotal ? 1 : TAMANO_LOTE,
      conTotal: !cursor,
    });
    return jsonCacheable(
      req,
      {
        items: soloTotal ? [] : pagina.items,
        nextCursor: soloTotal ? null : codificarCursor(pagina.next_cursor),
        total: pagina.total_estimado,
        precioMin: pagina.precio_min,
        precioMax: pagina.precio_max,
      },
      CACHE_CATALOGO.listado,
    );
  } catch {
    return NextResponse.json({ error: 'no-disponible' }, { status: 503 });
  }
}
