import { describe, expect, it } from 'vitest';
import { derivarLlaveHmac, firmarHmac, validarClaveMaestra } from './llaves';

// Claves de prueba sin relación con ninguna llave real.
const CLAVE_A = Buffer.alloc(32, 7).toString('base64');
const CLAVE_B = Buffer.alloc(32, 9).toString('base64');

describe('validarClaveMaestra (APP_ENCRYPTION_KEY: 32 bytes en base64)', () => {
  it('acepta 32 bytes en base64', () => {
    expect(validarClaveMaestra(CLAVE_A)).toHaveLength(32);
  });

  it('rechaza claves cortas, largas o que no son base64', () => {
    expect(() => validarClaveMaestra(Buffer.alloc(16, 1).toString('base64'))).toThrow(/32 bytes/);
    expect(() => validarClaveMaestra(Buffer.alloc(33, 1).toString('base64'))).toThrow(/32 bytes/);
    expect(() => validarClaveMaestra('secreto-de-prueba-uno')).toThrow(/base64/);
    expect(() => validarClaveMaestra('')).toThrow();
    expect(() => validarClaveMaestra('   ')).toThrow();
  });

  it('el mensaje de error no incluye la clave', () => {
    try {
      validarClaveMaestra('valor-secreto-mal-formado!');
    } catch (e) {
      expect(String(e)).not.toContain('valor-secreto-mal-formado');
    }
  });
});

describe('derivarLlaveHmac (HKDF: una subllave por propósito)', () => {
  it('es determinista', async () => {
    const a = await firmarHmac(CLAVE_A, 'p1', 'mensaje');
    const b = await firmarHmac(CLAVE_A, 'p1', 'mensaje');
    expect(a).toBe(b);
  });

  it('propósitos distintos dan firmas distintas con la misma clave', async () => {
    expect(await firmarHmac(CLAVE_A, 'marca-sesion', 'm')).not.toBe(await firmarHmac(CLAVE_A, 'huella-correo', 'm'));
  });

  it('claves distintas dan firmas distintas', async () => {
    expect(await firmarHmac(CLAVE_A, 'p', 'm')).not.toBe(await firmarHmac(CLAVE_B, 'p', 'm'));
  });

  it('no usa la clave maestra directamente como llave HMAC', async () => {
    const { createHmac } = await import('node:crypto');
    const directa = createHmac('sha256', Buffer.from(CLAVE_A, 'base64')).update('m').digest('hex');
    expect(await firmarHmac(CLAVE_A, 'p', 'm')).not.toBe(directa);
  });

  it('rechaza una clave inválida', async () => {
    await expect(derivarLlaveHmac('corta', 'p')).rejects.toThrow();
  });
});
