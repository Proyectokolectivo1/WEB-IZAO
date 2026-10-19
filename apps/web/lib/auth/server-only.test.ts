import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Módulos que leen o usan secretos: deben fallar la compilación si un componente
// de cliente los importa.
const SOLO_SERVIDOR = ['env.ts', 'supabase/servicio.ts', 'admin-users.ts', 'guard.ts'];

describe("módulos de secretos marcados con import 'server-only'", () => {
  for (const archivo of SOLO_SERVIDOR) {
    it(archivo, () => {
      const fuente = readFileSync(path.join(__dirname, archivo), 'utf8');
      expect(fuente).toMatch(/^import ['"]server-only['"];?\s*$/m);
    });
  }
});
