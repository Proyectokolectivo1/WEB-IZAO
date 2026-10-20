'use server';

import { redirect } from 'next/navigation';
import { erroresPorCampo, type ResultadoAccion } from '@/lib/admin/crud/comun';
import { adminDeAccion } from '@/lib/admin/crud/servidor';
import { esquemaPagina } from '@/lib/admin/contenido/paginas';
import { eliminarPaginaBd, guardarPaginaBd } from '@/lib/admin/contenido/paginas-servidor';
import { ipDelCliente } from '@/lib/auth/cabeceras';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';

export async function guardarPagina(_previo: ResultadoAccion, formData: FormData): Promise<ResultadoAccion> {
  const entrada = await adminDeAccion('contenido', 'contenido.gestionar');
  if ('error' in entrada) return entrada.error;

  const analizado = esquemaPagina.safeParse(Object.fromEntries(formData));
  if (!analizado.success) {
    return { ok: false, mensaje: 'Revisa los campos marcados.', errores: erroresPorCampo(analizado.error) };
  }
  const resultado = await guardarPaginaBd({
    cliente: crearClienteServicio(),
    datos: analizado.data,
    actor: entrada.admin.userId,
    ip: await ipDelCliente(),
  });
  if (!resultado.ok) return resultado;
  const extra = resultado.despublicada ? `&despublicada=${encodeURIComponent(resultado.despublicada.slice(0, 160))}` : '';
  redirect(`/admin/contenido/paginas?pais=${analizado.data.country_code}&guardado=1${extra}`);
}

export async function eliminarPagina(id: string, pais: 'CO' | 'EC'): Promise<ResultadoAccion> {
  const entrada = await adminDeAccion('contenido', 'contenido.gestionar');
  if ('error' in entrada) return entrada.error;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, mensaje: 'Identificador no válido.' };
  const resultado = await eliminarPaginaBd({
    cliente: crearClienteServicio(),
    id,
    actor: entrada.admin.userId,
    ip: await ipDelCliente(),
  });
  if (!resultado.ok) return resultado;
  redirect(`/admin/contenido/paginas?pais=${pais === 'EC' ? 'EC' : 'CO'}&eliminado=1`);
}
