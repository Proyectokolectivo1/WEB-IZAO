import { describe, expect, it } from 'vitest';
import {
  CLAVE_CONSENTIMIENTO,
  COOKIE_CONSENTIMIENTO,
  DURACION_SEGUNDOS,
  borrarCookie,
  escribir,
  interpretar,
  leer,
  leerCrudo,
  marketingAceptadoEnCabecera,
  serializar,
  type EntornoConsentimiento,
} from './consentimiento';

const AHORA = 1_800_000_000;

/** Documento falso con un «jar» mínimo: guarda lo escrito por `cookie = …` e ignora atributos. */
function entorno(parcial: Partial<EntornoConsentimiento> & { cookies?: Record<string, string>; local?: Record<string, string> } = {}) {
  const cookies = { ...(parcial.cookies ?? {}) };
  const local = { ...(parcial.local ?? {}) };
  const escrituras: string[] = [];
  const documento = {
    get cookie() {
      return Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');
    },
    set cookie(v: string) {
      escrituras.push(v);
      const [par] = v.split(';');
      const [k, ...r] = par!.split('=');
      if (/max-age=0/.test(v)) delete cookies[k!.trim()];
      else cookies[k!.trim()] = r.join('=');
    },
  } as Pick<Document, 'cookie'>;
  const almacen = { getItem: (k: string) => local[k] ?? null, setItem: (k: string, v: string) => void (local[k] = v) };
  const e: EntornoConsentimiento = { documento, almacen, seguro: parcial.seguro ?? true, ahoraSegundos: parcial.ahoraSegundos ?? AHORA };
  return { e, cookies, local, escrituras };
}

describe('consentimiento de cookies', () => {
  it('sin decisión no hay consentimiento (opt-in estricto)', () => {
    const { e } = entorno();
    expect(leer(e)).toBeNull();
    expect(leerCrudo(e)).toBe('');
  });

  it('aceptar guarda cookie propia (12 meses, SameSite=Lax, Secure en https) y copia local, sin datos personales', () => {
    const { e, cookies, local, escrituras } = entorno();
    const c = escribir({ analitica: true, marketing: true }, e);
    expect(c).toEqual({ analitica: true, marketing: true, fecha: AHORA });
    expect(cookies[COOKIE_CONSENTIMIENTO]).toBe(`v1.a1.m1.t${AHORA}`);
    expect(local[CLAVE_CONSENTIMIENTO]).toBe(`v1.a1.m1.t${AHORA}`);
    expect(escrituras[0]).toContain(`max-age=${DURACION_SEGUNDOS}`);
    expect(escrituras[0]).toMatch(/samesite=lax/i);
    expect(escrituras[0]).toContain('secure');
    expect(escrituras[0]).not.toMatch(/@|correo|email|id=/i);
    expect(leer(e)).toEqual({ analitica: true, marketing: true, fecha: AHORA });
  });

  it('rechazar persiste el no (no vuelve a preguntar y marketing queda apagado)', () => {
    const { e } = entorno();
    escribir({ analitica: false, marketing: false }, e);
    expect(leer(e)).toMatchObject({ analitica: false, marketing: false });
  });

  it('en http (desarrollo) la cookie no lleva Secure', () => {
    const { e, escrituras } = entorno({ seguro: false });
    escribir({ analitica: false, marketing: false }, e);
    expect(escrituras[0]).not.toContain('secure');
  });

  it('si el navegador borra la cookie, la copia local conserva la decisión', () => {
    const { e, cookies } = entorno();
    escribir({ analitica: false, marketing: true }, e);
    delete cookies[COOKIE_CONSENTIMIENTO];
    expect(leer(e)).toMatchObject({ analitica: false, marketing: true });
  });

  it('con cookies y almacenamiento bloqueados no lanza y no hay consentimiento', () => {
    const documento = {
      get cookie(): string {
        throw new Error('bloqueado');
      },
      set cookie(_v: string) {
        throw new Error('bloqueado');
      },
    } as unknown as Pick<Document, 'cookie'>;
    const almacen = {
      getItem: () => {
        throw new Error('bloqueado');
      },
      setItem: () => {
        throw new Error('bloqueado');
      },
    };
    const e: EntornoConsentimiento = { documento, almacen, seguro: true, ahoraSegundos: AHORA };
    expect(() => escribir({ analitica: true, marketing: true }, e)).not.toThrow();
    expect(leer(e)).toBeNull();
  });

  it('pasados 12 meses la decisión vence y se vuelve a preguntar', () => {
    const { e } = entorno();
    escribir({ analitica: true, marketing: true }, e);
    expect(leer({ ...e, ahoraSegundos: AHORA + DURACION_SEGUNDOS - 10 })).not.toBeNull();
    expect(leer({ ...e, ahoraSegundos: AHORA + DURACION_SEGUNDOS + 10 })).toBeNull();
  });

  it('valores manipulados o de otro formato se ignoran', () => {
    for (const malo of ['', 'v1', 'v1.a2.m1.t1800000000', 'v2.a1.m1.t1800000000', 'true', 'v1.a1.m1.t12', '{"marketing":true}', 'v1.a1.m1.t1800000000;x']) {
      expect(interpretar(malo, AHORA), malo).toBeNull();
    }
    // Fecha del futuro lejano: no se acepta (reloj desajustado o valor forjado).
    expect(interpretar(`v1.a1.m1.t${AHORA + 60 * 60 * 24 * 400}`, AHORA)).toBeNull();
  });

  it('serializar e interpretar son inversos', () => {
    const c = { analitica: true, marketing: false, fecha: AHORA };
    expect(interpretar(serializar(c), AHORA)).toEqual(c);
  });

  it('borrarCookie borra la cookie del dominio (y la del dominio padre)', () => {
    const { e, cookies, escrituras } = entorno({ cookies: { _fbp: 'fb.1.123.456', otra: 'x' } });
    borrarCookie('_fbp', e.documento, 'www.izaoperfumeria.com');
    expect(cookies._fbp).toBeUndefined();
    expect(cookies.otra).toBe('x');
    expect(escrituras.some((x) => x.includes('domain=.izaoperfumeria.com'))).toBe(true);
  });

  it('el servidor lee el marketing de la cabecera Cookie (y sin cookie o vencida es no)', () => {
    const si = `a=1; izao_consent=v1.a0.m1.t${AHORA}; b=2`;
    const no = `izao_consent=v1.a1.m0.t${AHORA}`;
    expect(marketingAceptadoEnCabecera(si, AHORA)).toBe(true);
    expect(marketingAceptadoEnCabecera(no, AHORA)).toBe(false);
    expect(marketingAceptadoEnCabecera('a=1', AHORA)).toBe(false);
    expect(marketingAceptadoEnCabecera(null, AHORA)).toBe(false);
    expect(marketingAceptadoEnCabecera(si, AHORA + DURACION_SEGUNDOS + 10)).toBe(false);
  });
});
