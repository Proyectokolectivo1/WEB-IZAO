'use server';

import { redirect } from 'next/navigation';
import { esquemaColeccion } from '@/lib/admin/catalogo/colecciones';
import {
  agregarItemBd,
  destacarBd,
  eliminarColeccionBd,
  guardarColeccionBd,
  moverDestacadoBd,
  moverItemBd,
  quitarDestacadoBd,
  quitarItemBd,
} from '@/lib/admin/catalogo/colecciones-servidor';
import { erroresPorCampo, type ResultadoAccion } from '@/lib/admin/crud/comun';
import { adminDeAccion, type Pais } from '@/lib/admin/crud/servidor';
import { ipDelCliente } from '@/lib/auth/cabeceras';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function contexto() {
  const entrada = await adminDeAccion('colecciones', 'catalogo.gestionar');
  if ('error' in entrada) return entrada;
  return { cliente: crearClienteServicio(), actor: entrada.admin.userId, ip: await ipDelCliente() };
}

/** Vuelve a la página con el resultado: sin JavaScript también se ve el motivo de un fallo. */
function volver(ruta: string, r: ResultadoAccion): never {
  if (r.ok) redirect(ruta);
  redirect(`${ruta}${ruta.includes('?') ? '&' : '?'}error=${encodeURIComponent(r.mensaje ?? 'No se pudo completar la acción.')}`);
}

export async function guardarColeccion(_previo: ResultadoAccion, formData: FormData): Promise<ResultadoAccion> {
  const ctx = await contexto();
  if ('error' in ctx) return ctx.error;
  const analizado = esquemaColeccion.safeParse(Object.fromEntries(formData));
  if (!analizado.success) {
    return { ok: false, mensaje: 'Revisa los campos marcados.', errores: erroresPorCampo(analizado.error) };
  }
  const r = await guardarColeccionBd({ ...ctx, datos: analizado.data });
  if (!r.ok) return r;
  redirect(`/admin/colecciones/${r.id}?guardado=1`);
}

export async function eliminarColeccion(id: string): Promise<ResultadoAccion> {
  const ctx = await contexto();
  if ('error' in ctx) return ctx.error;
  if (!UUID.test(id)) return { ok: false, mensaje: 'Identificador no válido.' };
  const r = await eliminarColeccionBd({ ...ctx, id });
  if (!r.ok) return r;
  redirect('/admin/colecciones?eliminado=1');
}

export async function agregarItem(coleccionId: string, productId: string): Promise<void> {
  const ctx = await contexto();
  const ruta = `/admin/colecciones/${coleccionId}`;
  if ('error' in ctx) return volver(ruta, ctx.error);
  if (!UUID.test(coleccionId) || !UUID.test(productId)) return volver(ruta, { ok: false, mensaje: 'Identificador no válido.' });
  volver(ruta, await agregarItemBd({ ...ctx, coleccionId, productId }));
}

export async function quitarItem(coleccionId: string, productId: string): Promise<void> {
  const ctx = await contexto();
  const ruta = `/admin/colecciones/${coleccionId}`;
  if ('error' in ctx) return volver(ruta, ctx.error);
  if (!UUID.test(coleccionId) || !UUID.test(productId)) return volver(ruta, { ok: false, mensaje: 'Identificador no válido.' });
  volver(ruta, await quitarItemBd({ ...ctx, coleccionId, productId }));
}

export async function moverItem(
  coleccionId: string,
  productId: string,
  direccion: 'arriba' | 'abajo',
): Promise<void> {
  const ctx = await contexto();
  const ruta = `/admin/colecciones/${coleccionId}`;
  if ('error' in ctx) return volver(ruta, ctx.error);
  if (!UUID.test(coleccionId) || !UUID.test(productId)) return volver(ruta, { ok: false, mensaje: 'Identificador no válido.' });
  volver(ruta, await moverItemBd({ ...ctx, coleccionId, productId, direccion }));
}

function esPais(p: string): p is Pais {
  return p === 'CO' || p === 'EC';
}

export async function destacar(pais: string, productId: string): Promise<void> {
  const ctx = await contexto();
  const ruta = `/admin/colecciones/destacados?pais=${esPais(pais) ? pais : 'CO'}`;
  if ('error' in ctx) return volver(ruta, ctx.error);
  if (!esPais(pais) || !UUID.test(productId)) return volver(ruta, { ok: false, mensaje: 'Datos no válidos.' });
  volver(ruta, await destacarBd({ ...ctx, pais, productId }));
}

export async function quitarDestacado(pais: string, productId: string): Promise<void> {
  const ctx = await contexto();
  const ruta = `/admin/colecciones/destacados?pais=${esPais(pais) ? pais : 'CO'}`;
  if ('error' in ctx) return volver(ruta, ctx.error);
  if (!esPais(pais) || !UUID.test(productId)) return volver(ruta, { ok: false, mensaje: 'Datos no válidos.' });
  volver(ruta, await quitarDestacadoBd({ ...ctx, pais, productId }));
}

export async function moverDestacado(pais: string, productId: string, direccion: 'arriba' | 'abajo'): Promise<void> {
  const ctx = await contexto();
  const ruta = `/admin/colecciones/destacados?pais=${esPais(pais) ? pais : 'CO'}`;
  if ('error' in ctx) return volver(ruta, ctx.error);
  if (!esPais(pais) || !UUID.test(productId)) return volver(ruta, { ok: false, mensaje: 'Datos no válidos.' });
  volver(ruta, await moverDestacadoBd({ ...ctx, pais, productId, direccion }));
}
