'use server';

import { redirect } from 'next/navigation';
import { erroresPorCampo, type ResultadoAccion } from '@/lib/admin/crud/comun';
import { adminDeAccion } from '@/lib/admin/crud/servidor';
import { esquemaCategoriaGasto, esquemaGasto } from '@/lib/admin/gastos/gastos';
import {
  eliminarCategoriaGastoBd,
  eliminarGastoBd,
  guardarCategoriaGastoBd,
  guardarGastoBd,
} from '@/lib/admin/gastos/servidor';
import { ipDelCliente } from '@/lib/auth/cabeceras';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function guardarGasto(_previo: ResultadoAccion, formData: FormData): Promise<ResultadoAccion> {
  const entrada = await adminDeAccion('gastos', 'gastos.gestionar');
  if ('error' in entrada) return entrada.error;

  // La moneda del valor sale del país elegido; un país desconocido se rechaza antes de interpretar el monto.
  const pais = String(formData.get('country_code') ?? '');
  if (pais !== 'CO' && pais !== 'EC') {
    return { ok: false, mensaje: 'Revisa los campos marcados.', errores: { country_code: 'Elige un país.' } };
  }
  const analizado = esquemaGasto(pais).safeParse(Object.fromEntries(formData));
  if (!analizado.success) {
    return { ok: false, mensaje: 'Revisa los campos marcados.', errores: erroresPorCampo(analizado.error) };
  }
  const resultado = await guardarGastoBd({
    cliente: crearClienteServicio(),
    datos: analizado.data,
    actor: entrada.admin.userId,
    ip: await ipDelCliente(),
  });
  if (!resultado.ok) return resultado;
  redirect(`/admin/gastos?pais=${pais}&guardado=1`);
}

export async function eliminarGasto(id: string, pais: string): Promise<ResultadoAccion> {
  const entrada = await adminDeAccion('gastos', 'gastos.gestionar');
  if ('error' in entrada) return entrada.error;
  if (!UUID.test(id)) return { ok: false, mensaje: 'Identificador no válido.' };
  const resultado = await eliminarGastoBd({
    cliente: crearClienteServicio(),
    id,
    actor: entrada.admin.userId,
    ip: await ipDelCliente(),
  });
  if (!resultado.ok) return resultado;
  redirect(`/admin/gastos?pais=${pais === 'EC' ? 'EC' : 'CO'}&eliminado=1`);
}

export async function guardarCategoriaGasto(_previo: ResultadoAccion, formData: FormData): Promise<ResultadoAccion> {
  const entrada = await adminDeAccion('gastos', 'gastos.gestionar');
  if ('error' in entrada) return entrada.error;

  const analizado = esquemaCategoriaGasto.safeParse(Object.fromEntries(formData));
  if (!analizado.success) {
    return { ok: false, mensaje: 'Revisa los campos marcados.', errores: erroresPorCampo(analizado.error) };
  }
  const resultado = await guardarCategoriaGastoBd({
    cliente: crearClienteServicio(),
    datos: analizado.data,
    actor: entrada.admin.userId,
    ip: await ipDelCliente(),
  });
  if (!resultado.ok) return resultado;
  redirect('/admin/gastos/categorias?guardado=1');
}

export async function eliminarCategoriaGasto(id: string): Promise<ResultadoAccion> {
  const entrada = await adminDeAccion('gastos', 'gastos.gestionar');
  if ('error' in entrada) return entrada.error;
  if (!UUID.test(id)) return { ok: false, mensaje: 'Identificador no válido.' };
  const resultado = await eliminarCategoriaGastoBd({
    cliente: crearClienteServicio(),
    id,
    actor: entrada.admin.userId,
    ip: await ipDelCliente(),
  });
  if (!resultado.ok) return resultado;
  redirect('/admin/gastos/categorias?eliminado=1');
}
