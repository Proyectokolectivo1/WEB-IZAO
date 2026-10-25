import 'server-only';
/** Ayudas de servidor compartidas por los módulos CRUD del panel. */
import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';
import { ErrorSinPermiso, requerirAdmin, type ContextoAdmin } from '@/lib/auth/guard';
import type { AccionId, ModuloId } from '@/lib/auth/permissions';
import type { ErroresCampo, ResultadoAccion } from './comun';

export const PAISES = ['CO', 'EC'] as const;
export type Pais = (typeof PAISES)[number];

/** Invalida el catálogo público de los países indicados (§7: `catalog:{país}`). */
export function invalidarCatalogo(paises: readonly Pais[] = PAISES): void {
  for (const p of paises) revalidateTag(`catalog:${p}`);
}

/** Invalida la ficha de un producto (`product:{id}`) y los listados de los países. */
export function invalidarProducto(productId: string, paises: readonly Pais[] = PAISES): void {
  revalidateTag(`product:${productId}`);
  invalidarCatalogo(paises);
}

/**
 * Invalida el contenido público del país (`content:{país}`): páginas y políticas, tema, home. Es la etiqueta
 * que lee la tienda en `lib/store/repo-supabase.ts` (`leerLegal`, `leerPaginas`).
 */
export function invalidarContenido(paises: readonly Pais[] = PAISES): void {
  for (const p of paises) revalidateTag(`content:${p}`);
}

/**
 * Invalida la configuración de pagos y países que lee la tienda (métodos de pago, abono, recargo: etiqueta
 * `checkout-config`; anuncio y asesor: `content:{país}`).
 */
export function invalidarConfigPais(paises: readonly Pais[] = PAISES): void {
  revalidateTag('checkout-config');
  invalidarContenido(paises);
}

export type ErrorBd = { code?: string | undefined; message: string; details?: string | undefined };

/**
 * Traduce un error de Postgres/PostgREST a un mensaje para la persona. Los
 * detalles técnicos se registran en consola, nunca se muestran.
 */
export function traducirErrorBd(
  error: ErrorBd,
  campoUnico: Record<string, string> = {},
): { mensaje: string; errores?: ErroresCampo } {
  if (error.code === '23505') {
    const detalle = `${error.message} ${error.details ?? ''}`;
    for (const [columna, texto] of Object.entries(campoUnico)) {
      if (detalle.includes(columna)) return { mensaje: texto, errores: { [columna]: texto } };
    }
    return { mensaje: 'Ya existe un registro con esos datos.' };
  }
  if (error.code === '23503') {
    return { mensaje: 'Un elemento relacionado ya no existe. Recarga la página e inténtalo de nuevo.' };
  }
  if (error.code === '23514' || error.code === 'P0001') {
    return { mensaje: error.message.slice(0, 200) };
  }
  console.error('[panel] error de base de datos:', error.code, error.message);
  return { mensaje: 'No se pudo guardar. Inténtalo de nuevo.' };
}

/**
 * Entrada común de toda Server Action del panel: sesión completa, módulo y
 * acción. Sin sesión o sin módulo, `requerirAdmin` redirige; sin la acción
 * devuelve un resultado de error (nunca lanza al navegador).
 */
export async function adminDeAccion(
  modulo: ModuloId,
  accion: AccionId,
): Promise<{ admin: ContextoAdmin } | { error: ResultadoAccion }> {
  try {
    return { admin: await requerirAdmin({ modulo, accion }) };
  } catch (e) {
    if (e instanceof ErrorSinPermiso) return { error: { ok: false, mensaje: e.message } };
    throw e;
  }
}

/**
 * Entrada común de las rutas API del panel (descargas): sesión completa, módulo y acción, o una respuesta 403
 * lista para devolver.
 */
export async function adminParaApiDe(modulo: ModuloId, accion: AccionId): Promise<ContextoAdmin | NextResponse> {
  try {
    return await requerirAdmin({ modulo, accion });
  } catch (e) {
    if (e instanceof ErrorSinPermiso) return NextResponse.json({ error: 'sin-permiso' }, { status: 403 });
    throw e;
  }
}
