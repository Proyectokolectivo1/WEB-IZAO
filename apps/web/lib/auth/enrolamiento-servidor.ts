import 'server-only';
/** Lectura y cierre de la ventana de enrolamiento MFA (ver `enrolamiento.ts`). */
import { CLAVE_ENROLAMIENTO, enrolamientoPermitido } from './enrolamiento';
import { crearClienteServicio } from './supabase/servicio';
import { crearClienteServidor } from './supabase/servidor';

/** ¿El usuario de la sesión tiene la ventana abierta? Falla cerrado. */
export async function ventanaEnrolamientoAbierta(): Promise<boolean> {
  try {
    const supabase = await crearClienteServidor();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return false;
    return enrolamientoPermitido(data.user.app_metadata as Record<string, unknown>, Date.now());
  } catch {
    return false;
  }
}

/** `app_metadata` donde el servicio guarda el factor TOTP aprobado (A-3). */
export const CLAVE_FACTOR_APROBADO = 'mfa_factor_aprobado';

/** Factor aprobado de la sesión actual, o `null`. */
export async function factorAprobadoDeLaSesion(): Promise<string | null> {
  try {
    const supabase = await crearClienteServidor();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;
    const valor = (data.user.app_metadata as Record<string, unknown>)[CLAVE_FACTOR_APROBADO];
    return typeof valor === 'string' && valor !== '' ? valor : null;
  } catch {
    return null;
  }
}

/**
 * Al terminar la inscripción: guarda con el rol de servicio el factor aprobado y
 * consume la ventana. Devuelve `false` si no se pudo guardar (falla cerrado: sin
 * aprobación el factor no sirve para entrar).
 */
export async function aprobarFactor(userId: string, factorId: string): Promise<boolean> {
  try {
    const { error } = await crearClienteServicio().auth.admin.updateUserById(userId, {
      app_metadata: { [CLAVE_FACTOR_APROBADO]: factorId, [CLAVE_ENROLAMIENTO]: null },
    });
    if (error) console.error('[mfa] no se pudo aprobar el factor:', error.message);
    return !error;
  } catch (e) {
    console.error('[mfa] no se pudo aprobar el factor:', e instanceof Error ? e.message : 'error');
    return false;
  }
}
