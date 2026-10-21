'use server';

import { revalidatePath } from 'next/cache';
import { adminDeAccion } from '@/lib/admin/crud/servidor';
import { encolarCobro } from '@/lib/admin/pedidos/cola-cobro';
import { linkCobroBd, reenviarCobroBd } from '@/lib/admin/pedidos/cobro-servidor';
import { reintentarEnvioMasterShop } from '@/app/api/webhooks/mastershop/cola';
import { agregarNotaBd, cancelarPedidoBd, marcarPagadoBd, reimprimirEtiquetaBd, reintentarEnvioBd, type ResultadoPedido } from '@/lib/admin/pedidos/acciones-servidor';
import { confirmarStockPedido, crearCancelarEnMasterShop, liberarStockPedido } from '@/lib/admin/pedidos/externos-servidor';
import { ipDelCliente } from '@/lib/auth/cabeceras';
import type { AccionId } from '@/lib/auth/permissions';
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

// ---------------------------------------------------------------------------
// Acciones operativas (§24.1, §24.3). Cada una verifica su permiso exacto antes de leer o escribir nada.
// ---------------------------------------------------------------------------

type Entrada = { cliente: ReturnType<typeof crearClienteServicio>; actor: string; ip: string | null };

async function conPermiso(
  accion: AccionId,
  orderId: string,
  ejecutar: (e: Entrada) => Promise<ResultadoPedido>,
): Promise<ResultadoPedido> {
  const entrada = await adminDeAccion('pedidos', accion);
  if ('error' in entrada) return { ok: false, mensaje: entrada.error.mensaje ?? 'No tienes permiso para esta acción.' };
  if (!UUID.test(orderId)) return { ok: false, mensaje: 'Identificador no válido.' };
  const r = await ejecutar({ cliente: crearClienteServicio(), actor: entrada.admin.userId, ip: await ipDelCliente() });
  revalidatePath(`/admin/pedidos/${orderId}`);
  revalidatePath('/admin/pedidos');
  return r;
}

/** Cancelar: solo administrador. Cancela también en MasterShop si el envío está en 1–2. */
export async function cancelarPedido(orderId: string, motivo: string): Promise<ResultadoPedido> {
  return conPermiso('pedidos.cancelar', orderId, (e) =>
    cancelarPedidoBd({
      ...e,
      orderId,
      motivo,
      cancelarEnMasterShop: crearCancelarEnMasterShop(e.cliente),
      liberarStock: liberarStockPedido,
    }),
  );
}

/** Marcar pagado (solo `pendiente_manual`): solo administrador. */
export async function marcarPagado(orderId: string, referencia: string): Promise<ResultadoPedido> {
  return conPermiso('pedidos.marcar_pagado', orderId, (e) =>
    marcarPagadoBd({
      ...e,
      orderId,
      referencia,
      confirmarStock: confirmarStockPedido,
      encolarEnvio: (id, estado) => reintentarEnvioMasterShop(id, estado),
    }),
  );
}

/** Nota interna: operador y administrador. */
export async function agregarNota(orderId: string, texto: string): Promise<ResultadoPedido> {
  return conPermiso('pedidos.nota', orderId, (e) => agregarNotaBd({ ...e, orderId, texto }));
}

/** Reintentar el envío a MasterShop: operador y administrador. */
export async function reintentarEnvio(orderId: string): Promise<ResultadoPedido> {
  return conPermiso('pedidos.reintentar_envio', orderId, (e) =>
    reintentarEnvioBd({ ...e, orderId, reintentar: (id, estado) => reintentarEnvioMasterShop(id, estado) }),
  );
}

/** Reimprimir la etiqueta: operador y administrador. */
export async function reimprimirEtiqueta(orderId: string): Promise<ResultadoPedido> {
  return conPermiso('pedidos.reimprimir', orderId, (e) => reimprimirEtiquetaBd({ ...e, orderId }));
}
