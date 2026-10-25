import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { moduloDeRuta, puede, puedeAccederModulo, puedeVerRuta } from '@/lib/auth/permissions';

const RAIZ = path.resolve(__dirname, '../../../app');

/** §24.3: Garantías es de ambos roles; sus ajustes (plazo, motivos, textos) son configuración: solo administrador. */
describe('permisos de garantías', () => {
  it('administrador y operador entran al módulo y gestionan casos', () => {
    for (const rol of ['admin', 'operator'] as const) {
      expect(puedeAccederModulo(rol, 'garantias')).toBe(true);
      expect(puede(rol, 'garantias.gestionar')).toBe(true);
      expect(puedeVerRuta(rol, '/admin/garantias')).toBe(true);
      expect(puedeVerRuta(rol, '/admin/garantias/abc')).toBe(true);
    }
  });

  it('los ajustes son solo del administrador y sin rol se niega todo', () => {
    expect(puede('admin', 'garantias.ajustes')).toBe(true);
    expect(puede('operator', 'garantias.ajustes')).toBe(false);
    expect(puede(null, 'garantias.ajustes')).toBe(false);
    expect(puede(null, 'garantias.gestionar')).toBe(false);
    expect(moduloDeRuta('/admin/garantias/ajustes')).toBe('garantias');
  });

  it('cada Server Action y página exige su acción en el servidor', () => {
    const leer = (p: string) => readFileSync(path.join(RAIZ, p), 'utf8');
    const a = leer('admin/(panel)/garantias/acciones.ts');
    expect(a).toContain("adminDeAccion('garantias', 'garantias.gestionar')");
    expect(a).toContain("adminDeAccion('garantias', 'garantias.ajustes')");
    expect((a.match(/adminDeAccion\(/g) ?? []).length).toBe(2);
    expect(leer('admin/(panel)/garantias/page.tsx')).toContain("accion: 'garantias.gestionar'");
    expect(leer('admin/(panel)/garantias/[id]/page.tsx')).toContain("accion: 'garantias.gestionar'");
    expect(leer('admin/(panel)/garantias/ajustes/page.tsx')).toContain("accion: 'garantias.ajustes'");
  });
});
