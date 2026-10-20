import 'server-only';
/**
 * Auditoría de acciones del panel (§26.1: "toda acción"). `diff` guarda
 * antes/después; nunca debe llevar secretos. Un fallo se registra en consola
 * pero devuelve `false` para que la acción decida.
 */
import { esIp } from '@/lib/auth/ip';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';

export type EventoPanel = {
  actor: string;
  /** p. ej. `media.subida`, `producto.actualizado`. */
  accion: string;
  entidad: string;
  entidadId?: string | null;
  diff?: unknown;
  ip?: string | null;
};

export async function auditarCambio(e: EventoPanel): Promise<boolean> {
  try {
    const { error } = await crearClienteServicio()
      .from('audit_log')
      .insert({
        actor: e.actor,
        action: e.accion,
        entity: e.entidad,
        entity_id: e.entidadId ?? null,
        diff: e.diff ?? null,
        ip: e.ip && esIp(e.ip) ? e.ip : null,
      });
    if (error) {
      console.error('[auditoria-panel] no se pudo registrar:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[auditoria-panel] no se pudo registrar:', err instanceof Error ? err.message : 'error');
    return false;
  }
}
