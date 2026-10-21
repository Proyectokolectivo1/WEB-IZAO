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

/** Una respuesta, o una lista que se consume en orden (la última se repite). */
export type RespuestaOLista = Respuesta | Respuesta[];

export function clienteFalso(respuestas: Record<string, RespuestaOLista>) {
  const turnos = new Map<string, number>();
  const llamadas: { clave: string; args: unknown[] }[] = [];
  const cliente = {
    from(tabla: string) {
      let op = 'select';
      const b: Record<string, unknown> = {};
      const resolver = () => {
        const clave = `${tabla}.${op}`;
        const r = respuestas[clave];
        let elegida: Respuesta | undefined;
        if (Array.isArray(r)) {
          const n = turnos.get(clave) ?? 0;
          turnos.set(clave, n + 1);
          elegida = r[Math.min(n, r.length - 1)];
        } else {
          elegida = r;
        }
        return { data: null, error: null, count: null, ...(elegida ?? {}) };
      };
      for (const m of ['select', 'insert', 'update', 'upsert', 'delete']) {
        b[m] = (...args: unknown[]) => {
          if (m !== 'select' || op === 'select') op = m;
          llamadas.push({ clave: `${tabla}.${m}`, args });
          return b;
        };
      }
      for (const m of ['eq', 'neq', 'in', 'order', 'range', 'ilike', 'limit', 'is', 'not', 'gte']) b[m] = () => b;
      b.maybeSingle = async () => resolver();
      b.single = async () => resolver();
      b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
        Promise.resolve(resolver()).then(ok, ko);
      return b;
    },
  };
  return { cliente: cliente as unknown as Cliente, llamadas };
}
