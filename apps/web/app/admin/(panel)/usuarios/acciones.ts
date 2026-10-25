'use server';

import { redirect } from 'next/navigation';
import { erroresPorCampo, type ResultadoAccion } from '@/lib/admin/crud/comun';
import { adminDeAccion } from '@/lib/admin/crud/servidor';
import { esIdUsuario, esquemaContrasena, esquemaEdicionUsuario, esquemaNuevoUsuario } from '@/lib/admin/usuarios/usuarios';
import { crearUsuarioBd, editarUsuarioBd, reiniciarMfaBd, restablecerContrasenaBd } from '@/lib/admin/usuarios/servidor';
import { ipDelCliente } from '@/lib/auth/cabeceras';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';

const REVISA = 'Revisa los campos marcados.';

export async function crearUsuario(_previo: ResultadoAccion, formData: FormData): Promise<ResultadoAccion> {
  const entrada = await adminDeAccion('usuarios', 'usuarios.gestionar');
  if ('error' in entrada) return entrada.error;

  const analizado = esquemaNuevoUsuario.safeParse(Object.fromEntries(formData));
  if (!analizado.success) return { ok: false, mensaje: REVISA, errores: erroresPorCampo(analizado.error) };
  const resultado = await crearUsuarioBd({
    cliente: crearClienteServicio(),
    datos: analizado.data,
    actor: entrada.admin.userId,
    ip: await ipDelCliente(),
  });
  if (!resultado.ok) return resultado;
  redirect(`/admin/usuarios/${resultado.id}?creado=1`);
}

export async function editarUsuario(_previo: ResultadoAccion, formData: FormData): Promise<ResultadoAccion> {
  const entrada = await adminDeAccion('usuarios', 'usuarios.gestionar');
  if ('error' in entrada) return entrada.error;

  const analizado = esquemaEdicionUsuario.safeParse(Object.fromEntries(formData));
  if (!analizado.success) return { ok: false, mensaje: REVISA, errores: erroresPorCampo(analizado.error) };
  const resultado = await editarUsuarioBd({
    cliente: crearClienteServicio(),
    datos: analizado.data,
    actor: entrada.admin.userId,
    ip: await ipDelCliente(),
  });
  if (!resultado.ok) return resultado;
  redirect(`/admin/usuarios/${analizado.data.id}?guardado=1`);
}

export async function restablecerContrasena(_previo: ResultadoAccion, formData: FormData): Promise<ResultadoAccion> {
  const entrada = await adminDeAccion('usuarios', 'usuarios.gestionar');
  if ('error' in entrada) return entrada.error;

  const analizado = esquemaContrasena.safeParse(Object.fromEntries(formData));
  if (!analizado.success) return { ok: false, mensaje: REVISA, errores: erroresPorCampo(analizado.error) };
  const resultado = await restablecerContrasenaBd({
    cliente: crearClienteServicio(),
    datos: analizado.data,
    actor: entrada.admin.userId,
    ip: await ipDelCliente(),
  });
  if (!resultado.ok) return resultado;
  redirect(`/admin/usuarios/${analizado.data.id}?contrasena=1`);
}

export async function reiniciarMfa(id: string): Promise<ResultadoAccion> {
  const entrada = await adminDeAccion('usuarios', 'usuarios.gestionar');
  if ('error' in entrada) return entrada.error;
  if (!esIdUsuario(id)) return { ok: false, mensaje: 'Identificador no válido.' };
  const resultado = await reiniciarMfaBd({
    cliente: crearClienteServicio(),
    id,
    actor: entrada.admin.userId,
    ip: await ipDelCliente(),
  });
  if (!resultado.ok) return resultado;
  redirect(`/admin/usuarios/${id}?mfa=1`);
}
