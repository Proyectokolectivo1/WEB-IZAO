/**
 * Lectura de `admin_users` con el rol de servicio. La tabla tiene RLS sin
 * políticas para usuarios normales: solo el servidor puede leerla.
 */
import type { AdminInfo } from './decision';
import { crearClienteServicio } from './supabase/servicio';

export type FilaAdmin = AdminInfo & { name: string };

export async function buscarAdminPorId(userId: string): Promise<FilaAdmin | null> {
  const servicio = crearClienteServicio();
  const { data, error } = await servicio
    .from('admin_users')
    .select('role, is_active, name')
    .eq('auth_user_id', userId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    role: String(data.role),
    isActive: data.is_active === true,
    name: String(data.name),
  };
}
