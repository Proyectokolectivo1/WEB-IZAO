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

/** Consume la ventana al terminar la inscripción. */
export async function cerrarVentanaEnrolamiento(userId: string): Promise<void> {
  try {
    const { error } = await crearClienteServicio().auth.admin.updateUserById(userId, {
      app_metadata: { [CLAVE_ENROLAMIENTO]: null },
    });
    if (error) console.error('[mfa] no se pudo cerrar la ventana de enrolamiento:', error.message);
  } catch (e) {
    console.error('[mfa] no se pudo cerrar la ventana de enrolamiento:', e instanceof Error ? e.message : 'error');
  }
}
