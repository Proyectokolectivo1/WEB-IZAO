'use server';

import { redirect } from 'next/navigation';
import { erroresPorCampo, type ResultadoAccion } from '@/lib/admin/crud/comun';
import { adminDeAccion } from '@/lib/admin/crud/servidor';
import { esquemaAnonimizar } from '@/lib/admin/clientes/clientes';
import { anonimizarClienteBd } from '@/lib/admin/clientes/servidor';
import { ipDelCliente } from '@/lib/auth/cabeceras';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';

/** Anonimiza a un cliente por solicitud de supresión (habeas data). Irreversible; solo administrador. */
export async function anonimizarCliente(_previo: ResultadoAccion, formData: FormData): Promise<ResultadoAccion> {
  const entrada = await adminDeAccion('clientes', 'clientes.gestionar');
  if ('error' in entrada) return entrada.error;

  const analizado = esquemaAnonimizar.safeParse(Object.fromEntries(formData));
  if (!analizado.success) {
    return { ok: false, mensaje: 'Revisa los campos marcados.', errores: erroresPorCampo(analizado.error) };
  }
  const resultado = await anonimizarClienteBd({
    cliente: crearClienteServicio(),
    datos: analizado.data,
    actor: entrada.admin.userId,
    ip: await ipDelCliente(),
  });
  if (!resultado.ok) return resultado;
  redirect(`/admin/clientes/${analizado.data.id}?anonimizado=1`);
}
