import 'server-only';
/**
 * Guardias de servidor para páginas y Server Actions del panel. Repiten, con la
 * misma lógica del middleware, la verificación de sesión, usuario activo,
 * vigencia de 12 h y permiso: el middleware no es la única barrera (§24, skill
 * `izao-panel-admin`).
 */
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { buscarAdminPorId, type FilaAdmin } from './admin-users';
import { cargarContexto } from './contexto';
import { RUTA_LOGIN, RUTA_SIN_PERMISO } from './decision';
import { esRol, puede, puedeAccederModulo, type AccionId, type ModuloId, type Rol } from './permissions';
import { secretoSesion } from './env';
import { NOMBRE_COOKIE_MARCA } from './marca-sesion';
import { crearClienteServidor } from './supabase/servidor';

export type ContextoAdmin = {
  userId: string;
  email: string | null;
  nombre: string;
  rol: Rol;
};

/** Error de permiso para Server Actions: la acción lo captura y responde sin datos. */
export class ErrorSinPermiso extends Error {
  constructor(mensaje = 'No tienes permiso para esta acción.') {
    super(mensaje);
    this.name = 'ErrorSinPermiso';
  }
}

type Resultado =
  | { estado: 'ok'; contexto: ContextoAdmin }
  | { estado: 'sin-sesion' }
  | { estado: 'sin-acceso' };

const cargar = cache(async (): Promise<Resultado> => {
  const supabase = await crearClienteServidor();
  const almacen = await cookies();
  const ctx = await cargarContexto<FilaAdmin>({
    supabase,
    buscarAdmin: buscarAdminPorId,
    marca: almacen.get(NOMBRE_COOKIE_MARCA)?.value,
    ahoraMs: Date.now(),
    secreto: secretoSesion(),
  });

  if (!ctx.sesion || !ctx.sesionVigente) return { estado: 'sin-sesion' };
  const admin = ctx.admin;
  if (!admin || !admin.isActive || !esRol(admin.role)) return { estado: 'sin-acceso' };
  return {
    estado: 'ok',
    contexto: { userId: ctx.sesion.userId, email: ctx.email, nombre: admin.name, rol: admin.role },
  };
});

/**
 * Exige sesión (activo, vigente) y, si se indica, acceso al
 * módulo o a la acción. En páginas redirige; en acciones lanza `ErrorSinPermiso`
 * cuando falta el permiso de la acción.
 */
export async function requerirAdmin(
  opciones: { modulo?: ModuloId; accion?: AccionId } = {},
): Promise<ContextoAdmin> {
  const r = await cargar();
  if (r.estado === 'sin-sesion') redirect(RUTA_LOGIN);
  if (r.estado === 'sin-acceso') redirect(`${RUTA_LOGIN}?error=sin-acceso`);
  if (r.estado !== 'ok') redirect(RUTA_LOGIN);

  const { contexto } = r;
  if (opciones.modulo && !puedeAccederModulo(contexto.rol, opciones.modulo)) {
    redirect(RUTA_SIN_PERMISO);
  }
  if (opciones.accion && !puede(contexto.rol, opciones.accion)) {
    throw new ErrorSinPermiso();
  }
  return contexto;
}
