'use server';

import { redirect } from 'next/navigation';
import { erroresPorCampo, type ResultadoAccion } from '@/lib/admin/crud/comun';
import { adminDeAccion } from '@/lib/admin/crud/servidor';
import { esquemaAjustesGarantia, esquemaGestion } from '@/lib/admin/garantias/garantias';
import { gestionarGarantiaBd, guardarAjustesGarantiaBd } from '@/lib/admin/garantias/servidor';
import { ipDelCliente } from '@/lib/auth/cabeceras';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Estado, solución, costo y notas de un caso. Operador y administrador (§24.3). */
export async function gestionarGarantia(_previo: ResultadoAccion, formData: FormData): Promise<ResultadoAccion> {
  const entrada = await adminDeAccion('garantias', 'garantias.gestionar');
  if ('error' in entrada) return entrada.error;

  const id = String(formData.get('id') ?? '');
  if (!UUID.test(id)) return { ok: false, mensaje: 'Identificador no válido.' };
  const cliente = crearClienteServicio();
  // La moneda del costo sale del país del caso guardado, nunca del formulario.
  const { data: caso } = await cliente.from('warranty_claims').select('country_code').eq('id', id).maybeSingle();
  const pais = (caso as { country_code?: string } | null)?.country_code;
  if (pais !== 'CO' && pais !== 'EC') return { ok: false, mensaje: 'Este caso ya no existe.' };

  const analizado = esquemaGestion(pais).safeParse(Object.fromEntries(formData));
  if (!analizado.success) {
    return { ok: false, mensaje: 'Revisa los campos marcados.', errores: erroresPorCampo(analizado.error) };
  }
  const resultado = await gestionarGarantiaBd({
    cliente,
    datos: analizado.data,
    actor: entrada.admin.userId,
    ip: await ipDelCliente(),
  });
  if (!resultado.ok) return resultado;
  redirect(`/admin/garantias/${id}?guardado=1`);
}

/** Plazo, respuesta, motivos y textos por país. Solo administrador. */
export async function guardarAjustesGarantia(_previo: ResultadoAccion, formData: FormData): Promise<ResultadoAccion> {
  const entrada = await adminDeAccion('garantias', 'garantias.ajustes');
  if ('error' in entrada) return entrada.error;

  const analizado = esquemaAjustesGarantia.safeParse(Object.fromEntries(formData));
  if (!analizado.success) {
    return { ok: false, mensaje: 'Revisa los campos marcados.', errores: erroresPorCampo(analizado.error) };
  }
  const resultado = await guardarAjustesGarantiaBd({
    cliente: crearClienteServicio(),
    datos: analizado.data,
    actor: entrada.admin.userId,
    ip: await ipDelCliente(),
  });
  if (!resultado.ok) return resultado;
  redirect(`/admin/garantias/ajustes?pais=${analizado.data.country_code}&guardado=1`);
}
