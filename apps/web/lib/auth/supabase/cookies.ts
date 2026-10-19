/**
 * Opciones de las cookies de sesión de Supabase en el panel. Todo el flujo de
 * autenticación ocurre en el servidor, así que se marcan `httpOnly`.
 */
import { esProduccion } from '../env';

export type OpcionesCookie = {
  path?: string;
  domain?: string;
  maxAge?: number;
  expires?: Date;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: boolean | 'lax' | 'strict' | 'none';
};

export function endurecerCookie(opciones: OpcionesCookie | undefined): OpcionesCookie {
  return {
    ...opciones,
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: esProduccion(),
  };
}
