/**
 * Derivación de llaves a partir de `APP_ENCRYPTION_KEY` (§26.3).
 *
 * La clave maestra se valida (32 bytes en base64) y nunca se usa tal cual como
 * llave HMAC: se deriva una subllave por propósito con HKDF-SHA-256, de modo que
 * la marca de sesión, la huella de correos y el cifrado de credenciales (AES)
 * no compartan material de llave. Solo Web Crypto (sin Buffer): corre en Node y en Edge.
 */

const codificador = new TextEncoder();

const BASE64 = /^[A-Za-z0-9+/]{43}=$/;

/** Valida que la clave sean exactamente 32 bytes en base64 y devuelve los bytes. */
export function validarClaveMaestra(valor: string): Uint8Array<ArrayBuffer> {
  const limpia = valor.trim();
  if (!BASE64.test(limpia)) {
    throw new Error('APP_ENCRYPTION_KEY debe ser base64 de exactamente 32 bytes (44 caracteres).');
  }
  const bytes = new Uint8Array(32);
  const binario = atob(limpia);
  if (binario.length !== 32) throw new Error('APP_ENCRYPTION_KEY debe tener 32 bytes.');
  for (let i = 0; i < 32; i += 1) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

/** Subllave HMAC-SHA-256 para un propósito (`info` de HKDF). */
export async function derivarLlaveHmac(claveBase64: string, proposito: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', validarClaveMaestra(claveBase64), 'HKDF', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: codificador.encode('izao-panel-v1'),
      info: codificador.encode(proposito),
    },
    base,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['sign'],
  );
}

/** HMAC-SHA-256 en hexadecimal con la subllave del propósito. */
export async function firmarHmac(claveBase64: string, proposito: string, mensaje: string): Promise<string> {
  const llave = await derivarLlaveHmac(claveBase64, proposito);
  const firma = await crypto.subtle.sign('HMAC', llave, codificador.encode(mensaje));
  return Array.from(new Uint8Array(firma), (b) => b.toString(16).padStart(2, '0')).join('');
}
