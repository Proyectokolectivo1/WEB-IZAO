'use server';

import { randomInt } from 'node:crypto';
import { redirect } from 'next/navigation';
import { erroresPorCampo, type ResultadoAccion } from '@/lib/admin/crud/comun';
import { adminDeAccion } from '@/lib/admin/crud/servidor';
import { esquemaCodigo, esquemaLote, formularioAObjeto } from '@/lib/admin/descuentos/codigos';
import {
  alternarCodigoBd,
  crearLoteBd,
  eliminarCodigoBd,
  guardarCodigoBd,
} from '@/lib/admin/descuentos/codigos-servidor';
import { ipDelCliente } from '@/lib/auth/cabeceras';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function guardarCodigo(_previo: ResultadoAccion, formData: FormData): Promise<ResultadoAccion> {
  const entrada = await adminDeAccion('descuentos', 'descuentos.gestionar');
  if ('error' in entrada) return entrada.error;

  const analizado = esquemaCodigo.safeParse(formularioAObjeto(formData));
  if (!analizado.success) {
    return { ok: false, mensaje: 'Revisa los campos marcados.', errores: erroresPorCampo(analizado.error) };
  }
  const resultado = await guardarCodigoBd({
    cliente: crearClienteServicio(),
    datos: analizado.data,
    actor: entrada.admin.userId,
    ip: await ipDelCliente(),
  });
  if (!resultado.ok) return resultado;
  redirect(`/admin/descuentos?pais=${analizado.data.country_code}&guardado=1`);
}

export async function crearLote(_previo: ResultadoAccion, formData: FormData): Promise<ResultadoAccion> {
  const entrada = await adminDeAccion('descuentos', 'descuentos.gestionar');
  if ('error' in entrada) return entrada.error;

  const analizado = esquemaLote.safeParse(formularioAObjeto(formData));
  if (!analizado.success) {
    return { ok: false, mensaje: 'Revisa los campos marcados.', errores: erroresPorCampo(analizado.error) };
  }
  const resultado = await crearLoteBd({
    cliente: crearClienteServicio(),
    datos: analizado.data,
    azar: (n) => randomInt(n),
    actor: entrada.admin.userId,
    ip: await ipDelCliente(),
  });
  if (!resultado.ok) return resultado;
  const { prefix, country_code } = analizado.data;
  redirect(`/admin/descuentos?pais=${country_code}&origen=batch&q=${encodeURIComponent(prefix)}&lote=${resultado.codigos?.length ?? 0}`);
}

export async function alternarCodigo(id: string, activo: boolean): Promise<ResultadoAccion> {
  const entrada = await adminDeAccion('descuentos', 'descuentos.gestionar');
  if ('error' in entrada) return entrada.error;
  if (!UUID.test(id)) return { ok: false, mensaje: 'Identificador no válido.' };
  const resultado = await alternarCodigoBd({
    cliente: crearClienteServicio(),
    id,
    activo,
    actor: entrada.admin.userId,
    ip: await ipDelCliente(),
  });
  if (!resultado.ok) return resultado;
  redirect(`/admin/descuentos/${id}?guardado=1`);
}

export async function eliminarCodigo(id: string): Promise<ResultadoAccion> {
  const entrada = await adminDeAccion('descuentos', 'descuentos.gestionar');
  if ('error' in entrada) return entrada.error;
  if (!UUID.test(id)) return { ok: false, mensaje: 'Identificador no válido.' };
  const resultado = await eliminarCodigoBd({
    cliente: crearClienteServicio(),
    id,
    actor: entrada.admin.userId,
    ip: await ipDelCliente(),
  });
  if (!resultado.ok) return resultado;
  redirect('/admin/descuentos?eliminado=1');
}
