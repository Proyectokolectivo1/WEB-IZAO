import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { moduloDeRuta, puede, puedeAccederModulo, puedeVerRuta } from '@/lib/auth/permissions';

const RAIZ = path.resolve(__dirname, '../../../app');

/** §24.3: Usuarios cae en "todo lo demás": solo el administrador. */
describe('permisos de usuarios', () => {
  it('el administrador entra y gestiona', () => {
    expect(puedeAccederModulo('admin', 'usuarios')).toBe(true);
    expect(puede('admin', 'usuarios.gestionar')).toBe(true);
  });

  it('el operador y quien no tiene rol no entran a ninguna ruta de usuarios', () => {
    for (const ruta of ['/admin/usuarios', '/admin/usuarios/nuevo', '/admin/usuarios/abc']) {
      expect(moduloDeRuta(ruta), ruta).toBe('usuarios');
      expect(puedeVerRuta('operator', ruta), ruta).toBe(false);
      expect(puedeVerRuta(null, ruta), ruta).toBe(false);
    }
    expect(puede('operator', 'usuarios.gestionar')).toBe(false);
    expect(puede(null, 'usuarios.gestionar')).toBe(false);
  });

  it('cada Server Action y página exige su permiso en el servidor', () => {
    const leer = (p: string) => readFileSync(path.join(RAIZ, p), 'utf8');
    const a = leer('admin/(panel)/usuarios/acciones.ts');
    // crear, editar y restablecer contraseña
    expect((a.match(/adminDeAccion\('usuarios', 'usuarios\.gestionar'\)/g) ?? []).length).toBe(3);
    for (const p of ['page.tsx', '[id]/page.tsx']) {
      expect(leer(`admin/(panel)/usuarios/${p}`), p).toContain("requerirAdmin({ modulo: 'usuarios', accion: 'usuarios.gestionar' })");
    }
  });
});
