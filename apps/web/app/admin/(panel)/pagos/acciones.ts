'use server';

import { revalidatePath } from 'next/cache';
import { erroresPorCampo, type ResultadoAccion } from '@/lib/admin/crud/comun';
import { adminDeAccion, invalidarConfigPais } from '@/lib/admin/crud/servidor';
import {
  METODOS,
  esPaisAjustes,
  esquemaAjustesPais,
  esquemaMetodo,
  type MetodoPago,
} from '@/lib/admin/pagos/ajustes';
import { guardarAjustesPaisBd, guardarMetodoBd } from '@/lib/admin/pagos/ajustes-servidor';
import { esquemaWhatsappAsesor } from '@/lib/admin/pagos/whatsapp-asesor';
import { guardarWhatsappAsesorBd } from '@/lib/admin/pagos/whatsapp-asesor-servidor';
import { ipDelCliente } from '@/lib/auth/cabeceras';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';

function texto(f: FormData): Record<string, string> {
  const salida: Record<string, string> = {};
  for (const [k, v] of f.entries()) if (typeof v === 'string') salida[k] = v.slice(0, 500);
  return salida;
}

function refrescar(pais: 'CO' | 'EC'): void {
  revalidatePath('/admin/pagos');
  invalidarConfigPais([pais]);
}

export async function guardarAjustesPais(_previo: ResultadoAccion, formData: FormData): Promise<ResultadoAccion> {
  const entrada = await adminDeAccion('pagos', 'pagos.gestionar');
  if ('error' in entrada) return entrada.error;
  const crudo = texto(formData);
  if (!esPaisAjustes(crudo.pais)) return { ok: false, mensaje: 'País no válido.' };
  const pais = crudo.pais;

  const analizado = esquemaAjustesPais(pais).safeParse(crudo);
  if (!analizado.success) {
    return { ok: false, mensaje: 'Revisa los campos marcados.', errores: erroresPorCampo(analizado.error) };
  }
  const r = await guardarAjustesPaisBd({
    cliente: crearClienteServicio(),
    actor: entrada.admin.userId,
    ip: await ipDelCliente(),
    pais,
    datos: analizado.data,
  });
  if (r.ok) refrescar(pais);
  return r;
}

export async function guardarMetodo(_previo: ResultadoAccion, formData: FormData): Promise<ResultadoAccion> {
  const entrada = await adminDeAccion('pagos', 'pagos.gestionar');
  if ('error' in entrada) return entrada.error;
  const crudo = texto(formData);
  if (!esPaisAjustes(crudo.pais)) return { ok: false, mensaje: 'País no válido.' };
  const pais = crudo.pais;
  const metodo = METODOS.find((m) => m === crudo.metodo) as MetodoPago | undefined;
  if (!metodo) return { ok: false, mensaje: 'Método de pago no válido.' };

  const analizado = esquemaMetodo(pais).safeParse(crudo);
  if (!analizado.success) {
    return { ok: false, mensaje: 'Revisa los campos marcados.', errores: erroresPorCampo(analizado.error) };
  }
  const r = await guardarMetodoBd({
    cliente: crearClienteServicio(),
    actor: entrada.admin.userId,
    ip: await ipDelCliente(),
    pais,
    metodo,
    datos: analizado.data,
  });
  if (r.ok) refrescar(pais);
  return r;
}

/** WhatsApp del asesor del país (botón flotante de la tienda, Iza y pie): número, mensaje inicial e interruptor. */
export async function guardarWhatsappAsesor(_previo: ResultadoAccion, formData: FormData): Promise<ResultadoAccion> {
  const entrada = await adminDeAccion('pagos', 'pagos.gestionar');
  if ('error' in entrada) return entrada.error;
  const crudo = texto(formData);
  if (!esPaisAjustes(crudo.pais)) return { ok: false, mensaje: 'País no válido.' };
  const pais = crudo.pais;

  const analizado = esquemaWhatsappAsesor.safeParse(crudo);
  if (!analizado.success) {
    return { ok: false, mensaje: 'Revisa los campos marcados.', errores: erroresPorCampo(analizado.error) };
  }
  const r = await guardarWhatsappAsesorBd({
    cliente: crearClienteServicio(),
    actor: entrada.admin.userId,
    ip: await ipDelCliente(),
    pais,
    datos: analizado.data,
  });
  if (r.ok) refrescar(pais);
  return r;
}
