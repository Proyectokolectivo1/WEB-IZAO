/**
 * Validador mínimo para las respuestas del servidor que lee el navegador (bolso y checkout).
 *
 * Existe porque `zod` (incluso `zod/mini`) pesa 16-26 KB gzip y se carga con el JS inicial del bolso y del checkout (presupuesto
 * 170 KB). Cubre solo lo que esos contratos usan: texto (con patrón), entero ≥ 0, booleano, enumerado, nulos/opcionales,
 * listas y objetos (las claves desconocidas se descartan, igual que `z.object`). Misma interfaz de uso que zod:
 * `esquema.safeParse(x)` → `{ success, data }` y `esquema.parse(x)`.
 */
type Resultado<T> = { ok: true; v: T } | { ok: false };

export type ResultadoParse<T> = { success: true; data: T } | { success: false };

export interface Esquema<T> {
  safeParse(valor: unknown): ResultadoParse<T>;
  parse(valor: unknown): T;
}

export type Inferir<E> = E extends { parse(valor: unknown): infer T } ? T : never;

function crear<T>(f: (valor: unknown) => Resultado<T>): Esquema<T> {
  return {
    safeParse: (valor) => {
      const r = f(valor);
      return r.ok ? { success: true, data: r.v } : { success: false };
    },
    parse: (valor) => {
      const r = f(valor);
      if (!r.ok) throw new Error('Respuesta con forma inesperada.');
      return r.v;
    },
  };
}

export const texto = (patron?: RegExp): Esquema<string> =>
  crear<string>((v) => (typeof v === 'string' && (!patron || patron.test(v)) ? { ok: true, v } : { ok: false }));

/** Entero seguro mayor o igual que 0. */
export const enteroNoNegativo = (): Esquema<number> =>
  crear<number>((v) => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? { ok: true, v } : { ok: false }));

export const booleano = (): Esquema<boolean> => crear<boolean>((v) => (typeof v === 'boolean' ? { ok: true, v } : { ok: false }));

export const enumerado = <const L extends readonly string[]>(valores: L): Esquema<L[number]> =>
  crear<L[number]>((v) => (typeof v === 'string' && (valores as readonly string[]).includes(v) ? { ok: true, v: v as L[number] } : { ok: false }));

export const anulable = <T>(e: Esquema<T>): Esquema<T | null> =>
  crear<T | null>((v) => (v === null ? { ok: true, v: null } : (porDentro(e, v) as Resultado<T | null>)));

export const opcional = <T>(e: Esquema<T>): Esquema<T | undefined> =>
  crear<T | undefined>((v) => (v === undefined ? { ok: true, v: undefined } : (porDentro(e, v) as Resultado<T | undefined>)));

/** `null` o `undefined` valen (como `z.nullish`). */
export const nuloOIndefinido = <T>(e: Esquema<T>): Esquema<T | null | undefined> =>
  crear<T | null | undefined>((v) => (v === null || v === undefined ? { ok: true, v } : (porDentro(e, v) as Resultado<T | null | undefined>)));

export const lista = <T>(e: Esquema<T>): Esquema<T[]> =>
  crear<T[]>((v) => {
    if (!Array.isArray(v)) return { ok: false };
    const salida: T[] = [];
    for (const x of v) {
      const r = porDentro(e, x);
      if (!r.ok) return { ok: false };
      salida.push(r.v);
    }
    return { ok: true, v: salida };
  });

type Forma = Record<string, Esquema<unknown>>;
type ClavesOpcionales<S extends Forma> = { [K in keyof S]: undefined extends Inferir<S[K]> ? K : never }[keyof S];
type Objeto<S extends Forma> = { [K in Exclude<keyof S, ClavesOpcionales<S>>]: Inferir<S[K]> } & { [K in ClavesOpcionales<S>]?: Inferir<S[K]> };

export const objeto = <S extends Forma>(forma: S): Esquema<Objeto<S>> =>
  crear<Objeto<S>>((v) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return { ok: false };
    const origen = v as Record<string, unknown>;
    const salida: Record<string, unknown> = {};
    for (const clave of Object.keys(forma)) {
      const r = porDentro(forma[clave]!, origen[clave]);
      if (!r.ok) return { ok: false };
      if (r.v !== undefined) salida[clave] = r.v;
    }
    return { ok: true, v: salida as Objeto<S> };
  });

function porDentro<T>(e: Esquema<T>, v: unknown): Resultado<T> {
  const r = e.safeParse(v);
  return r.success ? { ok: true, v: r.data } : { ok: false };
}
