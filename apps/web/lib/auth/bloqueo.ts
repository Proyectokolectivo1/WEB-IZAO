/**
 * Bloqueo temporal por intentos (§26.1). Falla cerrado: si no se puede
 * registrar el intento o consultar el conteo, NO se deja pasar.
 *
 * Orden: 1) contar; si ya está en el máximo, bloquear SIN insertar nada (una
 * ráfaga contra una clave bloqueada no puede llenar `audit_log`, que no admite
 * DELETE); 2) registrar el intento ANTES de autenticar; 3) volver a contar: el
 * conteo ya incluye este intento y los paralelos, así que no se salta el límite
 * leyendo todos un contador viejo.
 */

export type ResultadoIntento =
  | { estado: 'permitido' }
  | { estado: 'error' }
  | { estado: 'bloqueado'; /** Clave del contador que bloqueó (`correo`, `ip`, `usuario`…). */ por: string };

export type Contador = {
  /** Intentos sin éxito en la ventana, o `null` si la consulta falló. */
  netos: () => Promise<number | null>;
  /** Máximo permitido de intentos sin éxito. */
  max: number;
  clave: string;
};

export async function evaluarIntento(args: {
  registrar: () => Promise<boolean>;
  contadores: Contador[];
}): Promise<ResultadoIntento> {
  try {
    const revisar = async (limite: (n: number, max: number) => boolean): Promise<ResultadoIntento | null> => {
      const conteos = await Promise.all(args.contadores.map((c) => c.netos()));
      if (conteos.some((n) => n === null)) return { estado: 'error' };
      const i = conteos.findIndex((n, k) => limite(n as number, (args.contadores[k] as Contador).max));
      return i >= 0 ? { estado: 'bloqueado', por: (args.contadores[i] as Contador).clave } : null;
    };

    // 1) Ya en el máximo: este intento sería el siguiente. No se inserta nada.
    const previo = await revisar((n, max) => n >= max);
    if (previo) return previo;

    // 2) Se registra antes de autenticar.
    if (!(await args.registrar())) return { estado: 'error' };

    // 3) El conteo ya incluye este intento y los concurrentes.
    const posterior = await revisar((n, max) => n > max);
    return posterior ?? { estado: 'permitido' };
  } catch {
    return { estado: 'error' };
  }
}

/**
 * Registra el aviso de bloqueo a lo sumo una vez por ventana: solo si todavía no
 * hay uno. Si no se puede contar, no escribe.
 */
export async function registrarUnaVez(args: {
  contar: () => Promise<number | null>;
  registrar: () => Promise<boolean>;
}): Promise<void> {
  try {
    if ((await args.contar()) === 0) await args.registrar();
  } catch {
    // Un fallo al avisar no cambia el bloqueo.
  }
}

/** Intentos menos éxitos (un ingreso correcto "perdona" un intento). `null` si falló algo. */
export function netosDe(intentos: number | null, exitos: number | null): number | null {
  if (intentos === null || exitos === null) return null;
  return Math.max(0, intentos - exitos);
}
