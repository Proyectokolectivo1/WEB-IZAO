import { afterEach, describe, expect, it, vi } from 'vitest';
import { ejemploPermitido } from './modo-datos';

afterEach(() => vi.unstubAllEnvs());

describe('ejemploPermitido', () => {
  it('en desarrollo y pruebas sí', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(ejemploPermitido()).toBe(true);
  });
  it('en producción solo con la variable oficial en 1', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('STORE_DATOS_PERMITIR_EJEMPLO', '');
    expect(ejemploPermitido()).toBe(false);
    vi.stubEnv('STORE_DATOS_PERMITIR_EJEMPLO', 'true');
    expect(ejemploPermitido()).toBe(false);
    vi.stubEnv('STORE_DATOS_PERMITIR_EJEMPLO', '1');
    expect(ejemploPermitido()).toBe(true);
  });
  it('aunque la variable esté en 1, se niega en el sitio oficial', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('STORE_DATOS_PERMITIR_EJEMPLO', '1');
    for (const url of ['https://izaoperfumeria.com', 'https://www.izaoperfumeria.com/', 'https://IZAOPERFUMERIA.COM']) {
      vi.stubEnv('SITE_URL', url);
      expect(ejemploPermitido()).toBe(false);
    }
    vi.stubEnv('SITE_URL', 'http://127.0.0.1:3100');
    expect(ejemploPermitido()).toBe(true);
    vi.stubEnv('SITE_URL', 'no es una url');
    expect(ejemploPermitido()).toBe(true);
  });
});
