import 'server-only';
import { NextResponse } from 'next/server';
import { ErrorSinPermiso, requerirAdmin, type ContextoAdmin } from '@/lib/auth/guard';
import type { AccionId } from '@/lib/auth/permissions';

/** Para rutas API del catálogo: sesión completa y la acción exigida, o una respuesta 403 lista para devolver. */
export async function adminParaApi(accion: AccionId): Promise<ContextoAdmin | NextResponse> {
  try {
    return await requerirAdmin({ modulo: 'productos', accion });
  } catch (e) {
    if (e instanceof ErrorSinPermiso) return NextResponse.json({ error: 'sin-permiso' }, { status: 403 });
    throw e;
  }
}
