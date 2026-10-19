/**
 * IP del cliente detrás de Nginx. Nginx fija `X-Real-IP` con la dirección real
 * de la conexión (`$remote_addr`) y sobrescribe el valor que mande el cliente.
 */
import { headers } from 'next/headers';

export async function ipDelCliente(): Promise<string | null> {
  const h = await headers();
  const real = h.get('x-real-ip');
  if (real) return real.trim();
  const reenviada = h.get('x-forwarded-for');
  if (reenviada) {
    // Nginx agrega la IP de la conexión al final de la lista.
    return reenviada.split(',').at(-1)?.trim() ?? null;
  }
  return null;
}
