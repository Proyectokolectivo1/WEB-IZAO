/**
 * Ventana de enrolamiento de MFA.
 *
 * Sin esto, quien conozca solo la contraseña de una cuenta del panel podría
 * inscribir SU propio TOTP en el primer acceso. Por eso inscribir un factor
 * exige un indicador en `app_metadata` (que el usuario no puede editar; solo el
 * servicio) con vencimiento: lo fija `crear-admin` (o el futuro módulo Usuarios)
 * y se consume al terminar la inscripción.
 *
 * Código puro, sin dependencias de servidor: lo usan las acciones y el script.
 */

export const CLAVE_ENROLAMIENTO = 'mfa_enrolamiento_hasta';

/** Tiempo que el dueño tiene para activar su verificación tras crear la cuenta. */
export const DURACION_VENTANA_ENROLAMIENTO_MS = 24 * 60 * 60 * 1000;

/** `app_metadata` que abre la ventana a partir de `ahoraMs`. */
export function metadataHabilitarEnrolamiento(
  ahoraMs: number,
  duracionMs: number = DURACION_VENTANA_ENROLAMIENTO_MS,
): Record<string, string> {
  return { [CLAVE_ENROLAMIENTO]: new Date(ahoraMs + duracionMs).toISOString() };
}

/** ¿La ventana está abierta y vigente? Cualquier valor raro cuenta como cerrada. */
export function enrolamientoPermitido(
  appMetadata: Record<string, unknown> | null | undefined,
  ahoraMs: number,
): boolean {
  const valor = appMetadata?.[CLAVE_ENROLAMIENTO];
  if (typeof valor !== 'string') return false;
  const hasta = Date.parse(valor);
  return Number.isFinite(hasta) && ahoraMs < hasta;
}
