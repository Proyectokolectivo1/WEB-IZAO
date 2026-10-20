/**
 * Envoltorio de `pay_link_click(p_token text)` (`20261020221412_clic_pay_link_y_envio_whatsapp_unico.sql`).
 *
 * SOLO SERVIDOR (ruta `/pagar/{token}`). Suma un clic de forma atómica y dice qué hacer:
 * `vigente` → redirigir a `target_url`; `pagado` → "Ya recibimos tu abono"; `vencido` → asesor.
 * `target_url` solo llega cuando el link está vigente. Contrato en `docs/estado/izao-db.md`.
 */
import 'server-only';
import { z } from 'zod';
import { llamarRpc } from './cliente';

/** Mismo patrón que el CHECK de `pay_links.token`. */
export const tokenPayLinkSchema = z.string().regex(/^[A-Za-z0-9_-]{6,64}$/);

const base = {
  ok: z.literal(true),
  order_id: z.guid(),
  order_number: z.string().nullable(),
  clicks: z.number().int().nonnegative(),
  expires_at: z.string(),
};

const resultadoSchema = z.union([
  z.object({ ...base, estado: z.literal('vigente'), target_url: z.url() }),
  z.object({ ...base, estado: z.enum(['pagado', 'vencido']) }),
  z.object({ ok: z.literal(false), motivo: z.enum(['no_existe', 'datos_invalidos']) }),
]);
export type ResultadoClicPayLink = z.infer<typeof resultadoSchema>;

/**
 * Registra el clic. Un token mal formado responde `datos_invalidos` sin ir a la base.
 * Lanza `ErrorDb` si la base falla o la respuesta cambia de forma.
 */
export async function registrarClicPayLinkDb(token: string): Promise<ResultadoClicPayLink> {
  if (!tokenPayLinkSchema.safeParse(token).success) {
    return { ok: false, motivo: 'datos_invalidos' };
  }
  return llamarRpc('pay_link_click', { p_token: token }, resultadoSchema);
}
