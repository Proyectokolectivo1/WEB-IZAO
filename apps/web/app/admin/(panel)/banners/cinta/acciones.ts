'use server';

import { redirect } from 'next/navigation';
import { esquemaAnuncio, esquemaRotacion } from '@/lib/admin/anuncios/anuncios';
import { alternarAnuncioBd, eliminarAnuncioBd, guardarAnuncioBd, guardarRotacionBd, moverAnuncioBd } from '@/lib/admin/anuncios/servidor';
import { erroresPorCampo, type ResultadoAccion } from '@/lib/admin/crud/comun';
import { adminDeAccion } from '@/lib/admin/crud/servidor';
import { ipDelCliente } from '@/lib/auth/cabeceras';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const normalizarPais = (p: string): 'CO' | 'EC' => (p === 'EC' ? 'EC' : 'CO');
const rutaCinta = (pais: string) => `/admin/banners/cinta?pais=${normalizarPais(pais)}`;

async function contexto() {
  const entrada = await adminDeAccion('banners', 'banners.gestionar');
  if ('error' in entrada) return entrada;
  return { cliente: crearClienteServicio(), actor: entrada.admin.userId, ip: await ipDelCliente() };
}

/** Vuelve a la cinta con el resultado: sin JavaScript también se ve el motivo de un fallo. */
function volver(pais: string, r: ResultadoAccion, extra = ''): never {
  const ruta = rutaCinta(pais);
  if (r.ok) redirect(`${ruta}${extra}`);
  redirect(`${ruta}&error=${encodeURIComponent(r.mensaje ?? 'No se pudo completar la acción.')}${extra}`);
}

/** Primer mensaje de error por campo, para mostrarlo tal cual en el aviso de la página. */
function primerError(errores: Record<string, string>): string {
  return Object.values(errores)[0] ?? 'Revisa los campos.';
}

export async function guardarAnuncio(formData: FormData): Promise<void> {
  const datosCrudos = Object.fromEntries(formData);
  const pais = String(datosCrudos['country_code'] ?? 'CO');
  const ctx = await contexto();
  if ('error' in ctx) return volver(pais, ctx.error);
  const analizado = esquemaAnuncio.safeParse(datosCrudos);
  if (!analizado.success) return volver(pais, { ok: false, mensaje: primerError(erroresPorCampo(analizado.error)) });
  const r = await guardarAnuncioBd({ ...ctx, datos: analizado.data });
  if (r.ok) return volver(pais, r, '&guardado=1');
  volver(pais, { ok: false, mensaje: r.mensaje ?? primerError(r.errores ?? {}) });
}

export async function alternarAnuncio(pais: string, id: string, activo: boolean): Promise<void> {
  const ctx = await contexto();
  if ('error' in ctx) return volver(pais, ctx.error);
  if (!UUID.test(id)) return volver(pais, { ok: false, mensaje: 'Identificador no válido.' });
  volver(pais, await alternarAnuncioBd({ ...ctx, id, activo }));
}

export async function moverAnuncio(pais: string, id: string, direccion: 'arriba' | 'abajo'): Promise<void> {
  const ctx = await contexto();
  if ('error' in ctx) return volver(pais, ctx.error);
  if (!UUID.test(id) || (direccion !== 'arriba' && direccion !== 'abajo')) return volver(pais, { ok: false, mensaje: 'Datos no válidos.' });
  volver(pais, await moverAnuncioBd({ ...ctx, id, direccion }));
}

export async function eliminarAnuncio(pais: string, id: string): Promise<ResultadoAccion> {
  const ctx = await contexto();
  if ('error' in ctx) return ctx.error;
  if (!UUID.test(id)) return { ok: false, mensaje: 'Identificador no válido.' };
  const r = await eliminarAnuncioBd({ ...ctx, id });
  if (!r.ok) return r;
  redirect(`${rutaCinta(pais)}&eliminado=1`);
}

export async function guardarRotacion(formData: FormData): Promise<void> {
  const datosCrudos = Object.fromEntries(formData);
  const pais = String(datosCrudos['country_code'] ?? 'CO');
  const ctx = await contexto();
  if ('error' in ctx) return volver(pais, ctx.error);
  const analizado = esquemaRotacion.safeParse(datosCrudos);
  if (!analizado.success) return volver(pais, { ok: false, mensaje: primerError(erroresPorCampo(analizado.error)) });
  const r = await guardarRotacionBd({ ...ctx, datos: analizado.data });
  volver(pais, r, r.ok ? '&rotacion=1' : '');
}
