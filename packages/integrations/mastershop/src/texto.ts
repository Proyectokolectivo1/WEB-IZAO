/**
 * Normalización de textos que MasterShop valida con conjuntos ASCII (D-060).
 *
 * Producción rechaza `shipping_address.city`/`billing_address.city` con tildes, diéresis o ñ:
 * `400 "Datos del body inválidos"` → «Solo alfanuméricos, espacios, guiones, paréntesis y puntos»
 * (IZ-CO-000046, 47, 51 y 52 con «ITAGÜÍ»). Solo se transforma lo que se envía; el pedido guardado no cambia.
 *
 * - Lugares (`city`, `state`): `[A-Za-z0-9 ( ) . -]`, el conjunto exacto del mensaje de MasterShop.
 * - Nombres (`first_name`, `last_name`, `full_name`): `[A-Za-z ]`. La documentación dice «solo letras y
 *   espacios» sin aclarar si las tildes cuentan (`[VERIFICAR]`, D-017); quitar una tilde en la guía es
 *   inocuo y un 400 bloquea el despacho, así que se envían sin diacríticos.
 * - `address1`, `address2`, `district`, `notes` e ítems no se tocan: producción aceptó `#`, comas y tildes
 *   en ellos en los mismos pedidos rechazados (solo marcó `city`).
 */

/** Letras que NFD no descompone en base + marca. */
const LETRAS_SIN_DESCOMPOSICION: Readonly<Record<string, string>> = {
  ß: 'ss',
  æ: 'ae',
  Æ: 'AE',
  œ: 'oe',
  Œ: 'OE',
  ø: 'o',
  Ø: 'O',
  đ: 'd',
  Đ: 'D',
  ł: 'l',
  Ł: 'L',
  ı: 'i',
};

/** Conjunto que MasterShop admite en `city` (y, por prudencia, en `state`). */
export const MASTERSHOP_PLACE_PATTERN = /^[A-Za-z0-9 ().-]+$/;
/** Conjunto que se envía en los nombres: letras ASCII y espacios. */
export const MASTERSHOP_NAME_PATTERN = /^[A-Za-z ]+$/;

/** Quita diacríticos (NFD + marcas combinantes) y traduce las ligaduras comunes: «ITAGÜÍ» → «ITAGUI», «Peña» → «Pena». */
export function sinDiacriticos(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[ßæÆœŒøØđĐłŁı]/g, (c) => LETRAS_SIN_DESCOMPOSICION[c] ?? c)
    .normalize('NFC');
}

function limpiar(texto: string, fuera: RegExp): string {
  return sinDiacriticos(texto).replace(fuera, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Ciudad o departamento para MasterShop: sin diacríticos, todo carácter fuera de `[A-Za-z0-9 ( ) . -]`
 * pasa a espacio y los espacios se colapsan. «BOGOTÁ, D.C.» → «BOGOTA D.C.». Puede devolver `''`.
 */
export function aLugarMasterShop(texto: string): string {
  return limpiar(texto, /[^A-Za-z0-9 ().-]/g);
}

/** Nombre para MasterShop: sin diacríticos, solo letras ASCII y espacios. «José Peña» → «Jose Pena». Puede devolver `''`. */
export function aNombreMasterShop(texto: string): string {
  return limpiar(texto, /[^A-Za-z ]/g);
}
