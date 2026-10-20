'use server';

import { redirect } from 'next/navigation';
import { esquemaCategoria } from '@/lib/admin/catalogo/categorias';
import { eliminarCategoriaBd, guardarCategoriaBd } from '@/lib/admin/catalogo/categorias-servidor';
import { erroresPorCampo, type ResultadoAccion } from '@/lib/admin/crud/comun';
import { adminDeAccion } from '@/lib/admin/crud/servidor';
import { ipDelCliente } from '@/lib/auth/cabeceras';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';

export async function guardarCategoria(_previo: ResultadoAccion, formData: FormData): Promise<ResultadoAccion> {
  const entrada = await adminDeAccion('categorias', 'catalogo.gestionar');
  if ('error' in entrada) return entrada.error;

  const analizado = esquemaCategoria.safeParse(Object.fromEntries(formData));
  if (!analizado.success) {
    return { ok: false, mensaje: 'Revisa los campos marcados.', errores: erroresPorCampo(analizado.error) };
  }
  const resultado = await guardarCategoriaBd({
    cliente: crearClienteServicio(),
    datos: analizado.data,
    actor: entrada.admin.userId,
    ip: await ipDelCliente(),
  });
  if (!resultado.ok) return resultado;
  redirect('/admin/categorias?guardado=1');
}

export async function eliminarCategoria(id: string): Promise<ResultadoAccion> {
  const entrada = await adminDeAccion('categorias', 'catalogo.gestionar');
  if ('error' in entrada) return entrada.error;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, mensaje: 'Identificador no válido.' };
  const resultado = await eliminarCategoriaBd({
    cliente: crearClienteServicio(),
    id,
    actor: entrada.admin.userId,
    ip: await ipDelCliente(),
  });
  if (!resultado.ok) return resultado;
  redirect('/admin/categorias?eliminado=1');
}
