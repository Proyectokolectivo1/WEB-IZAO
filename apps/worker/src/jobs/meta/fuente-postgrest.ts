/**
 * `FuenteConversiones` contra Supabase por PostgREST con la llave de servidor. La credencial de `meta_pixel` es la activa
 * del país del pedido (CO y EC no se mezclan), descifrada con `APP_ENCRYPTION_KEY`. Nunca se registran tokens ni respuestas.
 */
import { fromDbAmount, type CountryCode } from '@izao/core/money';
import { esPixelId, idContenido } from '@izao/meta-pixel';
import type { NavegadorMeta } from '@izao/meta-pixel/capi';
import { crearClientePostgrest, eq, type OpcionesPostgrest } from '../postgrest.js';
import type { FuenteConversiones } from './conversiones.js';

const txt = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

function navegadorDe(v: unknown): NavegadorMeta | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  return { fbp: txt(o.fbp), fbc: txt(o.fbc), ip: txt(o.ip), ua: txt(o.ua) };
}

export function crearFuenteConversionesPostgrest(o: OpcionesPostgrest): FuenteConversiones {
  const c = crearClientePostgrest(o);
  return {
    async pedido(orderId) {
      const [f] = await c.filas(
        'orders',
        `orders?id=${eq(orderId)}&select=number,country_code,paid_at,total_customer,contact_email,contact_phone_e164,marketing_consent,contact_first_name,contact_last_name,shipping_city_name,meta_user_data`,
      );
      if (!f) return null;
      const pais = f.country_code === 'CO' || f.country_code === 'EC' ? (f.country_code as CountryCode) : null;
      const numero = txt(f.number);
      if (!pais || !numero) return null;
      const items = await c.filas('order_items', `order_items?order_id=${eq(orderId)}&select=sku,variant_id,quantity,unit_price&order=created_at.asc`);
      return {
        id: orderId,
        numero,
        pais,
        pagadoEn: typeof f.paid_at === 'string' ? new Date(f.paid_at) : null,
        total: fromDbAmount(f.total_customer as string | number),
        correo: txt(f.contact_email),
        telefono: txt(f.contact_phone_e164),
        // Opt-in estricto: solo el booleano `true`; nulo, ausente o cualquier otro valor = sin consentimiento.
        consentimientoMarketing: f.marketing_consent === true,
        nombre: txt(f.contact_first_name),
        apellido: txt(f.contact_last_name),
        ciudad: txt(f.shipping_city_name),
        navegador: navegadorDe(f.meta_user_data),
        lineas: items.map((i) => ({
          id: idContenido(txt(i.sku), String(i.variant_id ?? i.sku ?? 'sin-id')),
          cantidad: Number(i.quantity),
          precioUnitario: fromDbAmount(i.unit_price as string | number),
        })),
      };
    },
    async yaEnviado(orderId) {
      const f = await c.filas('order_events', `order_events?order_id=${eq(orderId)}&type=eq.meta_capi_purchase&select=id&limit=1`);
      return f.length > 0;
    },
    async credencial(pais) {
      const r = await c.credencial('meta_pixel', pais, 'meta');
      const pixelId = r?.valores.pixel_id;
      const token = r?.valores.capi_token;
      return esPixelId(pixelId) && token ? { pixelId, token } : null;
    },
    async registrarEvento(orderId, tipo, actor, payload) {
      await c.pedir('order_events', 'order_events', {
        method: 'POST',
        headers: { prefer: 'return=minimal' },
        body: JSON.stringify({ order_id: orderId, type: tipo, actor, payload }),
      });
    },
  };
}
