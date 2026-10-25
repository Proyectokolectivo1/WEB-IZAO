/**
 * Lógica pura del formulario público de reseñas (§9.6): la comparten el formulario (validación al instante) y
 * `POST /api/reviews` (validación definitiva). Sin servidor ni navegador.
 */
import { z } from 'zod';
import { normalizePhone } from '@izao/core/schemas';
import type { CountryCode } from '@izao/core/money';
import { normalizarNumeroPedido, numeroPedidoValido } from '../garantias/logica';

export const MAX_FOTOS_RESENA = 3;
export const MAX_BYTES_FOTO_RESENA = 15 * 1024 * 1024;
/** Cuerpo completo (fotos + campos); por debajo del `client_max_body_size` de Nginx. */
export const MAX_BYTES_SOLICITUD_RESENA = 34 * 1024 * 1024;
export const MIN_TEXTO = 10;
export const MAX_TEXTO = 1000;
export const MAX_NOMBRE = 60;
export const MAX_CIUDAD = 60;
export const TIPOS_FOTO_RESENA = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'] as const;

export type CampoResena = 'nombre' | 'ciudad' | 'estrellas' | 'texto' | 'pedido' | 'celular' | 'fotos' | 'producto';

/** «Andrea Pérez Gómez» → «Andrea P.». No se guarda ni se muestra el nombre completo (§9.6). */
export function nombreCorto(crudo: string): string {
  const partes = crudo.normalize('NFKC').trim().split(/\s+/).filter(Boolean);
  const primero = partes[0] ?? '';
  const inicial = partes[1]?.[0];
  const cap = (s: string) => s.charAt(0).toLocaleUpperCase('es') + s.slice(1);
  return inicial ? `${cap(primero)} ${inicial.toLocaleUpperCase('es')}.` : cap(primero);
}

const textoOpcional = (max: number) =>
  z
    .string()
    .max(max * 2)
    .transform((v) => v.normalize('NFKC').trim())
    .pipe(z.string().max(max))
    .transform((v) => (v === '' ? null : v));

export function esquemaResena(pais: CountryCode) {
  return z
    .object({
      producto: z.guid(),
      nombre: z
        .string()
        .max(MAX_NOMBRE * 2)
        .transform((v) => v.normalize('NFKC').trim())
        .pipe(z.string().min(2).max(MAX_NOMBRE)),
      ciudad: textoOpcional(MAX_CIUDAD),
      estrellas: z
        .string()
        .regex(/^[1-5]$/)
        .transform(Number),
      texto: z
        .string()
        .transform((v) => v.normalize('NFKC').trim())
        .pipe(z.string().min(MIN_TEXTO).max(MAX_TEXTO)),
      pedido: textoOpcional(40),
      celular: textoOpcional(30),
    })
    .superRefine((v, ctx) => {
      // Para marcar «compra verificada» hacen falta el pedido y el celular juntos; uno solo no sirve.
      if (v.pedido && !v.celular) ctx.addIssue({ code: 'custom', path: ['celular'], message: 'celular' });
      if (v.celular && !v.pedido) ctx.addIssue({ code: 'custom', path: ['pedido'], message: 'pedido' });
    })
    .transform((v, ctx) => {
      let pedido: string | null = null;
      let celular: string | null = null;
      if (v.pedido) {
        const n = normalizarNumeroPedido(v.pedido);
        if (numeroPedidoValido(n, pais)) pedido = n;
        else ctx.addIssue({ code: 'custom', path: ['pedido'], message: 'pedido' });
      }
      if (v.celular) {
        const t = normalizePhone(pais, v.celular);
        if (t) celular = t.e164;
        else ctx.addIssue({ code: 'custom', path: ['celular'], message: 'celular' });
      }
      return { ...v, pedido, celular };
    });
}
export type DatosResena = z.output<ReturnType<typeof esquemaResena>>;

export function problemaFotosResena(fotos: { tamano: number }[]): 'muchas_fotos' | 'foto_pesada' | null {
  if (fotos.length > MAX_FOTOS_RESENA) return 'muchas_fotos';
  if (fotos.some((f) => f.tamano > MAX_BYTES_FOTO_RESENA)) return 'foto_pesada';
  return null;
}

/**
 * Respuesta de `POST /api/reviews`. El éxito es idéntico con o sin «compra verificada»: quien escribe un pedido que no
 * coincide no se entera (no sirve para averiguar qué pedidos existen). Entra siempre como `pending` (moderación).
 */
export type RespuestaResena =
  | { ok: true }
  | { ok: false; motivo: 'campos'; campos: Partial<Record<CampoResena, string>> }
  | { ok: false; motivo: 'demasiados' | 'bot' | 'error' };
