import { describe, expect, it } from 'vitest';
import { claveSitioCaptcha, esErrorCaptcha, opcionesCaptcha } from './captcha';
import { esquemaLogin } from './esquemas';

describe('CAPTCHA del login', () => {
  it('la clave de sitio es opcional: sin valor o en blanco no hay widget', () => {
    expect(claveSitioCaptcha(undefined)).toBeNull();
    expect(claveSitioCaptcha('   ')).toBeNull();
    expect(claveSitioCaptcha(' 0x4AAA ')).toBe('0x4AAA');
  });

  it('solo envía captchaToken a Supabase si hay token (apagado: sin options)', () => {
    expect(opcionesCaptcha(undefined)).toEqual({});
    expect(opcionesCaptcha('')).toEqual({});
    expect(opcionesCaptcha('  ')).toEqual({});
    expect(opcionesCaptcha(' tok123 ')).toEqual({ captchaToken: 'tok123' });
  });

  it('reconoce el rechazo por CAPTCHA y no confunde las credenciales erradas', () => {
    expect(esErrorCaptcha({ code: 'captcha_failed', message: 'x' })).toBe(true);
    expect(esErrorCaptcha({ message: 'captcha protection: request disallowed (no captcha response)' })).toBe(true);
    expect(esErrorCaptcha({ code: 'invalid_credentials', message: 'Invalid login credentials' })).toBe(false);
    expect(esErrorCaptcha(null)).toBe(false);
  });

  it('el esquema acepta el login con y sin token y limita su tamaño', () => {
    const base = { correo: 'Dueno@Izao.com', contrasena: 'x' };
    expect(esquemaLogin.safeParse(base).success).toBe(true);
    const con = esquemaLogin.safeParse({ ...base, captchaToken: 'abc' });
    expect(con.success && con.data.captchaToken).toBe('abc');
    expect(esquemaLogin.safeParse({ ...base, captchaToken: 'a'.repeat(2049) }).success).toBe(false);
  });
});
