/** `FuenteResenas` con el rol de servicio. Las fotos van por el pipeline de imágenes (`media.kind = 'review'`). */
import 'server-only';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';
import { descartarMediaPublica, guardarFotoPublica } from '../media-publica';
import type { FuenteResenas } from './proceso';

export const fuenteResenasSupabase: FuenteResenas = {
  async productoVisible(pais, productoId) {
    const { data, error } = await crearClienteServicio()
      .from('catalog_listing')
      .select('product_id')
      .eq('country_code', pais)
      .eq('product_id', productoId)
      .eq('is_visible', true)
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`catalog_listing: ${error.message}`);
    return data !== null;
  },

  async pedidoPorNumero(pais, numero, productoId) {
    const db = crearClienteServicio();
    const { data, error } = await db
      .from('orders')
      .select('id, contact_phone_e164, delivered_at')
      .eq('number', numero)
      .eq('country_code', pais)
      .maybeSingle();
    if (error) throw new Error(`orders: ${error.message}`);
    if (!data) return null;
    const f = data as { id: string; contact_phone_e164: string | null; delivered_at: string | null };
    const { data: lineas, error: e2 } = await db.from('order_items').select('id').eq('order_id', f.id).eq('product_id', productoId).limit(1);
    if (e2) throw new Error(`order_items: ${e2.message}`);
    return { id: f.id, celularE164: f.contact_phone_e164 ?? '', entregado: f.delivered_at !== null, incluyeProducto: (lineas ?? []).length > 0 };
  },

  async resenaReciente(productoId, autor, texto, desde) {
    const { data, error } = await crearClienteServicio()
      .from('reviews')
      .select('id')
      .eq('product_id', productoId)
      .eq('author_name', autor)
      .eq('body', texto)
      .gte('created_at', desde.toISOString())
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`reviews: ${error.message}`);
    return data !== null;
  },

  guardarFoto: (buffer, nombre) => guardarFotoPublica({ kind: 'review', alt: 'Foto enviada con una reseña', buffer, nombre }),
  descartarMedia: descartarMediaPublica,

  async crear(r) {
    const { error } = await crearClienteServicio()
      .from('reviews')
      .insert({
        country_code: r.pais,
        product_id: r.productoId,
        author_name: r.autor,
        city: r.ciudad,
        rating: r.estrellas,
        body: r.texto,
        media_ids: r.mediaIds,
        source: 'customer',
        order_id: r.pedidoId,
        is_verified_purchase: r.verificada,
        status: 'pending',
      });
    if (error) throw new Error(`reviews: ${error.message}`);
  },
};
