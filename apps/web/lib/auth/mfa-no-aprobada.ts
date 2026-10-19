/**
 * Auditoría de `mfa_no_aprobado` desde el middleware: una sola fila por usuario
 * y ventana de 15 minutos, no una por petición (`audit_log` no admite DELETE).
 */
import { contarEventos, registrarEvento } from './auditoria';
import { registrarUnaVez } from './bloqueo';

const VENTANA_MS = 15 * 60 * 1000;

export async function auditarMfaNoAprobada(
  userId: string,
  ip: string | null,
  deps?: { contar: () => Promise<number | null>; registrar: () => Promise<boolean> },
): Promise<void> {
  await registrarUnaVez(
    deps ?? {
      contar: () =>
        contarEventos({
          acciones: ['mfa_no_aprobado'],
          desde: new Date(Date.now() - VENTANA_MS),
          actor: userId,
        }),
      registrar: () => registrarEvento({ actor: userId, accion: 'mfa_no_aprobado', entidadId: userId, ip }),
    },
  );
}
