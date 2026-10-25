/**
 * Usuarios del panel (§24.1): validación del alta, la edición y el cambio de contraseña, y las reglas que impiden
 * que el panel se quede sin administrador. Código puro, sin servidor. Las contraseñas solo viajan por el formulario:
 * nunca se guardan, se auditan ni se devuelven al navegador.
 */
import { z } from 'zod';
import { ETIQUETA_ROL, ROLES, type Rol } from '@/lib/auth/permissions';

export const MIN_CONTRASENA = 12;
/** bcrypt (Supabase Auth) solo usa los primeros 72 bytes. */
export const MAX_CONTRASENA = 72;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const casilla = z.preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean());

const contrasena = z
  .string({ error: 'Escribe la contraseña.' })
  .min(MIN_CONTRASENA, `Mínimo ${MIN_CONTRASENA} caracteres.`)
  .refine((v) => new TextEncoder().encode(v).length <= MAX_CONTRASENA, `Máximo ${MAX_CONTRASENA} caracteres.`);

const nombre = z.string().trim().min(2, 'Escribe el nombre.').max(80, 'Máximo 80 caracteres.');
const rol = z.enum(ROLES, { message: 'Elige un rol.' });

export type DatosNuevoUsuario = { correo: string; nombre: string; rol: Rol; contrasena: string };

export const esquemaNuevoUsuario = z
  .object({
    correo: z
      .string({ error: 'Escribe el correo.' })
      .trim()
      .toLowerCase()
      .max(254, 'El correo es demasiado largo.')
      .pipe(z.email('Escribe un correo válido.')),
    nombre,
    rol,
    contrasena,
    confirmar: z.string().default(''),
  })
  .refine((d) => d.contrasena === d.confirmar, { path: ['confirmar'], message: 'Las contraseñas no coinciden.' })
  .transform(({ confirmar: _c, ...d }): DatosNuevoUsuario => d);

export type DatosEdicionUsuario = { id: string; nombre: string; rol: Rol; activo: boolean };

export const esquemaEdicionUsuario = z.object({
  id: z.string().regex(UUID, 'Identificador no válido.'),
  nombre,
  rol,
  activo: casilla,
}) as unknown as z.ZodType<DatosEdicionUsuario, unknown>;

export type DatosContrasena = { id: string; contrasena: string };

export const esquemaContrasena = z
  .object({
    id: z.string().regex(UUID, 'Identificador no válido.'),
    contrasena,
    confirmar: z.string().default(''),
  })
  .refine((d) => d.contrasena === d.confirmar, { path: ['confirmar'], message: 'Las contraseñas no coinciden.' })
  .transform(({ confirmar: _c, ...d }): DatosContrasena => d);

export const ETIQUETA_ROL_USUARIO = ETIQUETA_ROL;

// ── Reglas de seguridad ──────────────────────────────────────────────────────────────────────────

export type UsuarioBasico = { id: string; rol: Rol; activo: boolean };

/**
 * ¿Se puede aplicar este cambio? Nadie se quita a sí mismo el rol de administrador ni se desactiva (se quedaría fuera
 * en plena sesión), y siempre debe quedar al menos un administrador activo.
 */
export function validarCambioUsuario(args: {
  actorId: string;
  antes: UsuarioBasico;
  despues: { rol: Rol; activo: boolean };
  /** Administradores activos ahora mismo (incluido el objetivo si lo es). */
  adminsActivos: number;
}): { ok: true } | { ok: false; mensaje: string } {
  const { actorId, antes, despues, adminsActivos } = args;
  const eraAdminActivo = antes.rol === 'admin' && antes.activo;
  const seraAdminActivo = despues.rol === 'admin' && despues.activo;
  if (antes.id === actorId && eraAdminActivo && !seraAdminActivo) {
    return { ok: false, mensaje: 'No puedes quitarte a ti mismo el rol de administrador ni desactivar tu cuenta. Pídeselo a otro administrador.' };
  }
  if (eraAdminActivo && !seraAdminActivo && adminsActivos <= 1) {
    return { ok: false, mensaje: 'Debe quedar al menos un administrador activo.' };
  }
  return { ok: true };
}

/** El objetivo de una acción sensible (contraseña, MFA) nunca puede ser una cuenta que no existe en el panel. */
export function esIdUsuario(v: unknown): v is string {
  return typeof v === 'string' && UUID.test(v);
}
