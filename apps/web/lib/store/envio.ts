import { T } from './textos';
import type { EspacioContenido } from './types';

/**
 * Textos de envío que define el panel por país (espacios de contenido):
 * - `nota_envio` (campo cuerpo): nota bajo los totales del bolso y del resumen.
 * - `valor_envio` (campo título): lo que se lee en la fila «Envío» (por ejemplo «Gratis»).
 * Sin espacio, o con el campo vacío, se usan los valores por defecto del seed (`T.carrito`).
 */
export function textosEnvio(espacios: readonly Pick<EspacioContenido, 'key' | 'title' | 'body'>[]): { nota: string; valor: string } {
  const nota = espacios.find((e) => e.key === 'nota_envio')?.body?.trim();
  const valor = espacios.find((e) => e.key === 'valor_envio')?.title?.trim();
  return { nota: nota || T.carrito.notaEnvio, valor: valor || T.carrito.envioGratis };
}
