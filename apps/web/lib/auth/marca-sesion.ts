/**
 * Marca de inicio de sesión del panel (§26.1: sesión de 12 h).
 *
 * El plan gratuito de Supabase no permite limitar la duración de la sesión, así
 * que el panel guarda en una cookie `httpOnly` el instante del inicio de sesión,
 * firmado con HMAC-SHA256 (subllave HKDF derivada de `APP_ENCRYPTION_KEY`). Va ligada al usuario: no sirve para otra cuenta.
 *
 * Usa solo Web Crypto, por lo que corre igual en el middleware (Edge) y en Node.
 */
import { DURACION_SESION_MS } from './decision';
import { firmarHmac } from './llaves';

export const NOMBRE_COOKIE_MARCA = 'izao_admin_inicio';

/** Propósito HKDF de la subllave de la marca (ver `llaves.ts`). */
const PROPOSITO = 'marca-sesion-v1';

function firmar(mensaje: string, secreto: string): Promise<string> {
  return firmarHmac(secreto, PROPOSITO, mensaje);
}

/** Comparación en tiempo constante de dos cadenas hexadecimales. */
function iguales(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diferencia = 0;
  for (let i = 0; i < a.length; i += 1) diferencia |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diferencia === 0;
}

/** Valor de la cookie: `<ms>.<firma>`. */
export async function crearMarca(userId: string, ahoraMs: number, secreto: string): Promise<string> {
  const firma = await firmar(`${userId}.${ahoraMs}`, secreto);
  return `${ahoraMs}.${firma}`;
}

/**
 * `true` si la marca es auténtica, pertenece al usuario y tiene menos de 12 h.
 * Una marca con fecha futura (más de 1 minuto) se rechaza.
 */
export async function marcaVigente(
  valor: string | undefined | null,
  userId: string,
  ahoraMs: number,
  secreto: string,
): Promise<boolean> {
  if (!valor) return false;
  const [msTexto, firma, ...resto] = valor.split('.');
  if (!msTexto || !firma || resto.length > 0 || !/^\d{10,16}$/.test(msTexto)) return false;
  const inicio = Number(msTexto);
  if (!Number.isSafeInteger(inicio)) return false;
  if (inicio > ahoraMs + 60_000) return false;
  if (ahoraMs - inicio >= DURACION_SESION_MS) return false;
  const esperada = await firmar(`${userId}.${inicio}`, secreto);
  return iguales(firma, esperada);
}

/** Opciones de la cookie de la marca. Caduca junto con la sesión. */
export function opcionesCookieMarca(produccion: boolean) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: produccion,
    path: '/',
    maxAge: Math.floor(DURACION_SESION_MS / 1000),
  };
}

/**
 * Marca de MFA aprobado (A-3). La emite el servidor solo cuando el código TOTP
 * se verificó con el factor que el servicio aprobó (`app_metadata.mfa_factor_aprobado`).
 * Va ligada al usuario y al factor: una sesión aal2 conseguida con un factor
 * inscrito por fuera (llamando directo a GoTrue con la llave publicable) no la
 * tiene, y el middleware y los guardias la rechazan.
 */
export const NOMBRE_COOKIE_MARCA_MFA = 'izao_admin_mfa';

const PROPOSITO_MFA = 'marca-mfa-v1';

export async function crearMarcaMfa(
  userId: string,
  factorId: string,
  ahoraMs: number,
  secreto: string,
): Promise<string> {
  const firma = await firmarHmac(secreto, PROPOSITO_MFA, `${userId}.${factorId}.${ahoraMs}`);
  return `${ahoraMs}.${firma}`;
}

export async function marcaMfaVigente(
  valor: string | undefined | null,
  userId: string,
  factorAprobado: string | undefined | null,
  ahoraMs: number,
  secreto: string,
): Promise<boolean> {
  if (!valor || !factorAprobado) return false;
  const [msTexto, firma, ...resto] = valor.split('.');
  if (!msTexto || !firma || resto.length > 0 || !/^\d{10,16}$/.test(msTexto)) return false;
  const inicio = Number(msTexto);
  if (!Number.isSafeInteger(inicio)) return false;
  if (inicio > ahoraMs + 60_000) return false;
  if (ahoraMs - inicio >= DURACION_SESION_MS) return false;
  const esperada = await firmarHmac(secreto, PROPOSITO_MFA, `${userId}.${factorAprobado}.${inicio}`);
  return iguales(firma, esperada);
}
