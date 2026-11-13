import 'server-only';
/**
 * Usuarios del panel (§24.1) con el cliente de servicio: alta, edición de nombre/rol/estado, restablecer contraseña y
 * (el panel entra solo con correo y contraseña, D-054). Nada de lo que se
 * escribe aquí lleva contraseñas a la auditoría ni al navegador. Una cuenta que ya existe en Auth no se "adopta" desde
 * el panel: eso queda para el script del dueño, que pide confirmación explícita.
 */
import { auditarCambio } from '@/lib/admin/auditoria';
import { esRol, type Rol } from '@/lib/auth/permissions';
import type { Cliente } from '../catalogo/taxonomias-servidor';
import { diffCampos, type ResultadoAccion } from '../crud/comun';
import { traducirErrorBd } from '../crud/servidor';
import {
  validarCambioUsuario,
  type DatosContrasena,
  type DatosEdicionUsuario,
  type DatosNuevoUsuario,
} from './usuarios';

type Ctx = { cliente: Cliente; actor: string; ip: string | null };

export type FilaUsuario = {
  id: string;
  nombre: string;
  rol: Rol;
  activo: boolean;
  /** `null` si la cuenta de Auth ya no existe (fila huérfana). */
  correo: string | null;
  ultimoIngreso: string | null;
  creado: string;
};

type AdminFila = { auth_user_id: string; role: string; name: string; is_active: boolean; created_at: string };

async function completar(cliente: Cliente, f: AdminFila): Promise<FilaUsuario> {
  const { data } = await cliente.auth.admin.getUserById(f.auth_user_id);
  const u = data?.user ?? null;
  return {
    id: f.auth_user_id,
    nombre: f.name,
    rol: esRol(f.role) ? f.role : 'operator',
    activo: f.is_active,
    correo: u?.email ?? null,
    ultimoIngreso: u?.last_sign_in_at ?? null,
    creado: f.created_at,
  };
}

export async function listarUsuarios(cliente: Cliente): Promise<FilaUsuario[]> {
  const { data, error } = await cliente
    .from('admin_users')
    .select('auth_user_id, role, name, is_active, created_at')
    .order('created_at', { ascending: true })
    .limit(200);
  if (error) throw new Error(`No se pudieron listar los usuarios: ${error.message}`);
  return Promise.all(((data ?? []) as unknown as AdminFila[]).map((f) => completar(cliente, f)));
}

export async function obtenerUsuario(cliente: Cliente, id: string): Promise<FilaUsuario | null> {
  const { data, error } = await cliente
    .from('admin_users')
    .select('auth_user_id, role, name, is_active, created_at')
    .eq('auth_user_id', id)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer el usuario: ${error.message}`);
  return data ? completar(cliente, data as unknown as AdminFila) : null;
}

async function contarAdminsActivos(cliente: Cliente): Promise<number> {
  const { count, error } = await cliente
    .from('admin_users')
    .select('auth_user_id', { count: 'exact', head: true })
    .eq('role', 'admin')
    .eq('is_active', true);
  if (error) throw new Error(`No se pudo contar los administradores: ${error.message}`);
  return count ?? 0;
}

/** Crea la cuenta en Auth (correo confirmado) y su fila en `admin_users`. */
export async function crearUsuarioBd(args: Ctx & { datos: DatosNuevoUsuario }): Promise<ResultadoAccion> {
  const { cliente, datos, actor, ip } = args;
  const creado = await cliente.auth.admin.createUser({
    email: datos.correo,
    password: datos.contrasena,
    email_confirm: true,
    user_metadata: { nombre: datos.nombre },
  });
  if (creado.error || !creado.data.user) {
    const code = (creado.error as { code?: string } | null)?.code;
    if (code === 'email_exists' || /already|registered|exists/i.test(creado.error?.message ?? '')) {
      return {
        ok: false,
        mensaje: 'Ya existe una cuenta con ese correo. Para darle acceso al panel usa el script crear-admin.',
        errores: { correo: 'Ya existe una cuenta con ese correo.' },
      };
    }
    if (code === 'weak_password') return { ok: false, errores: { contrasena: 'La contraseña es demasiado débil.' }, mensaje: 'Revisa los campos marcados.' };
    console.error('[usuarios] no se pudo crear la cuenta:', creado.error?.message);
    return { ok: false, mensaje: 'No se pudo crear la cuenta. Inténtalo de nuevo.' };
  }
  const id = creado.data.user.id;
  const fila = { auth_user_id: id, role: datos.rol, name: datos.nombre, is_active: true, mfa_required: false };
  const { error } = await cliente.from('admin_users').insert(fila);
  if (error) {
    // Sin fila en admin_users la cuenta no sirve: se deshace el alta para no dejar cuentas sueltas.
    await cliente.auth.admin.deleteUser(id);
    return { ok: false, ...traducirErrorBd(error) };
  }
  await auditarCambio({
    actor,
    accion: 'usuarios.creado',
    entidad: 'admin_users',
    entidadId: id,
    diff: { despues: { name: datos.nombre, role: datos.rol, is_active: true } },
    ip,
  });
  return { ok: true, id };
}

export async function editarUsuarioBd(args: Ctx & { datos: DatosEdicionUsuario }): Promise<ResultadoAccion> {
  const { cliente, datos, actor, ip } = args;
  const { data: antes } = await cliente.from('admin_users').select('*').eq('auth_user_id', datos.id).maybeSingle();
  if (!antes) return { ok: false, mensaje: 'Ese usuario ya no existe.' };
  const previo = antes as { role: string; is_active: boolean } & Record<string, unknown>;
  const rolPrevio: Rol = esRol(previo.role) ? previo.role : 'operator';
  const regla = validarCambioUsuario({
    actorId: actor,
    antes: { id: datos.id, rol: rolPrevio, activo: previo.is_active },
    despues: { rol: datos.rol, activo: datos.activo },
    adminsActivos: await contarAdminsActivos(cliente),
  });
  if (!regla.ok) return { ok: false, mensaje: regla.mensaje };

  const fila = { name: datos.nombre, role: datos.rol, is_active: datos.activo };
  const { error } = await cliente.from('admin_users').update(fila).eq('auth_user_id', datos.id);
  if (error) return { ok: false, ...traducirErrorBd(error) };
  await auditarCambio({ actor, accion: 'usuarios.actualizado', entidad: 'admin_users', entidadId: datos.id, diff: diffCampos(previo, fila), ip });
  return { ok: true, id: datos.id };
}

/** Fija una contraseña nueva (la persona la cambia pasándosela por un canal seguro). Solo se audita el hecho. */
export async function restablecerContrasenaBd(args: Ctx & { datos: DatosContrasena }): Promise<ResultadoAccion> {
  const { cliente, datos, actor, ip } = args;
  const { data: fila } = await cliente.from('admin_users').select('auth_user_id').eq('auth_user_id', datos.id).maybeSingle();
  if (!fila) return { ok: false, mensaje: 'Ese usuario ya no existe.' };
  const { error } = await cliente.auth.admin.updateUserById(datos.id, { password: datos.contrasena });
  if (error) {
    console.error('[usuarios] no se pudo fijar la contraseña:', error.message);
    return { ok: false, mensaje: 'No se pudo cambiar la contraseña. Revisa que no sea demasiado simple.' };
  }
  await auditarCambio({ actor, accion: 'usuarios.contrasena_restablecida', entidad: 'admin_users', entidadId: datos.id, ip });
  return { ok: true, id: datos.id };
}
