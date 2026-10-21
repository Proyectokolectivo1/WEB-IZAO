'use server';

import { revalidatePath } from 'next/cache';
import { type ResultadoAccion } from '@/lib/admin/crud/comun';
import { adminDeAccion } from '@/lib/admin/crud/servidor';
import {
  CAMPOS_VACIOS,
  configDesdeFormulario,
  type CamposFormularioAgente,
} from '@/lib/admin/agentes/esquemas';
import {
  cambiarEstadoAgenteBd,
  crearAgenteBd,
  guardarConfigAgenteBd,
  paginaPruebaBd,
  rotarTokenBd,
} from '@/lib/admin/agentes/servidor';
import { reimprimirEtiquetaBd } from '@/lib/admin/pedidos/acciones-servidor';
import { ipDelCliente } from '@/lib/auth/cabeceras';
import type { AccionId } from '@/lib/auth/permissions';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Respuesta de las acciones que entregan un token: solo viaja en esta respuesta y la pantalla lo muestra una vez. */
export type RespuestaAgente = { ok: true; mensaje: string; id?: string; token?: string } | { ok: false; mensaje: string };

type Entrada = { cliente: ReturnType<typeof crearClienteServicio>; actor: string; ip: string | null };

async function conPermiso<T extends { ok: boolean }>(accion: AccionId, ejecutar: (e: Entrada) => Promise<T>): Promise<T | { ok: false; mensaje: string }> {
  const entrada = await adminDeAccion('agente', accion);
  if ('error' in entrada) return { ok: false, mensaje: entrada.error.mensaje ?? 'No tienes permiso para esta acción.' };
  const r = await ejecutar({ cliente: crearClienteServicio(), actor: entrada.admin.userId, ip: await ipDelCliente() });
  revalidatePath('/admin/agente-impresion');
  return r;
}

/** Alta de un agente: solo administrador. El token aparece en esta respuesta y no se puede volver a ver. */
export async function crearAgente(nombre: string): Promise<RespuestaAgente> {
  return conPermiso('agente.gestionar', (e) => crearAgenteBd({ ...e, nombre }));
}

export async function rotarToken(id: string): Promise<RespuestaAgente> {
  if (!UUID.test(id)) return { ok: false, mensaje: 'Identificador no válido.' };
  return conPermiso('agente.gestionar', (e) => rotarTokenBd({ ...e, id }));
}

export async function cambiarEstadoAgente(id: string, activo: boolean): Promise<RespuestaAgente> {
  if (!UUID.test(id)) return { ok: false, mensaje: 'Identificador no válido.' };
  return conPermiso('agente.gestionar', (e) => cambiarEstadoAgenteBd({ ...e, id, activo }));
}

/** Configuración remota (`print`, `panel`, `intervals`) y modo del agente: solo administrador. */
export async function guardarConfigAgente(id: string, _previo: ResultadoAccion, formData: FormData): Promise<ResultadoAccion> {
  const entrada = await adminDeAccion('agente', 'agente.gestionar');
  if ('error' in entrada) return entrada.error;
  if (!UUID.test(id)) return { ok: false, mensaje: 'Identificador no válido.' };
  const crudo: CamposFormularioAgente = { ...CAMPOS_VACIOS };
  for (const clave of Object.keys(CAMPOS_VACIOS) as (keyof CamposFormularioAgente)[]) {
    const v = formData.get(clave);
    // Los pasos del panel pueden ser largos; el resto de campos son cortos.
    if (typeof v === 'string') crudo[clave] = v.slice(0, clave === 'panel_steps' ? 20_000 : 2_000);
  }
  const r = configDesdeFormulario(crudo);
  if (!r.ok) return { ok: false, mensaje: 'Revisa los campos marcados.', errores: r.errores };
  const guardado = await guardarConfigAgenteBd({
    cliente: crearClienteServicio(),
    actor: entrada.admin.userId,
    ip: await ipDelCliente(),
    id,
    modo: r.modo,
    config: r.config,
  });
  revalidatePath('/admin/agente-impresion');
  revalidatePath(`/admin/agente-impresion/${id}`);
  return guardado.ok ? { ok: true, mensaje: guardado.mensaje } : guardado;
}

/** Página de prueba: operador y administrador. */
export async function imprimirPaginaPrueba(): Promise<RespuestaAgente> {
  return conPermiso('agente.pagina_prueba', (e) => paginaPruebaBd(e));
}

/** Reimprimir la etiqueta de un trabajo de la cola: operador y administrador. */
export async function reimprimirDesdeAgente(orderId: string): Promise<RespuestaAgente> {
  if (!UUID.test(orderId)) return { ok: false, mensaje: 'Identificador no válido.' };
  return conPermiso('agente.reimprimir', (e) => reimprimirEtiquetaBd({ ...e, orderId }));
}

