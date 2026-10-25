import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { moduloDeRuta, puede, puedeAccederModulo, puedeVerRuta } from '@/lib/auth/permissions';

const RAIZ = path.resolve(__dirname, '../../../app');

/** §24.3: el chatbot cae en "todo lo demás": solo el administrador (las conversaciones pueden traer datos personales). */
describe('permisos del chatbot', () => {
  it('el administrador entra y gestiona', () => {
    expect(puedeAccederModulo('admin', 'chatbot')).toBe(true);
    expect(puede('admin', 'chatbot.gestionar')).toBe(true);
  });

  it('el operador y quien no tiene rol no entran, ni a las conversaciones', () => {
    for (const ruta of ['/admin/chatbot', '/admin/chatbot/conversaciones', '/admin/chatbot/conversaciones/abc']) {
      expect(moduloDeRuta(ruta), ruta).toBe('chatbot');
      expect(puedeVerRuta('operator', ruta), ruta).toBe(false);
      expect(puedeVerRuta(null, ruta), ruta).toBe(false);
    }
    expect(puede('operator', 'chatbot.gestionar')).toBe(false);
    expect(puede(null, 'chatbot.gestionar')).toBe(false);
  });

  it('la acción y cada página exigen el permiso en el servidor', () => {
    const leer = (p: string) => readFileSync(path.join(RAIZ, p), 'utf8');
    expect(leer('admin/(panel)/chatbot/acciones.ts')).toContain("adminDeAccion('chatbot', 'chatbot.gestionar')");
    for (const p of ['page.tsx', 'conversaciones/page.tsx', 'conversaciones/[id]/page.tsx']) {
      expect(leer(`admin/(panel)/chatbot/${p}`), p).toContain("requerirAdmin({ modulo: 'chatbot', accion: 'chatbot.gestionar' })");
    }
  });
});
