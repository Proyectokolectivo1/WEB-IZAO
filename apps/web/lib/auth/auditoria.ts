/**
 * Registro en `audit_log` de los eventos de acceso (§26.1: "Auditoría de toda
 * acción del panel"). Se escribe desde el servidor con el rol de servicio.
 *
 * Nunca se guardan contraseñas, códigos TOTP ni secretos: el correo se guarda
 * solo como huella HMAC, para poder contar intentos fallidos sin exponerlo.
 */
import { isIP } from 'node:net';
import { netosDe } from './bloqueo';
import { secretoSesion } from './env';
import { firmarHmac } from './llaves';
import { crearClienteServicio } from './supabase/servicio';

export type AccionAcceso =
  | 'login_intento'
  | 'login_exitoso'
  | 'login_fallido'
  | 'login_denegado'
  | 'login_bloqueado'
  | 'logout'
  | 'mfa_intento'
  | 'mfa_inscripcion_iniciada'
  | 'mfa_inscrito'
  | 'mfa_verificado'
  | 'mfa_fallido'
  | 'mfa_bloqueado';

export type EventoAuditoria = {
  /** Id del usuario de Auth, o `anonimo` si aún no se sabe quién es. */
  actor: string;
  accion: AccionAcceso;
  entidad?: string;
  entidadId?: string | null;
  diff?: Record<string, string | number | boolean | null>;
  ip?: string | null;
};

export type FilaAuditoria = {
  actor: string;
  action: string;
  entity: string;
  entity_id: string | null;
  diff: Record<string, string | number | boolean | null> | null;
  ip: string | null;
};

/** Construye la fila: descarta una IP inválida (la columna es `inet`). */
export function construirFilaAuditoria(evento: EventoAuditoria): FilaAuditoria {
  const ip = evento.ip && isIP(evento.ip) !== 0 ? evento.ip : null;
  return {
    actor: evento.actor,
    action: evento.accion,
    entity: evento.entidad ?? 'sesion_admin',
    entity_id: evento.entidadId ?? null,
    diff: evento.diff ?? null,
    ip,
  };
}

/** Huella no reversible del correo, estable para contar intentos. */
export async function huellaCorreo(correo: string, claveBase64: string): Promise<string> {
  const firma = await firmarHmac(claveBase64, 'huella-correo-v1', correo.trim().toLowerCase());
  return firma.slice(0, 32);
}

export function huellaDeCorreo(correo: string): Promise<string> {
  return huellaCorreo(correo, secretoSesion());
}

/**
 * Escribe el evento. Un fallo al auditar se informa por consola (solo el
 * mensaje) pero no interrumpe el inicio de sesión.
 */
export async function registrarAuditoria(evento: EventoAuditoria): Promise<void> {
  try {
    const { error } = await crearClienteServicio()
      .from('audit_log')
      .insert(construirFilaAuditoria(evento));
    if (error) console.error('[auditoria] no se pudo registrar:', error.message);
  } catch (e) {
    console.error('[auditoria] no se pudo registrar:', e instanceof Error ? e.message : 'error');
  }
}

/**
 * Registra un evento y avisa si se guardó. Para el bloqueo por intentos: si no
 * se guarda, el llamador debe negar el acceso (falla cerrado).
 */
export async function registrarEvento(evento: EventoAuditoria): Promise<boolean> {
  try {
    const { error } = await crearClienteServicio().from('audit_log').insert(construirFilaAuditoria(evento));
    if (error) {
      console.error('[auditoria] no se pudo registrar:', error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[auditoria] no se pudo registrar:', e instanceof Error ? e.message : 'error');
    return false;
  }
}

export type FiltroConteo = {
  acciones: AccionAcceso[];
  desde: Date;
  huella?: string;
  ip?: string | null;
  actor?: string;
};

/** Cuenta eventos de la ventana. Devuelve `null` si la consulta falla (nunca 0). */
export async function contarEventos(filtro: FiltroConteo): Promise<number | null> {
  try {
    let consulta = crearClienteServicio()
      .from('audit_log')
      .select('id', { count: 'exact', head: true })
      .in('action', filtro.acciones)
      .gte('created_at', filtro.desde.toISOString());
    if (filtro.huella) consulta = consulta.contains('diff', { huella_correo: filtro.huella });
    if (filtro.ip && isIP(filtro.ip) !== 0) consulta = consulta.eq('ip', filtro.ip);
    if (filtro.actor) consulta = consulta.eq('actor', filtro.actor);
    const { count, error } = await consulta;
    if (error || count === null) return null;
    return count;
  } catch {
    return null;
  }
}

/** Intentos sin éxito: `accionIntento` menos los `accionesExito` de la misma clave. */
export async function contarNetos(
  accionIntento: AccionAcceso,
  accionesExito: AccionAcceso[],
  clave: Omit<FiltroConteo, 'acciones'>,
): Promise<number | null> {
  const [intentos, exitos] = await Promise.all([
    contarEventos({ ...clave, acciones: [accionIntento] }),
    contarEventos({ ...clave, acciones: accionesExito }),
  ]);
  return netosDe(intentos, exitos);
}
