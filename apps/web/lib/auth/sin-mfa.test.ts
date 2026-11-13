import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * D-054: el panel entra solo con correo y contraseña. Esta prueba evita que se cuele de nuevo una exigencia de
 * segundo factor (rutas, nivel `aal2`, llamadas a `auth.mfa`) en el código de la aplicación.
 */
const RAIZ = path.resolve(__dirname, '../..');
const CARPETAS = ['app', 'components', 'lib', 'middleware.ts', 'scripts'];

function archivos(ruta: string): string[] {
  const completa = path.join(RAIZ, ruta);
  if (!existsSync(completa)) return [];
  if (statSync(completa).isFile()) return [completa];
  return readdirSync(completa, { withFileTypes: true }).flatMap((e) => {
    if (e.name === 'node_modules' || e.name.startsWith('.next')) return [];
    return archivos(path.join(ruta, e.name));
  });
}

const FUENTES = CARPETAS.flatMap(archivos).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.endsWith('sin-mfa.test.ts'));

describe('sin segundo factor (D-054)', () => {
  it('no existen las pantallas ni las rutas de MFA', () => {
    expect(existsSync(path.join(RAIZ, 'app/admin/mfa'))).toBe(false);
    expect(existsSync(path.join(RAIZ, 'components/admin/InscripcionMfa.tsx'))).toBe(false);
    expect(existsSync(path.join(RAIZ, 'components/admin/VerificacionMfa.tsx'))).toBe(false);
  });

  it('ningún archivo de la aplicación exige aal2 ni llama a auth.mfa', () => {
    const prohibidos = [/\baal2\b/, /\.mfa\./, /getAuthenticatorAssuranceLevel/, /mfa_factor_aprobado/, /mfa_enrolamiento/, /RUTA_MFA_/];
    const culpables: string[] = [];
    for (const f of FUENTES) {
      const texto = readFileSync(f, 'utf8');
      for (const p of prohibidos) if (p.test(texto)) culpables.push(`${path.relative(RAIZ, f)} -> ${p}`);
    }
    expect(culpables).toEqual([]);
  });

  it('el middleware y los guardias no distinguen el nivel de la sesión', () => {
    for (const f of ['middleware.ts', 'lib/auth/guard.ts', 'lib/auth/contexto.ts', 'lib/auth/decision.ts']) {
      expect(readFileSync(path.join(RAIZ, f), 'utf8'), f).not.toMatch(/mfaCompleta|siguienteNivel|mfaNoAprobada|mfa-pendiente/);
    }
  });
});
