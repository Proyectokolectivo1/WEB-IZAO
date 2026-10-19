/**
 * Purga diaria de eventos antiguos de sesión de admin en `audit_log`.
 * Llama a `public.purgar_audit_log(p_dias)` (solo service_role) por PostgREST con la llave de
 * servidor. La función solo borra `entity = 'sesion_admin'` con más de `p_dias` (mínimo 30) y es
 * idempotente: repetirla no borra nada más. El resto de `audit_log` es inmutable.
 * Nunca se registra la llave ni el cuerpo de error del servidor.
 */
export const JOB_PURGAR_AUDIT_LOG = 'purgar-audit-log';

export interface OpcionesPurga {
  supabaseUrl?: string | undefined;
  secretKey?: string | undefined;
  /** Si se omite, la función usa su valor por defecto (180 días). */
  dias?: number | undefined;
  fetchImpl?: typeof fetch;
}

export async function purgarAuditLog(opciones: OpcionesPurga = {}): Promise<number> {
  const url = opciones.supabaseUrl ?? process.env.SUPABASE_URL;
  const llave = opciones.secretKey ?? process.env.SUPABASE_SECRET_KEY;
  if (!url) throw new Error('SUPABASE_URL no está definida');
  if (!llave) throw new Error('SUPABASE_SECRET_KEY no está definida');
  const doFetch = opciones.fetchImpl ?? fetch;

  const cuerpo = opciones.dias === undefined ? {} : { p_dias: opciones.dias };
  const respuesta = await doFetch(`${url.replace(/\/+$/, '')}/rest/v1/rpc/purgar_audit_log`, {
    method: 'POST',
    headers: {
      apikey: llave,
      Authorization: `Bearer ${llave}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(cuerpo),
  });

  if (!respuesta.ok) {
    // No se incluye el cuerpo: podría reflejar datos de la petición.
    throw new Error(`purgar_audit_log respondió HTTP ${respuesta.status}`);
  }
  const valor: unknown = await respuesta.json();
  const n = typeof valor === 'string' ? Number(valor) : valor;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) {
    throw new Error('purgar_audit_log devolvió un valor inesperado');
  }
  return n;
}
