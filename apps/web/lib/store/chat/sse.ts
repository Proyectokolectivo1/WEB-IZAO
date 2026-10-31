/** Eventos SSE del chat (`POST /api/chat`) y su codificación. Código puro, compartido con el widget. */
import type { TarjetaChat } from './conversar';

export type EventoSSE =
  | { evento: 'sesion'; datos: { id: string } }
  | { evento: 'texto'; datos: { t: string } }
  | { evento: 'tarjeta'; datos: TarjetaChat }
  | { evento: 'fin'; datos: { restantes: number } }
  | { evento: 'error'; datos: { codigo: 'proveedor' | 'sin_modelo' | 'interno' } };

export const codificarSSE = (e: EventoSSE): string => `event: ${e.evento}\ndata: ${JSON.stringify(e.datos)}\n\n`;

/** Separa un búfer de texto SSE en eventos completos y devuelve lo que quedó sin terminar. */
export function leerSSE(buffer: string): { eventos: EventoSSE[]; resto: string } {
  const eventos: EventoSSE[] = [];
  let resto = buffer.replace(/\r\n/g, '\n');
  let i: number;
  while ((i = resto.indexOf('\n\n')) >= 0) {
    const bloque = resto.slice(0, i);
    resto = resto.slice(i + 2);
    let nombre = '';
    let dato = '';
    for (const l of bloque.split('\n')) {
      if (l.startsWith('event:')) nombre = l.slice(6).trim();
      else if (l.startsWith('data:')) dato += l.slice(5).trim();
    }
    if (!nombre || !dato) continue;
    try {
      eventos.push({ evento: nombre, datos: JSON.parse(dato) } as EventoSSE);
    } catch {
      /* bloque dañado: se ignora */
    }
  }
  return { eventos, resto };
}
