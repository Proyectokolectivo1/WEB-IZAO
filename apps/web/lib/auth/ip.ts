/** Validación de IP sin `node:net`, para poder usarla también en el middleware (Edge). */

const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

export function esIp(valor: string): boolean {
  if (IPV4.test(valor)) return true;
  if (!valor.includes(':') || valor.length > 45 || !/^[0-9a-fA-F:.]+$/.test(valor)) return false;
  try {
    new URL(`http://[${valor}]/`);
    return true;
  } catch {
    return false;
  }
}
