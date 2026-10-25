'use server';

import { redirect } from 'next/navigation';
import { auditarCambio } from '@/lib/admin/auditoria';
import type { ResultadoAccion } from '@/lib/admin/crud/comun';
import { adminDeAccion } from '@/lib/admin/crud/servidor';
import { reintentarJobFallido } from '@/lib/admin/sistema/colas';
import { ipDelCliente } from '@/lib/auth/cabeceras';

/** Reintenta un job fallido de una cola. Los jobs son idempotentes; queda en la auditoría. */
export async function reintentarJob(cola: string, jobId: string): Promise<ResultadoAccion> {
  const entrada = await adminDeAccion('sistema', 'sistema.reintentar_job');
  if ('error' in entrada) return entrada.error;
  const r = await reintentarJobFallido(cola, jobId);
  if (!r.ok) return { ok: false, mensaje: r.mensaje };
  await auditarCambio({
    actor: entrada.admin.userId,
    accion: 'sistema.job_reintentado',
    entidad: 'cola',
    entidadId: cola,
    diff: { job: jobId },
    ip: await ipDelCliente(),
  });
  redirect('/admin/sistema?reintentado=1');
}
