/**
 * `FuenteGarantias` con el rol de servicio. Las fotos se re-codifican a WebP con el pipeline de `izao-imagenes`
 * (elimina EXIF y contenido incrustado, §26.1); el video se escribe tal cual en `MEDIA_ROOT/warranty/…` y su ruta
 * queda en una fila de `media` (`variants.video`): el archivo vive en disco, no en la base (§19).
 */
import 'server-only';
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';
import { escribirVariantes, raizMedia, rutaBase } from '@/lib/admin/media/guardar';
import { procesarImagen } from '@/lib/admin/media/procesar';
import { validarArchivo } from '@/lib/admin/media/validar';
import type { FuenteGarantias } from './proceso';

const nombreSeguro = (n: string) => path.basename(n).replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 200);

export const fuenteGarantiasSupabase: FuenteGarantias = {
  async pedidoPorNumero(pais, numero) {
    const { data, error } = await crearClienteServicio()
      .from('orders')
      .select('id, number, contact_first_name, contact_last_name, contact_phone_e164, contact_email, delivered_at')
      .eq('number', numero)
      .eq('country_code', pais)
      .maybeSingle();
    if (error) throw new Error(`orders: ${error.message}`);
    if (!data) return null;
    const f = data as Record<string, string | null>;
    return {
      id: String(f.id),
      numero: String(f.number),
      celularE164: String(f.contact_phone_e164 ?? ''),
      nombre: `${f.contact_first_name ?? ''} ${f.contact_last_name ?? ''}`.trim(),
      correo: f.contact_email ?? null,
      entregadoEn: f.delivered_at ?? null,
    };
  },

  async casoReciente(pedidoId, motivo, desde) {
    const { data, error } = await crearClienteServicio()
      .from('warranty_claims')
      .select('number')
      .eq('order_id', pedidoId)
      .eq('reason', motivo)
      .gte('created_at', desde.toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`warranty_claims: ${error.message}`);
    return (data as { number: string } | null)?.number ?? null;
  },

  async guardarFoto(buffer, nombre) {
    if (!validarArchivo({ buffer, nombre }).ok) return null;
    let procesada;
    try {
      procesada = await procesarImagen({ buffer, recorte45: false });
    } catch {
      return null;
    }
    const id = randomUUID();
    const base = rutaBase('warranty', new Date(), id);
    const raiz = raizMedia();
    const variants = await escribirVariantes(raiz, base, procesada.variantes);
    const { error } = await crearClienteServicio()
      .from('media')
      .insert({
        id,
        kind: 'warranty',
        base_path: base,
        original_name: nombreSeguro(nombre),
        width: procesada.ancho,
        height: procesada.alto,
        variants,
        lqip: procesada.lqip,
        alt: 'Foto enviada con una solicitud de garantía',
        bytes: procesada.variantes.reduce((s, v) => s + v.buffer.length, 0),
      });
    if (error) {
      await Promise.all(Object.values(variants).map((r) => rm(path.join(raiz, r), { force: true })));
      throw new Error(`media: ${error.message}`);
    }
    return id;
  },

  async guardarVideo(buffer, tipo, nombre) {
    const id = randomUUID();
    const base = rutaBase('warranty', new Date(), id);
    const relativa = `${base}.${tipo}`;
    const raiz = path.resolve(raizMedia());
    const destino = path.resolve(raiz, relativa);
    if (!destino.startsWith(raiz + path.sep)) throw new Error('Ruta de medios no permitida.');
    await mkdir(path.dirname(destino), { recursive: true });
    await writeFile(destino, buffer, { flag: 'wx' });
    const { error } = await crearClienteServicio()
      .from('media')
      .insert({
        id,
        kind: 'warranty',
        base_path: base,
        original_name: nombreSeguro(nombre),
        variants: { video: relativa },
        alt: 'Video enviado con una solicitud de garantía',
        bytes: buffer.length,
      });
    if (error) {
      await rm(destino, { force: true });
      throw new Error(`media: ${error.message}`);
    }
    return id;
  },

  async descartarMedia(ids) {
    if (ids.length === 0) return;
    const cliente = crearClienteServicio();
    const { data } = await cliente.from('media').select('id, variants').in('id', ids);
    const raiz = path.resolve(raizMedia());
    for (const f of (data ?? []) as { id: string; variants: Record<string, string> | null }[]) {
      for (const r of Object.values(f.variants ?? {})) {
        const destino = path.resolve(raiz, r);
        if (destino.startsWith(raiz + path.sep)) await rm(destino, { force: true });
      }
    }
    await cliente.from('media').delete().in('id', ids);
  },

  async crearCaso(c) {
    const { data, error } = await crearClienteServicio()
      .from('warranty_claims')
      .insert({
        country_code: c.pais,
        order_id: c.pedidoId,
        customer_name: c.nombre,
        phone: c.celularE164,
        email: c.correo,
        reason: c.motivo,
        description: c.descripcion,
        media_ids: c.mediaIds,
        status: 'recibida',
        status_history: [{ at: c.ahora.toISOString(), actor: 'cliente', from: null, to: 'recibida', nota: null }],
      })
      .select('number')
      .single();
    if (error || !data) throw new Error(`warranty_claims: ${error?.message ?? 'sin fila'}`);
    return { numero: (data as { number: string }).number };
  },
};
