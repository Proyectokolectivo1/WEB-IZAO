/**
 * JSON con montos exactos. Los cuerpos de MasterShop llevan los montos como `bigint` en
 * unidad menor; aquí se escriben como literales numéricos en unidad mayor
 * (`80000`, o `49.90` en USD) sin pasar nunca por `float`.
 */
import { randomUUID } from 'node:crypto';
import { money, toDecimalString } from '@izao/core/money';
import type { CurrencyCode } from '@izao/core/money';

export function serializeMasterShopJson(value: unknown, currency: CurrencyCode = 'COP'): string {
  // Marcador con nonce por llamada: un texto del cliente no puede fabricar un número.
  const nonce = randomUUID().replace(/-/g, '');
  const token = (s: string): string => `__ms_${nonce}_${s}__`;
  const text = JSON.stringify(value, (_key, v: unknown) =>
    typeof v === 'bigint' ? token(toDecimalString(money(v, currency))) : v,
  );
  if (text === undefined) throw new TypeError('Valor no serializable a JSON.');
  return text.replace(new RegExp(`"__ms_${nonce}_(-?\\d+(?:\\.\\d+)?)__"`, 'g'), '$1');
}
