/**
 * Envoltorio de `activar_plantilla_whatsapp(p_id, p_meta_template_id)` (`20261021011746_activar_plantilla_whatsapp.sql`).
 *
 * SOLO SERVIDOR (panel de plantillas; el worker llama el mismo RPC por PostgREST con `{p_id, p_meta_template_id}`).
 * En una transacción desactiva la versión activa y activa la pedida (approved, sin motivo de rechazo);
 * no la activa si la vigente es más nueva. Contrato en `docs/estado/izao-db.md`.
 */
import 'server-only';
import { z } from 'zod';
import { llamarRpc } from './cliente';

const base = { ok: z.literal(true), id: z.guid(), version: z.number().int().positive() };

const resultadoSchema = z.union([
  z.object({
    ...base,
    estado: z.literal('activada'),
    anterior_id: z.guid().nullable(),
    anterior_version: z.number().int().positive().nullable(),
  }),
  z.object({ ...base, estado: z.literal('ya_activa') }),
  z.object({
    ...base,
    estado: z.literal('aprobada_sin_activar'),
    activa_id: z.guid(),
    activa_version: z.number().int().positive(),
  }),
  z.object({ ok: z.literal(false), motivo: z.enum(['no_existe', 'datos_invalidos']) }),
]);
export type ResultadoActivarPlantilla = z.infer<typeof resultadoSchema>;

/**
 * Activa la versión `id` de la plantilla. `metaTemplateId` (opcional) se guarda si llega.
 * Un id que no es UUID responde `datos_invalidos` sin ir a la base. Lanza `ErrorDb` si la base falla.
 */
export async function activarPlantillaWhatsAppDb(
  id: string,
  metaTemplateId?: string | null,
): Promise<ResultadoActivarPlantilla> {
  if (!z.guid().safeParse(id).success) return { ok: false, motivo: 'datos_invalidos' };
  const args: { p_id: string; p_meta_template_id?: string } = { p_id: id };
  if (metaTemplateId) args.p_meta_template_id = metaTemplateId;
  return llamarRpc('activar_plantilla_whatsapp', args, resultadoSchema);
}
