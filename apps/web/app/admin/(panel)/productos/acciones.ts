'use server';

import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { esquemaProductoForm } from '@/lib/admin/catalogo/productos';
import { archivarProductoBd, duplicarProductoBd, eliminarProductoBd, guardarProductoPanel, restaurarProductoBd } from '@/lib/admin/catalogo/productos-servidor';
import { erroresPorCampo, type ResultadoAccion } from '@/lib/admin/crud/comun';
import { adminDeAccion } from '@/lib/admin/crud/servidor';
import { ipDelCliente } from '@/lib/auth/cabeceras';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** El formulario viaja como un solo campo `payload` con JSON: el servidor lo valida de nuevo con zod. */
export async function guardarProductoAccion(_previo: ResultadoAccion, formData: FormData): Promise<ResultadoAccion> {
  const entrada = await adminDeAccion('productos', 'catalogo.gestionar');
  if ('error' in entrada) return entrada.error;

  const bruto = formData.get('payload');
  if (typeof bruto !== 'string' || bruto.length > 2_000_000) return { ok: false, mensaje: 'El formulario llegó incompleto. Recarga la página.' };
  let json: unknown;
  try {
    json = JSON.parse(bruto);
  } catch {
    return { ok: false, mensaje: 'El formulario llegó incompleto. Recarga la página.' };
  }
  const analizado = esquemaProductoForm.safeParse(json);
  if (!analizado.success) {
    return { ok: false, mensaje: 'Revisa los campos marcados.', errores: erroresPorCampo(analizado.error) };
  }

  const resultado = await guardarProductoPanel({
    form: analizado.data,
    cliente: crearClienteServicio(),
    actor: entrada.admin.userId,
    ip: await ipDelCliente(),
  });
  if (!resultado.ok) return resultado;
  redirect(`/admin/productos/${resultado.id}?guardado=1`);
}

export async function duplicarProductoAccion(id: string): Promise<ResultadoAccion> {
  const entrada = await adminDeAccion('productos', 'catalogo.gestionar');
  if ('error' in entrada) return entrada.error;
  if (!UUID.test(id)) return { ok: false, mensaje: 'Identificador no válido.' };
  const resultado = await duplicarProductoBd({
    id,
    nuevoId: randomUUID,
    cliente: crearClienteServicio(),
    actor: entrada.admin.userId,
    ip: await ipDelCliente(),
  });
  if (!resultado.ok) return resultado;
  redirect(`/admin/productos/${resultado.id}?duplicado=1`);
}

export async function archivarProductoAccion(id: string): Promise<ResultadoAccion> {
  const entrada = await adminDeAccion('productos', 'catalogo.gestionar');
  if ('error' in entrada) return entrada.error;
  if (!UUID.test(id)) return { ok: false, mensaje: 'Identificador no válido.' };
  const resultado = await archivarProductoBd({
    id,
    cliente: crearClienteServicio(),
    actor: entrada.admin.userId,
    ip: await ipDelCliente(),
  });
  if (!resultado.ok) return resultado;
  redirect('/admin/productos?archivado=1');
}

/** Eliminar (D-055): con pedidos se archiva; sin pedidos se borra. La lista muestra qué pasó. */
export async function eliminarProductoAccion(id: string): Promise<ResultadoAccion> {
  const entrada = await adminDeAccion('productos', 'catalogo.gestionar');
  if ('error' in entrada) return entrada.error;
  if (!UUID.test(id)) return { ok: false, mensaje: 'Identificador no válido.' };
  const resultado = await eliminarProductoBd({
    id,
    cliente: crearClienteServicio(),
    actor: entrada.admin.userId,
    ip: await ipDelCliente(),
  });
  if (!resultado.ok) return resultado;
  redirect(resultado.accion === 'eliminado' ? '/admin/productos?eliminado=1' : `/admin/productos?conservado=${resultado.pedidos}`);
}

export async function restaurarProductoAccion(id: string): Promise<ResultadoAccion> {
  const entrada = await adminDeAccion('productos', 'catalogo.gestionar');
  if ('error' in entrada) return entrada.error;
  if (!UUID.test(id)) return { ok: false, mensaje: 'Identificador no válido.' };
  const resultado = await restaurarProductoBd({
    id,
    cliente: crearClienteServicio(),
    actor: entrada.admin.userId,
    ip: await ipDelCliente(),
  });
  if (!resultado.ok) return resultado;
  redirect(`/admin/productos/${id}?restaurado=1`);
}
