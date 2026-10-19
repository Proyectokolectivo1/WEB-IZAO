'use server';

import { cerrarSesionLocal } from '@/lib/auth/cerrar-sesion';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { registrarAuditoria } from '@/lib/auth/auditoria';
import { ipDelCliente } from '@/lib/auth/cabeceras';
import { RUTA_LOGIN } from '@/lib/auth/decision';
import { NOMBRE_COOKIE_MARCA } from '@/lib/auth/marca-sesion';
import { crearClienteServidor } from '@/lib/auth/supabase/servidor';

/** Cierra la sesión del panel y vuelve al login. */
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
  (await cookies()).delete(NOMBRE_COOKIE_MARCA);
  redirect(RUTA_LOGIN);
}
