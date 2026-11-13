/**
 * Decide qué hace `crear-admin` según el estado actual. Es lógica pura (sin red)
 * para poder probarla: nunca cambia `role` ni `is_active` de una fila existente
 * sin un indicador explícito.
 */
import type { Rol } from '../lib/auth/permissions';

export type FilaActual = { role: string; is_active: boolean; name: string; mfa_required: boolean };

export type EntradaPlan = {
  nombre: string;
  existeEnAuth: boolean;
  filaActual: FilaActual | null;
  /** `--confirmar-existente` o respuesta afirmativa en la terminal. */
  confirmarExistente: boolean;
  /** `--rol`: solo si se indicó. */
  rol?: Rol;
  /** `--activar`. */
  activar?: boolean;
};

export type CambioFila =
  | { accion: 'insertar'; valores: { role: Rol; name: string; is_active: true; mfa_required: false } }
  | { accion: 'actualizar'; valores: { role?: Rol; is_active?: true } }
  | { accion: 'ninguna' };

export type Plan =
  | { tipo: 'error'; mensaje: string }
  | {
      tipo: 'ok';
      crearUsuario: boolean;
      /** Usuario existente: se fija la contraseña escrita con `updateUserById`. */
      fijarContrasena: boolean;
      fila: CambioFila;
      avisos: string[];
    };

export function planearAdmin(e: EntradaPlan): Plan {
  if (!e.existeEnAuth) {
    return {
      tipo: 'ok',
      crearUsuario: true,
      fijarContrasena: false,
      fila: {
        accion: 'insertar',
        valores: { role: e.rol ?? 'admin', name: e.nombre, is_active: true, mfa_required: false },
      },
      avisos: [],
    };
  }

  if (!e.confirmarExistente) {
    return {
      tipo: 'error',
      mensaje:
        'Ese correo ya existe en Supabase Auth. Si quieres reemplazar su contraseña, confírmalo ' +
        'escribiendo SI cuando se te pregunte (o usa --confirmar-existente). No se cambió nada.',
    };
  }

  const avisos: string[] = [];
  const actual = e.filaActual;
  if (!actual) {
    return {
      tipo: 'ok',
      crearUsuario: false,
      fijarContrasena: true,
      fila: {
        accion: 'insertar',
        valores: { role: e.rol ?? 'admin', name: e.nombre, is_active: true, mfa_required: false },
      },
      avisos,
    };
  }

  const valores: { role?: Rol; is_active?: true } = {};
  if (e.rol && e.rol !== actual.role) valores.role = e.rol;
  else if (!e.rol && actual.role !== 'admin') {
    avisos.push(`Conserva su rol actual (${actual.role}). Para cambiarlo usa --rol admin|operator.`);
  }
  if (!actual.is_active) {
    if (e.activar) valores.is_active = true;
    else avisos.push('Sigue desactivado. Para reactivarlo usa --activar.');
  }

  return {
    tipo: 'ok',
    crearUsuario: false,
    fijarContrasena: true,
    fila: Object.keys(valores).length ? { accion: 'actualizar', valores } : { accion: 'ninguna' },
    avisos,
  };
}
