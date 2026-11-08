/**
 * Lógica de decisión del acceso al panel (§24.3, §26.1). Función pura: recibe lo
 * que el middleware ya averiguó (sesión, nivel de MFA, fila de `admin_users`) y
 * devuelve qué hacer. No toca red, cookies ni entorno, así que se prueba con
 * datos simulados.
 */
import { esRol, puedeVerRuta, type Rol } from './permissions';

export const RUTA_LOGIN = '/admin/login';
/**
 * Destino tras el cierre VOLUNTARIO de sesión: la home pública. Es relativa (sin host) para que funcione
 * detrás de Nginx; la raíz resuelve el país por cookie o geolocalización, así que no se fija /co ni /ec.
 * La sesión expirada o sin acceso sigue yendo al login con su aviso.
 */
export const RUTA_TRAS_CIERRE = '/';
export const RUTA_MFA_INSCRIBIR = '/admin/mfa/inscribir';
export const RUTA_MFA_VERIFICAR = '/admin/mfa/verificar';
export const RUTA_INICIO = '/admin';
export const RUTA_SIN_PERMISO = '/admin/sin-permiso';

/** Duración máxima de la sesión del panel (§26.1). */
export const DURACION_SESION_MS = 12 * 60 * 60 * 1000;

export type Aal = 'aal1' | 'aal2';

export type SesionAuth = {
  userId: string;
  /** Nivel alcanzado en esta sesión. `aal2` = MFA verificado. */
  aal: Aal;
  /** Nivel posible: `aal2` si el usuario ya tiene un factor TOTP verificado. */
  siguienteNivel: Aal;
};

export type AdminInfo = {
  role: Rol | string;
  isActive: boolean;
};

export type EntradaDecision = {
  /** Ruta con la consulta (`?…`) si la tiene. */
  pathname: string;
  /** `true` para `/api/admin/**`: se responde con estado HTTP en lugar de redirigir. */
  esApi: boolean;
  sesion: SesionAuth | null;
  admin: AdminInfo | null;
  /** `false` si la marca de inicio de sesión falta o pasó de 12 h. */
  sesionVigente: boolean;
};

export type Decision =
  | { tipo: 'permitir' }
  | { tipo: 'redirigir'; destino: string; cerrarSesion?: boolean }
  | { tipo: 'rechazar'; status: 401 | 403; motivo: string };

/** Motivos que la pantalla de login sabe explicar (`?error=`). */
export type MotivoLogin = 'sin-acceso' | 'sesion-expirada';

const PATRON_SIGUIENTE = /^\/admin(?:\/[\w\-.~%/]*)?(?:\?[\w\-.~%=&+,/]*)?$/;
const RUTAS_DE_ACCESO = [RUTA_LOGIN, RUTA_MFA_INSCRIBIR, RUTA_MFA_VERIFICAR];

/**
 * Valida el destino al que volver tras iniciar sesión. Solo rutas internas de
 * `/admin`; todo lo demás (otro dominio, `//`, `..`, `\`) vuelve al inicio.
 * Evita redirecciones abiertas.
 */
export function rutaSiguienteSegura(valor: string | null | undefined): string {
  if (!valor || valor.length > 300) return RUTA_INICIO;
  if (!PATRON_SIGUIENTE.test(valor)) return RUTA_INICIO;
  if (valor.includes('//') || valor.includes('..')) return RUTA_INICIO;
  const soloRuta = valor.split('?')[0] ?? '';
  if (RUTAS_DE_ACCESO.includes(soloRuta)) return RUTA_INICIO;
  return valor;
}

function hacia(destino: string, cerrarSesion = false): Decision {
  return cerrarSesion ? { tipo: 'redirigir', destino, cerrarSesion } : { tipo: 'redirigir', destino };
}

function aLogin(motivo?: MotivoLogin, siguiente?: string): string {
  const params = new URLSearchParams();
  if (motivo) params.set('error', motivo);
  if (siguiente && siguiente !== RUTA_INICIO) params.set('siguiente', siguiente);
  const consulta = params.toString();
  return consulta ? `${RUTA_LOGIN}?${consulta}` : RUTA_LOGIN;
}

function soloRuta(pathname: string): string {
  const ruta = pathname.split('?')[0] ?? '';
  return ruta.length > 1 ? ruta.replace(/\/+$/, '') : ruta;
}

export function decidirAcceso(entrada: EntradaDecision): Decision {
  const { esApi, sesion, admin, sesionVigente } = entrada;
  const ruta = soloRuta(entrada.pathname);

  const adminValido = admin !== null && admin.isActive && esRol(admin.role);
  const mfaCompleta = sesion !== null && sesion.aal === 'aal2';

  // 1. Pantalla de login: pública, salvo que ya haya una sesión completa.
  if (!esApi && ruta === RUTA_LOGIN) {
    if (sesion && sesionVigente && adminValido && mfaCompleta) return hacia(RUTA_INICIO);
    return { tipo: 'permitir' };
  }

  // 2. Sin sesión, o con la marca de 12 h vencida.
  if (!sesion || !sesionVigente) {
    if (esApi) return { tipo: 'rechazar', status: 401, motivo: 'sin-sesion' };
    if (sesion && !sesionVigente) {
      return hacia(aLogin('sesion-expirada', rutaSiguienteSegura(entrada.pathname)), true);
    }
    return hacia(aLogin(undefined, rutaSiguienteSegura(entrada.pathname)));
  }

  // 3. Sesión de Auth sin fila activa en `admin_users` o con rol desconocido.
  if (!adminValido) {
    if (esApi) return { tipo: 'rechazar', status: 403, motivo: 'sin-acceso' };
    return hacia(aLogin('sin-acceso'), true);
  }

  // 4. MFA pendiente: solo se permite la pantalla que corresponde.
  if (!mfaCompleta) {
    if (esApi) return { tipo: 'rechazar', status: 403, motivo: 'mfa-pendiente' };
    const pendiente = sesion.siguienteNivel === 'aal2' ? RUTA_MFA_VERIFICAR : RUTA_MFA_INSCRIBIR;
    return ruta === pendiente ? { tipo: 'permitir' } : hacia(pendiente);
  }

  // 5. Sesión completa: las pantallas de MFA ya no aplican.
  if (!esApi && (ruta === RUTA_MFA_INSCRIBIR || ruta === RUTA_MFA_VERIFICAR)) {
    return hacia(RUTA_INICIO);
  }

  // 6. Rol y módulo (§24.3). Las rutas desconocidas exigen `admin`.
  if (!puedeVerRuta(admin.role as Rol, ruta)) {
    if (esApi) return { tipo: 'rechazar', status: 403, motivo: 'sin-permiso' };
    return hacia(RUTA_SIN_PERMISO);
  }

  return { tipo: 'permitir' };
}
