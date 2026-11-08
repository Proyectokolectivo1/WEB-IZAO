'use server';

import { redirect } from 'next/navigation';
import { esUbicacion, esquemaBanner, esquemaCarrusel } from '@/lib/admin/banners/banners';
import {
  alternarBannerBd,
  buscarProductosVisibles,
  eliminarBannerBd,
  guardarAjustesCarruselBd,
  guardarBannerBd,
  moverBannerBd,
  variantesDeProducto,
  type ProductoVisible,
  type VarianteDestino,
} from '@/lib/admin/banners/servidor';
import { erroresPorCampo, type ResultadoAccion } from '@/lib/admin/crud/comun';
import { adminDeAccion, type Pais } from '@/lib/admin/crud/servidor';
import { ipDelCliente } from '@/lib/auth/cabeceras';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const esPais = (p: string): p is Pais => p === 'CO' || p === 'EC';

/** Lista de banners del país y la ubicación; ambos vienen del cliente, así que se normalizan antes de redirigir. */
function rutaLista(pais: string, ubicacion: string): string {
  return `/admin/banners?pais=${esPais(pais) ? pais : 'CO'}&ubicacion=${esUbicacion(ubicacion) ? ubicacion : 'hero'}`;
}

async function contexto() {
  const entrada = await adminDeAccion('banners', 'banners.gestionar');
  if ('error' in entrada) return entrada;
  return { cliente: crearClienteServicio(), actor: entrada.admin.userId, ip: await ipDelCliente() };
}

/** Vuelve a la lista con el resultado: sin JavaScript también se ve el motivo de un fallo. */
function volver(ruta: string, r: ResultadoAccion): never {
  if (r.ok) redirect(ruta);
  redirect(`${ruta}${ruta.includes('?') ? '&' : '?'}error=${encodeURIComponent(r.mensaje ?? 'No se pudo completar la acción.')}`);
}

export async function guardarBanner(_previo: ResultadoAccion, formData: FormData): Promise<ResultadoAccion> {
  const ctx = await contexto();
  if ('error' in ctx) return ctx.error;
  const analizado = esquemaBanner.safeParse(Object.fromEntries(formData));
  if (!analizado.success) {
    return { ok: false, mensaje: 'Revisa los campos marcados.', errores: erroresPorCampo(analizado.error) };
  }
  const r = await guardarBannerBd({ ...ctx, datos: analizado.data });
  if (!r.ok) return r;
  redirect(`/admin/banners?pais=${analizado.data.country_code}&ubicacion=${analizado.data.placement}&guardado=1`);
}

export async function alternarBanner(pais: string, ubicacion: string, id: string, activo: boolean): Promise<void> {
  const ctx = await contexto();
  const ruta = rutaLista(pais, ubicacion);
  if ('error' in ctx) return volver(ruta, ctx.error);
  if (!UUID.test(id)) return volver(ruta, { ok: false, mensaje: 'Identificador no válido.' });
  volver(ruta, await alternarBannerBd({ ...ctx, id, activo }));
}

export async function moverBanner(pais: string, ubicacion: string, id: string, direccion: 'arriba' | 'abajo'): Promise<void> {
  const ctx = await contexto();
  const ruta = rutaLista(pais, ubicacion);
  if ('error' in ctx) return volver(ruta, ctx.error);
  if (!UUID.test(id) || (direccion !== 'arriba' && direccion !== 'abajo')) return volver(ruta, { ok: false, mensaje: 'Datos no válidos.' });
  volver(ruta, await moverBannerBd({ ...ctx, id, direccion }));
}

export async function eliminarBanner(pais: string, ubicacion: string, id: string): Promise<ResultadoAccion> {
  const ctx = await contexto();
  if ('error' in ctx) return ctx.error;
  if (!UUID.test(id)) return { ok: false, mensaje: 'Identificador no válido.' };
  const r = await eliminarBannerBd({ ...ctx, id });
  if (!r.ok) return r;
  redirect(`${rutaLista(pais, ubicacion)}&eliminado=1`);
}

/** Buscador del formulario: productos visibles en el país. Devuelve datos, no redirige. */
export async function buscarProductosBanner(pais: string, q: string): Promise<ProductoVisible[]> {
  const ctx = await contexto();
  if ('error' in ctx || !esPais(pais)) return [];
  return buscarProductosVisibles(ctx.cliente, pais, q);
}

/** Variantes activas del producto en el país, para elegir una opcional. */
export async function variantesBanner(pais: string, productId: string): Promise<VarianteDestino[]> {
  const ctx = await contexto();
  if ('error' in ctx || !esPais(pais) || !UUID.test(productId)) return [];
  return variantesDeProducto(ctx.cliente, productId, pais);
}

/** Ajustes del carrusel de un país: segundos entre imágenes y si sale arriba del catálogo. */
export async function guardarAjustesCarrusel(_previo: ResultadoAccion, formData: FormData): Promise<ResultadoAccion> {
  const ctx = await contexto();
  if ('error' in ctx) return ctx.error;
  const analizado = esquemaCarrusel.safeParse(Object.fromEntries(formData));
  if (!analizado.success) {
    return { ok: false, mensaje: 'Revisa los campos marcados.', errores: erroresPorCampo(analizado.error) };
  }
  const r = await guardarAjustesCarruselBd({ ...ctx, datos: analizado.data });
  return r.ok ? { ok: true, mensaje: 'Ajustes del carrusel guardados. Se ven en la tienda en pocos minutos.' } : r;
}
