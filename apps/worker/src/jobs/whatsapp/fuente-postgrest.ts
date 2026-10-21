/**
 * `FuenteEventosWa` por PostgREST (dueño: izao-pagos). Pedido, `pay_links` y alertas vienen de la fuente de
 * contra entrega. Los cambios de estado de `whatsapp_messages` son condicionales (`status=in.(…)`): un estado
 * repetido o fuera de orden no retrocede.
 *
 * `activarPlantilla` hace dos updates (desactivar la anterior, activar la nueva) por el índice único parcial
 * `whatsapp_templates_one_active_idx`; entre ambos no hay versión activa unos milisegundos (un envío en esa ventana
 * registra `plantilla_no_activa`). Pedido a izao-db: RPC atómica `activar_plantilla_whatsapp`.
 */
import type { CountryCode } from '@izao/core/money';
import { crearFuenteCodPostgrest } from '../cod/fuente-postgrest.js';
import { crearClientePostgrest, eq, type Fila, type OpcionesPostgrest } from '../postgrest.js';
import type { EstadoMensajeFila, EstadoMetaPlantilla, FuenteEventosWa, PlantillaFila } from './fuente.js';

const COLUMNAS_PLANTILLA = 'id,key,country_code,version,meta_status,is_active,meta_template_id';
const minimo = { prefer: 'return=minimal' } as const;

function aPlantilla(f: Fila): PlantillaFila {
  return {
    id: String(f.id),
    key: String(f.key),
    country_code: f.country_code as CountryCode,
    version: Number(f.version),
    meta_status: f.meta_status as EstadoMetaPlantilla,
    is_active: f.is_active === true,
    meta_template_id: (f.meta_template_id as string | null) ?? null,
  };
}

export function crearFuenteWaPostgrest(o: OpcionesPostgrest): FuenteEventosWa {
  const c = crearClientePostgrest(o);
  const cod = crearFuenteCodPostgrest(o);
  const { pedir, filas } = c;

  return {
    pedido: (id) => cod.pedido(id),
    payLink: (id) => cod.payLink(id),
    registrarAlerta: (id, motivo, payload) => cod.registrarAlerta(id, motivo, payload),

    async evento(eventId) {
      const [f] = await filas('webhook_events', `webhook_events?provider=eq.whatsapp&event_id=${eq(eventId)}&select=payload,processed_at`);
      return f ? { payload: f.payload, procesado: f.processed_at !== null && f.processed_at !== undefined } : null;
    },
    async marcarEvento(eventId, r) {
      const cuerpo = r.ok ? { processed_at: new Date().toISOString(), error: null } : { error: r.error.slice(0, 200) };
      await pedir('webhook_events', `webhook_events?provider=eq.whatsapp&event_id=${eq(eventId)}`, {
        method: 'PATCH',
        headers: minimo,
        body: JSON.stringify(cuerpo),
      });
    },
    async mensajePorWamid(wamid) {
      const [f] = await filas('whatsapp_messages', `whatsapp_messages?wa_message_id=${eq(wamid)}&select=id,order_id,status,whatsapp_templates(key)`);
      if (!f) return null;
      return {
        id: String(f.id),
        order_id: (f.order_id as string | null) ?? null,
        status: f.status as EstadoMensajeFila,
        template_key: String((f.whatsapp_templates as { key?: unknown } | null)?.key ?? ''),
      };
    },
    async actualizarMensaje(id, desde, cambio) {
      if (desde.length === 0) return false;
      const r = (await pedir('whatsapp_messages', `whatsapp_messages?id=${eq(id)}&status=in.(${desde.join(',')})&select=id`, {
        method: 'PATCH',
        headers: { prefer: 'return=representation' },
        body: JSON.stringify(cambio),
      })) as Fila[] | null;
      return (r ?? []).length > 0;
    },
    async plantillaPorMeta(metaId, nombre, idioma) {
      const [porId] = await filas('whatsapp_templates', `whatsapp_templates?meta_template_id=${eq(metaId)}&select=${COLUMNAS_PLANTILLA}&limit=1`);
      if (porId) return aPlantilla(porId);
      // El mismo nombre puede existir en CO y EC: solo se acepta si hay exactamente una fila sin id de Meta.
      const porNombre = await filas(
        'whatsapp_templates',
        `whatsapp_templates?meta_template_name=${eq(nombre)}&language=${eq(idioma)}&meta_template_id=is.null&select=${COLUMNAS_PLANTILLA}&limit=2`,
      );
      return porNombre.length === 1 ? aPlantilla(porNombre[0]!) : null;
    },
    async plantillaActivaDe(key, pais) {
      const [f] = await filas(
        'whatsapp_templates',
        `whatsapp_templates?key=${eq(key)}&country_code=${eq(pais)}&is_active=is.true&select=${COLUMNAS_PLANTILLA}&limit=1`,
      );
      return f ? aPlantilla(f) : null;
    },
    async actualizarPlantilla(id, cambio) {
      await pedir('whatsapp_templates', `whatsapp_templates?id=${eq(id)}`, {
        method: 'PATCH',
        headers: minimo,
        body: JSON.stringify({
          meta_status: cambio.meta_status,
          meta_rejection_reason: cambio.meta_rejection_reason?.slice(0, 500) ?? null,
          ...(cambio.meta_template_id ? { meta_template_id: cambio.meta_template_id } : {}),
        }),
      });
    },
    async activarPlantilla(t, metaId) {
      await pedir('whatsapp_templates', `whatsapp_templates?key=${eq(t.key)}&country_code=${eq(t.country_code)}&is_active=is.true&id=neq.${encodeURIComponent(t.id)}`, {
        method: 'PATCH',
        headers: minimo,
        body: JSON.stringify({ is_active: false }),
      });
      await pedir('whatsapp_templates', `whatsapp_templates?id=${eq(t.id)}`, {
        method: 'PATCH',
        headers: minimo,
        body: JSON.stringify({ is_active: true, meta_status: 'approved', meta_rejection_reason: null, meta_template_id: metaId }),
      });
    },
  };
}
