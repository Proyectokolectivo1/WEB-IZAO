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
});
