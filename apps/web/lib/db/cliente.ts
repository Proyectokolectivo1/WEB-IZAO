/**
 * Acceso a la base desde el servidor (zona de izao-db).
 *
 * SOLO SERVIDOR. Reutiliza el cliente con la llave secreta de `lib/auth/supabase/servicio.ts`
 * (sin sesión) y lo comparte dentro del proceso. Toda respuesta de un RPC se valida con zod antes
 * de salir de aquí: si la base cambia de forma, falla en el servidor y no en el navegador.
 */
import 'server-only';
import type { z } from 'zod';
import { crearClienteServicio } from '../auth/supabase/servicio';

type ClienteServicio = ReturnType<typeof crearClienteServicio>;

let cliente: ClienteServicio | null = null;

/** Cliente de servicio compartido. Nunca se pasa a un componente de cliente. */
export function clienteDb(): ClienteServicio {
  cliente ??= crearClienteServicio();
  return cliente;
}

/** Solo para pruebas: reemplaza o limpia el cliente compartido. */
export function fijarClienteDbParaPruebas(c: ClienteServicio | null): void {
  cliente = c;
}

export type MotivoErrorDb = 'rpc' | 'forma';

/** Error de la capa de datos. El mensaje no incluye datos del usuario ni secretos. */
export class ErrorDb extends Error {
  readonly motivo: MotivoErrorDb;
  readonly funcion: string;
  readonly codigo: string | null;

  constructor(funcion: string, motivo: MotivoErrorDb, detalle: string, codigo: string | null = null) {
    super(`${funcion}: ${detalle}`);
    this.name = 'ErrorDb';
    this.funcion = funcion;
    this.motivo = motivo;
    this.codigo = codigo;
  }
}

/** Llama un RPC y valida su retorno. Lanza `ErrorDb` si falla o si la forma no coincide. */
export async function llamarRpc<S extends z.ZodType>(
  funcion: string,
  args: Record<string, unknown>,
  esquema: S,
): Promise<z.infer<S>> {
  const { data, error } = await clienteDb().rpc(funcion, args);
  if (error) {
    throw new ErrorDb(funcion, 'rpc', error.message, error.code ?? null);
  }
  const r = esquema.safeParse(data);
  if (!r.success) {
    const ruta = r.error.issues[0]?.path.join('.') ?? '';
    throw new ErrorDb(funcion, 'forma', `respuesta inesperada en "${ruta}"`);
  }
  return r.data;
}
