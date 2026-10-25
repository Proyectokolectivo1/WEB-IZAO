'use server';

import { redirect } from 'next/navigation';
import { erroresPorCampo, type ResultadoAccion } from '@/lib/admin/crud/comun';
import { adminDeAccion } from '@/lib/admin/crud/servidor';
import { esquemaApariencia, leerAlcance } from '@/lib/admin/apariencia/apariencia';
import { guardarAparienciaBd, quitarOverridePaisBd } from '@/lib/admin/apariencia/servidor';
import { ipDelCliente } from '@/lib/auth/cabeceras';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';

export async function guardarApariencia(_previo: ResultadoAccion, formData: FormData): Promise<ResultadoAccion> {
  const entrada = await adminDeAccion('apariencia', 'apariencia.gestionar');
  if ('error' in entrada) return entrada.error;

  const alcance = leerAlcance(String(formData.get('alcance') ?? ''));
  const analizado = esquemaApariencia(alcance).safeParse(Object.fromEntries(formData));
  if (!analizado.success) {
    return { ok: false, mensaje: 'Revisa los campos marcados.', errores: erroresPorCampo(analizado.error) };
  }
  const resultado = await guardarAparienciaBd({
    cliente: crearClienteServicio(),
    datos: analizado.data,
    actor: entrada.admin.userId,
    ip: await ipDelCliente(),
  });
  if (!resultado.ok) return resultado;
  redirect(`/admin/apariencia?alcance=${alcance}&guardado=1`);
}

export async function quitarAjustesPais(pais: string): Promise<ResultadoAccion> {
  const entrada = await adminDeAccion('apariencia', 'apariencia.gestionar');
  if ('error' in entrada) return entrada.error;
  if (pais !== 'CO' && pais !== 'EC') return { ok: false, mensaje: 'País no válido.' };
  const resultado = await quitarOverridePaisBd({
    cliente: crearClienteServicio(),
    pais,
    actor: entrada.admin.userId,
    ip: await ipDelCliente(),
  });
  if (!resultado.ok) return resultado;
  redirect(`/admin/apariencia?alcance=${pais}&restablecido=1`);
}
