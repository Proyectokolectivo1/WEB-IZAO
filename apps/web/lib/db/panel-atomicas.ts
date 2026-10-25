/**
 * Envoltorios de las RPC atómicas del panel (`20261025143040_rpc_atomicas_panel_anonimizar_cancelar_publicar.sql`).
 *
 * SOLO SERVIDOR (panel /admin). Cada una corre en una sola transacción: si algo falla no queda nada escrito.
 * - `anonimizarClienteDb`: habeas data (§26.2). Mismas reglas que `lib/admin/clientes`.
 * - `cancelarPedidoDb`: `→ cancelado` + liberar la reserva y devolver el stock pagado (D-035). MasterShop va antes (externa).
 * - `publicarPaginaDb`: guarda la página y, si queda publicada y es de tipo único, despublica la anterior.
 * Contrato en `docs/estado/izao-db.md`.
 */
import 'server-only';
import { z } from 'zod';
import { ORDER_STATUSES, ORDER_TRANSITIONS, type OrderStatus } from '@izao/core/order-state';
import { llamarRpc } from './cliente';

// ── Anonimizar cliente ──────────────────────────────────────────────────────────────────────────

const anonimizarSchema = z.union([
  z.object({
    ok: z.literal(true),
    estado: z.literal('anonimizado'),
    id: z.guid(),
    pedidos: z.number().int(),
    mensajes_whatsapp: z.number().int(),
    garantias: z.number().int(),
    leads: z.number().int(),
    direcciones: z.number().int(),
    deseos: z.number().int(),
    conversaciones: z.number().int(),
    cuenta_acceso_eliminada: z.boolean(),
    /** 20261025191446: pagos con `raw_last_event` vaciado, webhooks recortados, reseñas y fotos de garantía retiradas. */
    pagos_limpiados: z.number().int(),
    webhooks_recortados: z.number().int(),
    resenas: z.number().int(),
    fotos_garantia: z.number().int(),
  }),
  z.object({
    ok: z.literal(false),
    motivo: z.literal('bloqueado'),
    cuenta_del_panel: z.boolean(),
    pedidos_en_curso: z.number().int(),
    garantias_abiertas: z.number().int(),
  }),
  z.object({ ok: z.literal(false), motivo: z.enum(['datos_invalidos', 'no_existe', 'ya_anonimizado']) }),
]);
export type ResultadoAnonimizar = z.infer<typeof anonimizarSchema>;

/** Anonimiza al cliente `id` y sus rastros. Irreversible. Lanza `ErrorDb` si la base falla. */
export async function anonimizarClienteDb(id: string): Promise<ResultadoAnonimizar> {
  if (!z.guid().safeParse(id).success) return { ok: false, motivo: 'datos_invalidos' };
  return llamarRpc('anonimizar_cliente', { p_id: id }, anonimizarSchema);
}

// ── Cancelar pedido ─────────────────────────────────────────────────────────────────────────────

/** Estados desde los que `@izao/core/order-state` permite cancelar (la RPC repite esta lista). */
export const ESTADOS_CANCELABLES: readonly OrderStatus[] = ORDER_STATUSES.filter((s) => ORDER_TRANSITIONS[s].includes('cancelado'));

const estado = z.enum(ORDER_STATUSES);
const cancelarSchema = z.union([
  z.object({
    ok: z.literal(true),
    order_id: z.guid(),
    from_status: estado,
    to_status: z.literal('cancelado'),
    event_id: z.guid(),
    /** Estado del stock tras cancelar: `released`, `none` o `confirmed` (solo si la transportadora ya recolectó). */
    stock_estado: z.string(),
    stock_liberado: z.boolean(),
    /** El stock ya descontado por el pago volvió al inventario (D-035). */
    stock_devuelto: z.boolean(),
    unidades_devueltas: z.number().int(),
    /** `envio_recolectado`: no se devolvió porque el paquete ya salió con la transportadora. */
    stock_retenido: z.literal('envio_recolectado').nullable(),
  }),
  z.object({
    ok: z.literal(false),
    motivo: z.enum(['transicion_invalida', 'estado_cambiado', 'pedido_inexistente', 'datos_invalidos']),
    status_actual: estado.optional(),
    from_status: z.string().optional(),
    detalle: z.string().optional(),
  }),
]);
export type ResultadoCancelar = z.infer<typeof cancelarSchema>;

export const entradaCancelarSchema = z.object({
  order_id: z.guid(),
  /** Estado leído antes de llamar: la RPC solo cancela si sigue siendo este. */
  from_status: estado,
  /** `admin:<id>`, `system`, `agent` o `webhook:<proveedor>`. */
  actor: z.string().regex(/^(system|agent|admin:.+|webhook:.+)$/),
  motivo: z.string().trim().max(500).optional(),
  cancelled_at: z.union([z.date().transform((d) => d.toISOString()), z.string().datetime({ offset: true })]).optional(),
});
export type EntradaCancelar = z.input<typeof entradaCancelarSchema>;

/** Cancela y libera la reserva en una transacción. Lanza `ZodError` si la entrada es inválida y `ErrorDb` si la base falla. */
export async function cancelarPedidoDb(entrada: EntradaCancelar): Promise<ResultadoCancelar> {
  const p = entradaCancelarSchema.parse(entrada);
  return llamarRpc('cancelar_pedido', { p }, cancelarSchema);
}

// ── Publicar página ─────────────────────────────────────────────────────────────────────────────

export const entradaPaginaSchema = z.object({
  id: z.guid().optional(),
  country_code: z.enum(['CO', 'EC']),
  kind: z.enum(['general', 'quienes_somos', 'envios', 'tratamiento_datos', 'terminos', 'devoluciones']),
  slug: z.string().min(1),
  title: z.string().min(1),
  content_html: z.string(),
  seo_title: z.string().nullable().optional(),
  seo_description: z.string().nullable().optional(),
  status: z.enum(['draft', 'published']),
  /** auth_user_id de quien guarda. */
  updated_by: z.guid().optional(),
});
export type EntradaPagina = z.input<typeof entradaPaginaSchema>;

const paginaSchema = z.union([
  z.object({
    ok: z.literal(true),
    estado: z.enum(['creada', 'actualizada']),
    id: z.guid(),
    version: z.number().int(),
    status: z.enum(['draft', 'published']),
    publicada_ahora: z.boolean(),
    despublicada: z.object({ id: z.guid(), title: z.string(), country_code: z.string() }).nullable(),
    antes: z
      .object({
        country_code: z.string(),
        kind: z.string(),
        slug: z.string(),
        title: z.string(),
        status: z.string(),
        version: z.number().int(),
        seo_title: z.string().nullable(),
        seo_description: z.string().nullable(),
        content_length: z.number().int(),
      })
      .nullable(),
  }),
  z.object({
    ok: z.literal(false),
    motivo: z.enum(['no_existe', 'marcadores_pendientes', 'slug_duplicado', 'publicada_duplicada', 'datos_invalidos']),
    detalle: z.string().optional(),
  }),
]);
export type ResultadoPagina = z.infer<typeof paginaSchema>;

/** Guarda (y publica) la página en una transacción. Lanza `ZodError` si la entrada es inválida y `ErrorDb` si la base falla. */
export async function publicarPaginaDb(entrada: EntradaPagina): Promise<ResultadoPagina> {
  const p = entradaPaginaSchema.parse(entrada);
  return llamarRpc('admin_publicar_pagina', { p }, paginaSchema);
}
