'use server';

import { redirect } from 'next/navigation';
import { erroresPorCampo, type ResultadoAccion } from '@/lib/admin/crud/comun';
import { adminDeAccion } from '@/lib/admin/crud/servidor';
import { entradaSeccion, esquemaSeccion } from '@/lib/admin/home/home';
import { alternarSeccionBd, eliminarSeccionBd, guardarSeccionBd, moverSeccionBd } from '@/lib/admin/home/servidor';
import { ipDelCliente } from '@/lib/auth/cabeceras';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const paisSeguro = (p: string): 'CO' | 'EC' => (p === 'EC' ? 'EC' : 'CO');

export async function guardarSeccion(_previo: ResultadoAccion, formData: FormData): Promise<ResultadoAccion> {
  const entrada = await adminDeAccion('home', 'home.gestionar');
  if ('error' in entrada) return entrada.error;

  const pais = paisSeguro(String(formData.get('pais') ?? ''));
  const analizado = esquemaSeccion.safeParse(entradaSeccion(Object.fromEntries(formData)));
  if (!analizado.success) {
    return { ok: false, mensaje: 'Revisa los campos marcados.', errores: erroresPorCampo(analizado.error) };
  }
  const resultado = await guardarSeccionBd({
    cliente: crearClienteServicio(),
    datos: analizado.data,
    pais,
    actor: entrada.admin.userId,
    ip: await ipDelCliente(),
  });
  if (!resultado.ok) return resultado;
  redirect(`/admin/home?pais=${pais}&guardado=1`);
}

/** Las acciones de la lista se usan como `action` de un formulario: no devuelven valor, siempre vuelven a la lista. */
export async function moverSeccion(id: string, sentido: 'arriba' | 'abajo', pais: string): Promise<void> {
  const entrada = await adminDeAccion('home', 'home.gestionar');
  if ('error' in entrada) redirect(`/admin/home?pais=${paisSeguro(pais)}&error=1`);
  const ok =
    UUID.test(id) && (sentido === 'arriba' || sentido === 'abajo')
      ? (await moverSeccionBd({ cliente: crearClienteServicio(), id, sentido, actor: entrada.admin.userId, ip: await ipDelCliente() })).ok
      : false;
  redirect(`/admin/home?pais=${paisSeguro(pais)}${ok ? '' : '&error=1'}`);
}

export async function alternarSeccion(id: string, activa: boolean, pais: string): Promise<void> {
  const entrada = await adminDeAccion('home', 'home.gestionar');
  if ('error' in entrada) redirect(`/admin/home?pais=${paisSeguro(pais)}&error=1`);
  // Los argumentos de una Server Action llegan del navegador: `activa` debe ser exactamente un booleano.
  const ok = UUID.test(id) && typeof activa === 'boolean'
    ? (await alternarSeccionBd({ cliente: crearClienteServicio(), id, activa, actor: entrada.admin.userId, ip: await ipDelCliente() })).ok
    : false;
  redirect(`/admin/home?pais=${paisSeguro(pais)}${ok ? '' : '&error=1'}`);
}

export async function eliminarSeccion(id: string, pais: string): Promise<ResultadoAccion> {
  const entrada = await adminDeAccion('home', 'home.gestionar');
  if ('error' in entrada) return entrada.error;
  if (!UUID.test(id)) return { ok: false, mensaje: 'Identificador no válido.' };
  const r = await eliminarSeccionBd({ cliente: crearClienteServicio(), id, actor: entrada.admin.userId, ip: await ipDelCliente() });
  if (!r.ok) return r;
  redirect(`/admin/home?pais=${paisSeguro(pais)}&eliminado=1`);
}
