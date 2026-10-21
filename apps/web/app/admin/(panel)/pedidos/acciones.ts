'use server';

import { revalidatePath } from 'next/cache';
import { adminDeAccion } from '@/lib/admin/crud/servidor';
import { encolarCobro } from '@/lib/admin/pedidos/cola-cobro';
import { linkCobroBd, reenviarCobroBd } from '@/lib/admin/pedidos/cobro-servidor';
import { ipDelCliente } from '@/lib/auth/cabeceras';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type RespuestaCobro = { ok: true; mensaje?: string; url?: string } | { ok: false; mensaje: string };

/** Copiar link de cobro: operador y administrador (§24.3). */
export async function copiarLinkCobro(orderId: string): Promise<RespuestaCobro> {
  const entrada = await adminDeAccion('pedidos', 'pedidos.copiar_link_cobro');
  if ('error' in entrada) return { ok: false, mensaje: entrada.error.mensaje ?? 'No tienes permiso para esta acción.' };
  if (!UUID.test(orderId)) return { ok: false, mensaje: 'Identificador no válido.' };
  const r = await linkCobroBd({
    cliente: crearClienteServicio(),
    orderId,
    actor: entrada.admin.userId,
    ip: await ipDelCliente(),
    origen: process.env.SITE_URL ?? 'https://izaoperfumeria.com',
  });
  return r;
}

/** Reenviar cobro: operador y administrador (§24.3). */
export async function reenviarCobro(orderId: string): Promise<RespuestaCobro> {
  const entrada = await adminDeAccion('pedidos', 'pedidos.reenviar_cobro');
  if ('error' in entrada) return { ok: false, mensaje: entrada.error.mensaje ?? 'No tienes permiso para esta acción.' };
  if (!UUID.test(orderId)) return { ok: false, mensaje: 'Identificador no válido.' };
  const r = await reenviarCobroBd({
    cliente: crearClienteServicio(),
    orderId,
    actor: entrada.admin.userId,
    ip: await ipDelCliente(),
    encolar: (id) => encolarCobro(id),
  });
  revalidatePath(`/admin/pedidos/${orderId}`);
  return r.ok ? { ok: true, ...(r.mensaje ? { mensaje: r.mensaje } : {}) } : r;
}
