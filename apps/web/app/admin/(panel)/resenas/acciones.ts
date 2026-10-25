'use server';

import { redirect } from 'next/navigation';
import { erroresPorCampo, type ResultadoAccion } from '@/lib/admin/crud/comun';
import { adminDeAccion } from '@/lib/admin/crud/servidor';
import { esEstadoResena, esquemaResenaAdmin, leerFiltrosResena, parametrosDeFiltrosResena } from '@/lib/admin/resenas/resenas';
import { destacarResenaBd, eliminarResenaBd, guardarResenaAdminBd, moderarResenaBd } from '@/lib/admin/resenas/servidor';
import { ipDelCliente } from '@/lib/auth/cabeceras';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Vuelve a la bandeja con los mismos filtros: se vuelven a leer y validar, nunca se confía en el texto recibido. */
const volver = (retorno: string) =>
  `/admin/resenas?${new URLSearchParams(parametrosDeFiltrosResena(leerFiltrosResena(Object.fromEntries(new URLSearchParams(retorno))))).toString()}`;

export async function guardarResena(_previo: ResultadoAccion, formData: FormData): Promise<ResultadoAccion> {
  const entrada = await adminDeAccion('resenas', 'resenas.gestionar');
  if ('error' in entrada) return entrada.error;

  const analizado = esquemaResenaAdmin.safeParse(Object.fromEntries(formData));
  if (!analizado.success) {
    return { ok: false, mensaje: 'Revisa los campos marcados.', errores: erroresPorCampo(analizado.error) };
  }
  const resultado = await guardarResenaAdminBd({
    cliente: crearClienteServicio(),
    datos: analizado.data,
    actor: entrada.admin.userId,
    ip: await ipDelCliente(),
  });
  if (!resultado.ok) return resultado;
  redirect('/admin/resenas?estado=todas&fuente=admin&guardado=1');
}

/** Aprobar / rechazar / devolver a revisión. Se usa como `action` de un formulario: no devuelve valor. */
export async function moderarResena(id: string, estado: string, retorno: string): Promise<void> {
  const entrada = await adminDeAccion('resenas', 'resenas.gestionar');
  if ('error' in entrada) redirect(`${volver(retorno)}&error=1`);
  const ok =
    UUID.test(id) && esEstadoResena(estado)
      ? (await moderarResenaBd({ cliente: crearClienteServicio(), id, estado, actor: entrada.admin.userId, ip: await ipDelCliente() })).ok
      : false;
  redirect(ok ? volver(retorno) : `${volver(retorno)}&error=1`);
}

export async function destacarResena(id: string, destacada: boolean, retorno: string): Promise<void> {
  const entrada = await adminDeAccion('resenas', 'resenas.gestionar');
  if ('error' in entrada) redirect(`${volver(retorno)}&error=1`);
  const ok = UUID.test(id)
    ? (await destacarResenaBd({ cliente: crearClienteServicio(), id, destacada, actor: entrada.admin.userId, ip: await ipDelCliente() })).ok
    : false;
  redirect(ok ? volver(retorno) : `${volver(retorno)}&error=1`);
}

export async function eliminarResena(id: string): Promise<ResultadoAccion> {
  const entrada = await adminDeAccion('resenas', 'resenas.gestionar');
  if ('error' in entrada) return entrada.error;
  if (!UUID.test(id)) return { ok: false, mensaje: 'Identificador no válido.' };
  const r = await eliminarResenaBd({ cliente: crearClienteServicio(), id, actor: entrada.admin.userId, ip: await ipDelCliente() });
  if (!r.ok) return r;
  redirect('/admin/resenas?estado=todas&eliminado=1');
}
