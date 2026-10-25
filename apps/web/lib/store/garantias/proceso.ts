/**
 * Proceso del envío de una garantía (§19): comprueba el pedido, el celular y el plazo, guarda los adjuntos y crea el
 * caso. Las dependencias (base de datos y disco) entran por `FuenteGarantias` para probar el orden y la limpieza.
 *
 * Privacidad: pedido inexistente y celular que no coincide dan la MISMA respuesta (`pedido_no_encontrado`), para que
 * el formulario no sirva para averiguar qué números de pedido existen.
 */
import type { CountryCode } from '@izao/core/money';
import { detectarVideo, estadoPlazo, problemaAdjuntos, type DatosGarantia, type RespuestaGarantia } from './logica';

export interface PedidoGarantia {
  id: string;
  numero: string;
  celularE164: string;
  nombre: string;
  correo: string | null;
  entregadoEn: string | null;
}

export interface FuenteGarantias {
  pedidoPorNumero(pais: CountryCode, numero: string): Promise<PedidoGarantia | null>;
  /** Caso del mismo pedido y motivo creado en los últimos minutos (reenvío del formulario): su número, o `null`. */
  casoReciente(pedidoId: string, motivo: string, desde: Date): Promise<string | null>;
  /** Guarda una foto (re-codificada, sin EXIF) y devuelve el id de `media`; `null` si no es una imagen válida. */
  guardarFoto(buffer: Buffer, nombre: string): Promise<string | null>;
  /** Guarda el video tal cual en disco (no en la base) y devuelve el id de `media` que lo referencia. */
  guardarVideo(buffer: Buffer, tipo: 'mp4' | 'mov' | 'webm', nombre: string): Promise<string>;
  /** Borra archivos y filas de `media` (limpieza si el caso no llegó a crearse). */
  descartarMedia(ids: string[]): Promise<void>;
  crearCaso(c: {
    pais: CountryCode;
    pedidoId: string;
    nombre: string;
    celularE164: string;
    correo: string | null;
    motivo: string;
    descripcion: string;
    mediaIds: string[];
    ahora: Date;
  }): Promise<{ numero: string }>;
}

export interface EntradaGarantia {
  pais: CountryCode;
  datos: DatosGarantia;
  fotos: { buffer: Buffer; nombre: string }[];
  video: { buffer: Buffer; nombre: string } | null;
  ajustes: { diasPlazo: number; diasRespuesta: number };
  ahora: Date;
}

/** Ventana en la que un reenvío del mismo formulario no crea otro caso. */
export const VENTANA_REENVIO_MS = 10 * 60_000;

export async function procesarGarantia(fuente: FuenteGarantias, e: EntradaGarantia): Promise<RespuestaGarantia> {
  const problema = problemaAdjuntos({
    fotos: e.fotos.map((f) => ({ tamano: f.buffer.length })),
    videos: e.video ? [{ tamano: e.video.buffer.length }] : [],
  });
  if (problema) return { ok: false, motivo: 'campos', campos: { adjuntos: problema } };
  const tipoVideo = e.video ? detectarVideo(e.video.buffer) : null;
  if (e.video && !tipoVideo) return { ok: false, motivo: 'campos', campos: { adjuntos: 'tipo' } };

  const pedido = await fuente.pedidoPorNumero(e.pais, e.datos.pedido);
  if (!pedido || pedido.celularE164 !== e.datos.celular) return { ok: false, motivo: 'pedido_no_encontrado' };

  const plazo = estadoPlazo(pedido.entregadoEn, e.ajustes.diasPlazo, e.ahora);
  if (plazo !== 'vigente') return { ok: false, motivo: plazo };

  const previo = await fuente.casoReciente(pedido.id, e.datos.motivo, new Date(e.ahora.getTime() - VENTANA_REENVIO_MS));
  if (previo) return { ok: true, numero: previo, diasRespuesta: e.ajustes.diasRespuesta, repetido: true };

  const mediaIds: string[] = [];
  try {
    for (const f of e.fotos) {
      const id = await fuente.guardarFoto(f.buffer, f.nombre);
      if (!id) {
        await fuente.descartarMedia(mediaIds);
        return { ok: false, motivo: 'campos', campos: { adjuntos: 'tipo' } };
      }
      mediaIds.push(id);
    }
    if (e.video && tipoVideo) mediaIds.push(await fuente.guardarVideo(e.video.buffer, tipoVideo, e.video.nombre));
    const caso = await fuente.crearCaso({
      pais: e.pais,
      pedidoId: pedido.id,
      nombre: pedido.nombre,
      celularE164: pedido.celularE164,
      correo: pedido.correo,
      motivo: e.datos.motivo,
      descripcion: e.datos.descripcion,
      mediaIds,
      ahora: e.ahora,
    });
    return { ok: true, numero: caso.numero, diasRespuesta: e.ajustes.diasRespuesta, repetido: false };
  } catch {
    await fuente.descartarMedia(mediaIds).catch(() => undefined);
    return { ok: false, motivo: 'error' };
  }
}
