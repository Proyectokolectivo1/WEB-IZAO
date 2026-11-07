/**
 * Límites y reglas de adjuntos del formulario de garantías, sin dependencias: lo usa el formulario del navegador sin
 * descargar zod. `logica.ts` los vuelve a exportar para el servidor.
 */
export const MAX_FOTOS = 5;
export const MAX_BYTES_FOTO = 15 * 1024 * 1024;
export const MAX_BYTES_VIDEO = 30 * 1024 * 1024;
/** Cuerpo completo de la solicitud (fotos o video + campos); por debajo del `client_max_body_size 35m` de Nginx. */
export const MAX_BYTES_SOLICITUD = 34 * 1024 * 1024;
export const MIN_DESCRIPCION = 10;
export const MAX_DESCRIPCION = 1000;

export const TIPOS_FOTO = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'] as const;
export const TIPOS_VIDEO = ['video/mp4', 'video/quicktime', 'video/webm'] as const;
export const ACEPTA_ADJUNTOS = [...TIPOS_FOTO, ...TIPOS_VIDEO].join(',');

export type CampoGarantia = 'pedido' | 'celular' | 'motivo' | 'descripcion' | 'adjuntos';

export interface DatosAdjuntos {
  fotos: { tamano: number }[];
  videos: { tamano: number }[];
}

/** Mensaje claro (o `null`) para la combinación de adjuntos elegida. */
export function problemaAdjuntos(a: DatosAdjuntos): 'mezcla' | 'muchas_fotos' | 'muchos_videos' | 'foto_pesada' | 'video_pesado' | null {
  if (a.fotos.length > 0 && a.videos.length > 0) return 'mezcla';
  if (a.fotos.length > MAX_FOTOS) return 'muchas_fotos';
  if (a.videos.length > 1) return 'muchos_videos';
  if (a.fotos.some((f) => f.tamano > MAX_BYTES_FOTO)) return 'foto_pesada';
  if (a.videos.some((v) => v.tamano > MAX_BYTES_VIDEO)) return 'video_pesado';
  return null;
}

/** Respuesta de `POST /{pais}/garantias/enviar`. Nunca trae datos del pedido más allá del número del caso. */
export type RespuestaGarantia =
  | { ok: true; numero: string; diasRespuesta: number; repetido: boolean }
  | { ok: false; motivo: 'campos'; campos: Partial<Record<CampoGarantia, string>> }
  | { ok: false; motivo: 'pedido_no_encontrado' | 'sin_entrega' | 'vencido' | 'demasiados' | 'bot' | 'error' };
