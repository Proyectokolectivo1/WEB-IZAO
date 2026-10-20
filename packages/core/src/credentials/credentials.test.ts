import { describe, expect, it } from 'vitest';
import {
  CredentialCryptoError,
  byteaDesdePostgrest,
  byteaParaPostgrest,
  cifrarCredenciales,
  descifrarCredenciales,
  type ContextoCredencial,
} from './index';

// Clave de prueba: 32 bytes 0x01..0x20 en base64. Nunca una clave real.
const CLAVE = 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=';
const OTRA_CLAVE = 'ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA=';
const CTX: ContextoCredencial = { provider: 'wompi', country_code: 'CO', environment: 'sandbox' };
const VALORES = { public_key: 'pub_test_abc', private_key: 'prv_test_secreto' };

describe('cifrado de credenciales (AES-256-GCM, §26.3)', () => {
  it('ida y vuelta conserva los valores', async () => {
    const c = await cifrarCredenciales(CLAVE, CTX, VALORES);
    expect(c.key_version).toBe(1);
    expect(c.iv).toHaveLength(12);
    expect(await descifrarCredenciales(CLAVE, CTX, c)).toEqual(VALORES);
  });

  it('el texto cifrado no contiene el secreto en claro', async () => {
    const c = await cifrarCredenciales(CLAVE, CTX, VALORES);
    const comoTexto = Array.from(c.data_encrypted, (b) => String.fromCharCode(b)).join('');
    expect(comoTexto).not.toContain('prv_test_secreto');
  });

  it('IV aleatorio por registro: dos cifrados del mismo valor difieren', async () => {
    const a = await cifrarCredenciales(CLAVE, CTX, VALORES);
    const b = await cifrarCredenciales(CLAVE, CTX, VALORES);
    expect(byteaParaPostgrest(a.iv)).not.toBe(byteaParaPostgrest(b.iv));
    expect(byteaParaPostgrest(a.data_encrypted)).not.toBe(byteaParaPostgrest(b.data_encrypted));
  });

  it('otra clave maestra no descifra', async () => {
    const c = await cifrarCredenciales(CLAVE, CTX, VALORES);
    await expect(descifrarCredenciales(OTRA_CLAVE, CTX, c)).rejects.toBeInstanceOf(CredentialCryptoError);
  });

  it('el cifrado queda atado a proveedor, país y ambiente (no se puede mover de fila)', async () => {
    const c = await cifrarCredenciales(CLAVE, CTX, VALORES);
    await expect(descifrarCredenciales(CLAVE, { ...CTX, environment: 'production' }, c)).rejects.toThrow(
      CredentialCryptoError,
    );
    await expect(descifrarCredenciales(CLAVE, { ...CTX, provider: 'addi' }, c)).rejects.toThrow();
    await expect(descifrarCredenciales(CLAVE, { ...CTX, country_code: null }, c)).rejects.toThrow();
  });

  it('un byte alterado se rechaza', async () => {
    const c = await cifrarCredenciales(CLAVE, CTX, VALORES);
    const alterado = new Uint8Array(c.data_encrypted);
    alterado[0] = alterado[0]! ^ 0xff;
    await expect(descifrarCredenciales(CLAVE, CTX, { ...c, data_encrypted: alterado })).rejects.toThrow(
      CredentialCryptoError,
    );
  });

  it('clave maestra inválida o versión desconocida: error sin revelar valores', async () => {
    await expect(cifrarCredenciales('corta', CTX, VALORES)).rejects.toThrow(/APP_ENCRYPTION_KEY/);
    const c = await cifrarCredenciales(CLAVE, CTX, VALORES);
    const e = await descifrarCredenciales(CLAVE, CTX, { ...c, key_version: 9 }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(CredentialCryptoError);
    expect(String((e as Error).message)).not.toContain('prv_test');
  });

  it('solo acepta valores de texto', async () => {
    await expect(
      cifrarCredenciales(CLAVE, CTX, { a: 1 } as unknown as Record<string, string>),
    ).rejects.toThrow(CredentialCryptoError);
  });

  it('bytea de PostgREST: hex con prefijo \\x en ambos sentidos', () => {
    const b = new Uint8Array([0, 1, 171, 255]);
    expect(byteaParaPostgrest(b)).toBe('\\x0001abff');
    expect(Array.from(byteaDesdePostgrest('\\x0001ABff'))).toEqual([0, 1, 171, 255]);
    expect(() => byteaDesdePostgrest('0001')).toThrow(CredentialCryptoError);
    expect(() => byteaDesdePostgrest('\\x0g')).toThrow(CredentialCryptoError);
  });
});
