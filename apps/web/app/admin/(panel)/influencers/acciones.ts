'use server';

import { redirect } from 'next/navigation';
import { erroresPorCampo, type ResultadoAccion } from '@/lib/admin/crud/comun';
import { adminDeAccion } from '@/lib/admin/crud/servidor';
import { esquemaInfluencer } from '@/lib/admin/descuentos/influencers';
import { eliminarInfluencerBd, guardarInfluencerBd } from '@/lib/admin/descuentos/influencers-servidor';
import { ipDelCliente } from '@/lib/auth/cabeceras';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function guardarInfluencer(_previo: ResultadoAccion, formData: FormData): Promise<ResultadoAccion> {
  const entrada = await adminDeAccion('influencers', 'influencers.gestionar');
  if ('error' in entrada) return entrada.error;

  const analizado = esquemaInfluencer.safeParse(Object.fromEntries(formData));
  if (!analizado.success) {
    return { ok: false, mensaje: 'Revisa los campos marcados.', errores: erroresPorCampo(analizado.error) };
  }
  const resultado = await guardarInfluencerBd({
    cliente: crearClienteServicio(),
    datos: analizado.data,
    actor: entrada.admin.userId,
    ip: await ipDelCliente(),
  });
  if (!resultado.ok) return resultado;
  redirect(`/admin/influencers/${resultado.id}?guardado=1`);
}

export async function eliminarInfluencer(id: string): Promise<ResultadoAccion> {
  const entrada = await adminDeAccion('influencers', 'influencers.gestionar');
  if ('error' in entrada) return entrada.error;
  if (!UUID.test(id)) return { ok: false, mensaje: 'Identificador no válido.' };
  const resultado = await eliminarInfluencerBd({
    cliente: crearClienteServicio(),
    id,
    actor: entrada.admin.userId,
    ip: await ipDelCliente(),
  });
  if (!resultado.ok) return resultado;
  redirect('/admin/influencers?eliminado=1');
}
