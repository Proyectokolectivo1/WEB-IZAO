'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { crearClienteWhatsApp } from '@izao/whatsapp';
import { erroresPorCampo, type ResultadoAccion } from '@/lib/admin/crud/comun';
import { adminDeAccion } from '@/lib/admin/crud/servidor';
import { credencialesWhatsAppActivas } from '@/lib/admin/whatsapp/credenciales';
import { esquemaPlantilla } from '@/lib/admin/whatsapp/plantillas';
import {
  crearDesdeTextoPorDefectoBd,
  crearVersionBd,
  enviarAAprobacionBd,
  guardarBorradorBd,
  type ResultadoPlantilla,
} from '@/lib/admin/whatsapp/plantillas-servidor';
import { ipDelCliente } from '@/lib/auth/cabeceras';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function refrescar(id?: string): void {
  revalidatePath('/admin/whatsapp/plantillas');
  if (id) revalidatePath(`/admin/whatsapp/plantillas/${id}`);
}

export async function guardarBorrador(_previo: ResultadoPlantilla, formData: FormData): Promise<ResultadoPlantilla> {
  const entrada = await adminDeAccion('whatsapp', 'whatsapp.plantillas');
  if ('error' in entrada) return entrada.error;

  const analizado = esquemaPlantilla.safeParse(Object.fromEntries(formData));
  if (!analizado.success) {
    return { ok: false, mensaje: 'Revisa los campos marcados.', errores: erroresPorCampo(analizado.error) };
  }
  const r = await guardarBorradorBd({
    cliente: crearClienteServicio(),
    datos: analizado.data,
    actor: entrada.admin.userId,
    ip: await ipDelCliente(),
  });
  refrescar(analizado.data.id);
  return r;
}

export async function enviarAAprobacion(id: string): Promise<ResultadoPlantilla> {
  const entrada = await adminDeAccion('whatsapp', 'whatsapp.plantillas');
  if ('error' in entrada) return entrada.error;
  if (!UUID.test(id)) return { ok: false, mensaje: 'Identificador no válido.' };
  const cliente = crearClienteServicio();
  const r = await enviarAAprobacionBd({
    cliente,
    id,
    actor: entrada.admin.userId,
    ip: await ipDelCliente(),
    credenciales: (pais) => credencialesWhatsAppActivas(cliente, pais),
    crearClienteMeta: (c) => crearClienteWhatsApp(c),
  });
  refrescar(id);
  return r;
}

export async function crearVersion(id: string): Promise<ResultadoAccion> {
  const entrada = await adminDeAccion('whatsapp', 'whatsapp.plantillas');
  if ('error' in entrada) return entrada.error;
  if (!UUID.test(id)) return { ok: false, mensaje: 'Identificador no válido.' };
  const r = await crearVersionBd({
    cliente: crearClienteServicio(),
    desdeId: id,
    actor: entrada.admin.userId,
    ip: await ipDelCliente(),
  });
  if (!r.ok || !r.id) return r;
  refrescar();
  redirect(`/admin/whatsapp/plantillas/${r.id}`);
}

export async function crearDesdeTextoPorDefecto(formData: FormData): Promise<void> {
  const entrada = await adminDeAccion('whatsapp', 'whatsapp.plantillas');
  if ('error' in entrada) return;
  const pais = formData.get('pais') === 'EC' ? 'EC' : 'CO';
  const clave = String(formData.get('clave') ?? '');
  const r = await crearDesdeTextoPorDefectoBd({
    cliente: crearClienteServicio(),
    pais,
    clave,
    actor: entrada.admin.userId,
    ip: await ipDelCliente(),
  });
  refrescar();
  if (r.ok && r.id) redirect(`/admin/whatsapp/plantillas/${r.id}`);
  redirect(`/admin/whatsapp/plantillas?pais=${pais}`);
}
