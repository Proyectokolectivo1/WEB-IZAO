/**
 * Bloqueo temporal por intentos (§26.1). Falla cerrado: si no se puede
 * registrar el intento o consultar el conteo, NO se deja pasar.
 *
 * El intento se registra ANTES de autenticar y el conteo ya lo incluye. Así,
 * varias peticiones en paralelo se ven entre sí y no pueden saltarse el límite
 * leyendo todas un contador viejo.
 */

export type ResultadoIntento = 'permitido' | 'bloqueado' | 'error';

export type Contador = {
  /** Intentos sin éxito en la ventana, o `null` si la consulta falló. */
  netos: () => Promise<number | null>;
  /** Máximo permitido; el intento actual ya está incluido en el conteo. */
  max: number;
};

export async function evaluarIntento(args: {
  registrar: () => Promise<boolean>;
  contadores: Contador[];
}): Promise<ResultadoIntento> {
  try {
    if (!(await args.registrar())) return 'error';
    const conteos = await Promise.all(args.contadores.map((c) => c.netos()));
    if (conteos.some((n) => n === null)) return 'error';
    const bloqueado = conteos.some((n, i) => (n as number) > (args.contadores[i] as Contador).max);
    return bloqueado ? 'bloqueado' : 'permitido';
  } catch {
    return 'error';
  }
}

/** Intentos menos éxitos (un ingreso correcto "perdona" un intento). `null` si falló algo. */
export function netosDe(intentos: number | null, exitos: number | null): number | null {
  if (intentos === null || exitos === null) return null;
  return Math.max(0, intentos - exitos);
}
