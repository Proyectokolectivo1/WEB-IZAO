/**
 * Cliente de Supabase falso para pruebas de las funciones de servidor del panel.
 * Cada `tabla.operación` devuelve la respuesta preparada y deja registrada la
 * llamada con sus argumentos. Solo se importa desde archivos `*.test.ts`.
 */
import type { Cliente } from '../catalogo/taxonomias-servidor';

export type Respuesta = {
  data?: unknown;
  error?: { code?: string; message: string; details?: string } | null;
  count?: number | null;
};

export function clienteFalso(respuestas: Record<string, Respuesta>) {
  const llamadas: { clave: string; args: unknown[] }[] = [];
  const cliente = {
    from(tabla: string) {
      let op = 'select';
      const b: Record<string, unknown> = {};
      const resolver = () => ({ data: null, error: null, count: null, ...(respuestas[`${tabla}.${op}`] ?? {}) });
      for (const m of ['select', 'insert', 'update', 'upsert', 'delete']) {
        b[m] = (...args: unknown[]) => {
          if (m !== 'select' || op === 'select') op = m;
          llamadas.push({ clave: `${tabla}.${m}`, args });
          return b;
        };
      }
      for (const m of ['eq', 'neq', 'in', 'order', 'range', 'ilike', 'limit']) b[m] = () => b;
      b.maybeSingle = async () => resolver();
      b.single = async () => resolver();
      b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
        Promise.resolve(resolver()).then(ok, ko);
      return b;
    },
  };
  return { cliente: cliente as unknown as Cliente, llamadas };
}
