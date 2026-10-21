/**
 * Envoltorio de `activar_credencial_integracion(p_id)` (`20261021062843_credencial_activa_unica.sql`).
 *
 * SOLO SERVIDOR (panel /admin/integraciones). En una transacción apaga la credencial activa del mismo proveedor y
 * país (country null = global) y enciende la pedida. El índice único parcial `integration_credentials_one_active_key`
 * impide dos activas: cualquier otro UPDATE que lo intente falla con 23505. Contrato en `docs/estado/izao-db.md`.
 */
import 'server-only';
import { z } from 'zod';
import { llamarRpc } from './cliente';

const entorno = z.enum(['sandbox', 'production']);
const base = {
  ok: z.literal(true),
  id: z.guid(),
  provider: z.string(),
  country_code: z.string().nullable(),
  environment: entorno,
};

const resultadoSchema = z.union([
  z.object({
    ...base,
    estado: z.literal('activada'),
    anterior_id: z.guid().nullable(),
    anterior_environment: entorno.nullable(),
  }),
  z.object({ ...base, estado: z.literal('ya_activa') }),
  z.object({ ok: z.literal(false), motivo: z.enum(['no_existe', 'datos_invalidos']) }),
]);
export type ResultadoActivarCredencial = z.infer<typeof resultadoSchema>;

/**
 * Deja la credencial `id` como la única activa de su proveedor y país.
 * Un id que no es UUID responde `datos_invalidos` sin ir a la base. Lanza `ErrorDb` si la base falla.
 */
export async function activarCredencialIntegracionDb(id: string): Promise<ResultadoActivarCredencial> {
  if (!z.guid().safeParse(id).success) return { ok: false, motivo: 'datos_invalidos' };
  return llamarRpc('activar_credencial_integracion', { p_id: id }, resultadoSchema);
}
