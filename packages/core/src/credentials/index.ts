/**
 * Cifrado de credenciales comerciales del panel (§26.3): AES-256-GCM con una subllave derivada de
 * `APP_ENCRYPTION_KEY` por HKDF-SHA-256 (D-019: la clave maestra nunca se usa tal cual), IV aleatorio
 * de 12 bytes por registro y datos asociados (AAD) = proveedor|país|ambiente, para que un registro
 * cifrado no pueda moverse a otra fila de `integration_credentials`.
 *
 * Solo Web Crypto (Node 22 y Edge). Los errores nunca incluyen valores ni la clave.
 * Formato `key_version = 1`: `data_encrypted` = texto cifrado + etiqueta GCM de 16 bytes (lo que
 * devuelve Web Crypto), `iv` = 12 bytes; el texto plano es JSON `{campo: valor}` con valores string.
 */
import type { Environment } from '../contracts/domain';

// Tipos mínimos de Web Crypto: el paquete core no carga `lib.dom` ni `@types/node`.
type Bytes = Uint8Array;
interface LlaveCripto {
  readonly type: string;
}
interface SubtleMinimo {
  importKey(formato: 'raw', datos: Bytes, algoritmo: 'HKDF', extraible: false, usos: string[]): Promise<LlaveCripto>;
  deriveKey(
    algoritmo: { name: 'HKDF'; hash: 'SHA-256'; salt: Bytes; info: Bytes },
    base: LlaveCripto,
    derivado: { name: 'AES-GCM'; length: 256 },
    extraible: false,
    usos: string[],
  ): Promise<LlaveCripto>;
  encrypt(algoritmo: { name: 'AES-GCM'; iv: Bytes; additionalData: Bytes }, llave: LlaveCripto, datos: Bytes): Promise<ArrayBuffer>;
  decrypt(algoritmo: { name: 'AES-GCM'; iv: Bytes; additionalData: Bytes }, llave: LlaveCripto, datos: Bytes): Promise<ArrayBuffer>;
}
interface CryptoMinimo {
  subtle: SubtleMinimo;
  getRandomValues<T extends Bytes>(arreglo: T): T;
}
interface Codificador {
  encode(texto: string): Bytes;
}
interface Decodificador {
  decode(bytes: Bytes): string;
}
const global = globalThis as unknown as {
  crypto: CryptoMinimo;
  TextEncoder: new () => Codificador;
  TextDecoder: new (etiqueta?: string, opciones?: { fatal: boolean }) => Decodificador;
  atob(datos: string): string;
};

export const CREDENTIAL_KEY_VERSION = 1;
const SAL_HKDF = 'izao-panel-v1';
const INFO_HKDF = 'credenciales-integracion:v1';
const LARGO_IV = 12;

export class CredentialCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CredentialCryptoError';
  }
}

export interface ContextoCredencial {
  provider: string;
  country_code: string | null;
  environment: Environment;
}

export interface CredencialCifrada {
  data_encrypted: Uint8Array;
  iv: Uint8Array;
  key_version: number;
}

function bytesDeClave(claveBase64: string): Bytes {
  const limpia = typeof claveBase64 === 'string' ? claveBase64.trim() : '';
  if (!/^[A-Za-z0-9+/]{43}=$/.test(limpia)) {
    throw new CredentialCryptoError('APP_ENCRYPTION_KEY debe ser base64 de exactamente 32 bytes.');
  }
  const binario = global.atob(limpia);
  if (binario.length !== 32) throw new CredentialCryptoError('APP_ENCRYPTION_KEY debe tener 32 bytes.');
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

async function llaveAes(claveBase64: string): Promise<LlaveCripto> {
  const cod = new global.TextEncoder();
  const subtle = global.crypto.subtle;
  const base = await subtle.importKey('raw', bytesDeClave(claveBase64), 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: cod.encode(SAL_HKDF), info: cod.encode(INFO_HKDF) },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function aad(ctx: ContextoCredencial): Bytes {
  return new global.TextEncoder().encode(`${ctx.provider}|${ctx.country_code ?? ''}|${ctx.environment}`);
}

export async function cifrarCredenciales(
  claveBase64: string,
  ctx: ContextoCredencial,
  valores: Readonly<Record<string, string>>,
): Promise<CredencialCifrada> {
  for (const v of Object.values(valores)) {
    if (typeof v !== 'string') throw new CredentialCryptoError('Las credenciales solo admiten valores de texto.');
  }
  const llave = await llaveAes(claveBase64);
  const iv = global.crypto.getRandomValues(new Uint8Array(LARGO_IV));
  const plano = new global.TextEncoder().encode(JSON.stringify(valores));
  const cifrado = await global.crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(ctx) }, llave, plano);
  return { data_encrypted: new Uint8Array(cifrado), iv, key_version: CREDENTIAL_KEY_VERSION };
}

/** Descifra y devuelve `{campo: valor}`. Lanza `CredentialCryptoError` sin detalles si algo no cuadra. */
export async function descifrarCredenciales(
  claveBase64: string,
  ctx: ContextoCredencial,
  c: { data_encrypted: Uint8Array; iv: Uint8Array; key_version?: number },
): Promise<Record<string, string>> {
  if ((c.key_version ?? CREDENTIAL_KEY_VERSION) !== CREDENTIAL_KEY_VERSION) {
    throw new CredentialCryptoError('Versión de llave de credenciales no soportada.');
  }
  if (c.iv.length !== LARGO_IV) throw new CredentialCryptoError('IV de credenciales inválido.');
  const llave = await llaveAes(claveBase64);
  let plano: ArrayBuffer;
  try {
    plano = await global.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: c.iv, additionalData: aad(ctx) },
      llave,
      c.data_encrypted,
    );
  } catch {
    throw new CredentialCryptoError('No se pudieron descifrar las credenciales.');
  }
  let valor: unknown;
  try {
    valor = JSON.parse(new global.TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(plano)));
  } catch {
    throw new CredentialCryptoError('Credenciales descifradas con formato inválido.');
  }
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) {
    throw new CredentialCryptoError('Credenciales descifradas con formato inválido.');
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
    if (typeof v !== 'string') throw new CredentialCryptoError('Credenciales descifradas con formato inválido.');
    out[k] = v;
  }
  return out;
}

/** `bytea` como lo devuelve PostgREST (`\x` + hex) a bytes. */
export function byteaDesdePostgrest(valor: string): Uint8Array {
  if (typeof valor !== 'string' || !/^\\x(?:[0-9a-fA-F]{2})*$/.test(valor)) {
    throw new CredentialCryptoError('bytea con formato inesperado.');
  }
  const hex = valor.slice(2);
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Bytes a literal `bytea` para insertar por PostgREST (`\x` + hex en minúsculas). */
export function byteaParaPostgrest(bytes: Uint8Array): string {
  return `\\x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}
