'use server';

import { cerrarSesionLocal } from '@/lib/auth/cerrar-sesion';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { registrarAuditoria } from '@/lib/auth/auditoria';
import { ipDelCliente } from '@/lib/auth/cabeceras';
import { RUTA_TRAS_CIERRE } from '@/lib/auth/decision';
import { NOMBRE_COOKIE_MARCA } from '@/lib/auth/marca-sesion';
import { crearClienteServidor } from '@/lib/auth/supabase/servidor';

/** Cierra la sesión del panel (Supabase, cookie de marca, auditoría) y lleva a la home pública. */
export async function cerrarSesion(): Promise<void> {
  const supabase = await crearClienteServidor();
  const { data } = await supabase.auth.getUser();
  if (data.user) {
    await registrarAuditoria({
      actor: data.user.id,
      accion: 'logout',
      entidadId: data.user.id,
      ip: await ipDelCliente(),
    });
  }
  await cerrarSesionLocal(supabase);
  const almacen = await cookies();
  almacen.delete(NOMBRE_COOKIE_MARCA);
  almacen.delete('izao_admin_mfa'); // cookie de la MFA retirada (D-054), por si quedó de antes
  redirect(RUTA_TRAS_CIERRE);
}
