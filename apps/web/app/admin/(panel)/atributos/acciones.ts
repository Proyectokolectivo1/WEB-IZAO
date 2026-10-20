'use server';

import { redirect } from 'next/navigation';
import { eliminarTaxonomiaBd, guardarTaxonomiaBd } from '@/lib/admin/catalogo/taxonomias-servidor';
import { TAXONOMIAS, esTipoTaxonomia, esquemaTaxonomia } from '@/lib/admin/catalogo/taxonomias';
import { erroresPorCampo, type ResultadoAccion } from '@/lib/admin/crud/comun';
import { adminDeAccion } from '@/lib/admin/crud/servidor';
import { ipDelCliente } from '@/lib/auth/cabeceras';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';

/** Crea o actualiza una marca, familia, género o concentración y vuelve a la lista. */
export async function guardarTaxonomia(
  tipo: string,
  _previo: ResultadoAccion,
  formData: FormData,
): Promise<ResultadoAccion> {
  const entrada = await adminDeAccion('catalogo_auxiliar', 'catalogo.gestionar');
  if ('error' in entrada) return entrada.error;
  const { admin } = entrada;
  if (!esTipoTaxonomia(tipo)) return { ok: false, mensaje: 'Tipo de atributo desconocido.' };
  const def = TAXONOMIAS[tipo];

  const analizado = esquemaTaxonomia.safeParse(Object.fromEntries(formData));
  if (!analizado.success) {
    return { ok: false, mensaje: 'Revisa los campos marcados.', errores: erroresPorCampo(analizado.error) };
  }

  const resultado = await guardarTaxonomiaBd({
    cliente: crearClienteServicio(),
    def,
    datos: analizado.data,
    actor: admin.userId,
    ip: await ipDelCliente(),
  });
  if (!resultado.ok) return resultado;
  redirect(`/admin/atributos/${tipo}?guardado=1`);
}

/** Elimina un registro si ningún producto lo usa. */
export async function eliminarTaxonomia(tipo: string, id: string): Promise<ResultadoAccion> {
  const entrada = await adminDeAccion('catalogo_auxiliar', 'catalogo.gestionar');
  if ('error' in entrada) return entrada.error;
  const { admin } = entrada;
  if (!esTipoTaxonomia(tipo)) return { ok: false, mensaje: 'Tipo de atributo desconocido.' };
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, mensaje: 'Identificador no válido.' };

  const resultado = await eliminarTaxonomiaBd({
    cliente: crearClienteServicio(),
    def: TAXONOMIAS[tipo],
    id,
    actor: admin.userId,
    ip: await ipDelCliente(),
  });
  if (!resultado.ok) return resultado;
  redirect(`/admin/atributos/${tipo}?eliminado=1`);
}
