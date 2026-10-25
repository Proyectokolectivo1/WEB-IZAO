/**
 * Lógica pura del formulario público de garantías (§19). La comparten el formulario (validación al instante) y la
 * ruta de envío (validación definitiva en el servidor). Sin servidor ni navegador.
 *
 * Los límites de adjuntos son los de la especificación: hasta 5 fotos, o 1 video corto de hasta 30 MB.
 */
import { z } from 'zod';
import { normalizePhone } from '@izao/core/schemas';
import type { CountryCode } from '@izao/core/money';

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

/** `IZ-CO-000123`: se escribe a mano, así que se tolera minúscula, espacios y guiones sueltos. */
export function normalizarNumeroPedido(crudo: string): string {
  return crudo.normalize('NFKC').toUpperCase().replace(/[\s_]+/g, '').replace(/[–—−]/g, '-');
}

const PATRON_PEDIDO = /^IZ-(CO|EC)-\d{3,9}$/;

export function numeroPedidoValido(numero: string, pais: CountryCode): boolean {
  const m = PATRON_PEDIDO.exec(numero);
  return m !== null && m[1] === pais;
}

/** Fecha límite de la garantía: `period_days` desde la entrega. */
export function fechaLimite(entregadoIso: string, diasPlazo: number): Date {
  return new Date(new Date(entregadoIso).getTime() + diasPlazo * 86_400_000);
}

export type EstadoPlazo = 'vigente' | 'vencido' | 'sin_entrega';

export function estadoPlazo(entregadoIso: string | null, diasPlazo: number, ahora: Date): EstadoPlazo {
  if (!entregadoIso || Number.isNaN(new Date(entregadoIso).getTime())) return 'sin_entrega';
  return ahora.getTime() <= fechaLimite(entregadoIso, diasPlazo).getTime() ? 'vigente' : 'vencido';
}

/** Video por sus primeros bytes (nunca por la extensión): MP4/MOV (`ftyp` que no es imagen) o WebM/Matroska. */
export function detectarVideo(b: Uint8Array): 'mp4' | 'mov' | 'webm' | null {
  const texto = (desde: number, hasta: number) => String.fromCharCode(...b.subarray(desde, hasta));
  if (b.length >= 12 && texto(4, 8) === 'ftyp') {
    const marca = texto(8, 12);
    if (marca === 'avif' || marca === 'avis' || marca === 'heic' || marca === 'heix' || marca === 'mif1') return null;
    return marca === 'qt  ' ? 'mov' : 'mp4';
  }
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'webm';
  return null;
}

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

export function esquemaGarantia(pais: CountryCode, motivos: readonly string[]) {
  return z.object({
    pedido: z
      .string()
      .max(40)
      .transform(normalizarNumeroPedido)
      .refine((v) => numeroPedidoValido(v, pais), 'pedido'),
    celular: z
      .string()
      .max(30)
      .transform((v, ctx) => {
        const n = normalizePhone(pais, v);
        if (!n) {
          ctx.addIssue({ code: 'custom', message: 'celular' });
          return z.NEVER;
        }
        return n.e164;
      }),
    motivo: z.string().max(200).refine((v) => motivos.includes(v), 'motivo'),
    descripcion: z
      .string()
      .transform((v) => v.normalize('NFKC').trim())
      .pipe(z.string().min(MIN_DESCRIPCION, 'descripcion').max(MAX_DESCRIPCION, 'descripcion')),
  });
}
export type DatosGarantia = z.output<ReturnType<typeof esquemaGarantia>>;

/** Respuesta de `POST /{pais}/garantias/enviar`. Nunca trae datos del pedido más allá del número del caso. */
export type RespuestaGarantia =
  | { ok: true; numero: string; diasRespuesta: number; repetido: boolean }
  | { ok: false; motivo: 'campos'; campos: Partial<Record<CampoGarantia, string>> }
  | { ok: false; motivo: 'pedido_no_encontrado' | 'sin_entrega' | 'vencido' | 'demasiados' | 'bot' | 'error' };
