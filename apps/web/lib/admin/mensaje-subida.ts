/**
 * Mensajes de las subidas de archivos del panel (imágenes de producto, categorías, banners, contenido, importaciones).
 *
 * Una sola traducción de lo que responde la API (`/api/admin/media`, `/api/admin/catalogo/imagenes`,
 * `/api/admin/catalogo/importar` y el middleware) a texto en español para el dueño. Nunca se muestra un código técnico
 * (`sin-sesion`, `sin-permiso`...): si la API ya devolvió una frase legible se respeta; si devolvió un código, se traduce;
 * si no hay nada que mostrar, se usa el texto según el estado HTTP.
 *
 * Puro (sin servidor ni navegador) para poder probarlo; `enviarSubida` recibe el `fetch` por parámetro.
 */

export const RUTA_ENTRADA_PANEL = '/admin/login';

/** Todos los textos de subida del panel viven aquí. */
export const TEXTOS_SUBIDA = {
  sesionVencida: 'Tu sesión venció. Vuelve a entrar al panel y sube la imagen de nuevo.',
  sesionVencidaArchivo: 'Tu sesión venció. Vuelve a entrar al panel y sube el archivo de nuevo.',
  verificacionPendiente: 'Falta confirmar tu verificación en dos pasos. Vuelve a entrar al panel y sube la imagen de nuevo.',
  sinAcceso: 'Tu usuario ya no tiene acceso al panel. Pídele ayuda al administrador.',
  sinPermiso: 'No tienes permiso para hacer esto. Pídele ayuda al administrador.',
  pesado: 'El archivo pesa demasiado. Reduce su tamaño e inténtalo de nuevo.',
  formato: 'Ese formato no se puede usar. Sube una imagen JPG, PNG, WebP o AVIF.',
  muchosIntentos: 'Hiciste muchos envíos seguidos. Espera un minuto e inténtalo de nuevo.',
  servidor: 'El servidor no pudo procesar el archivo ahora mismo. Espera unos minutos e inténtalo de nuevo.',
  sinConexion: 'No se pudo subir. Revisa tu conexión e inténtalo de nuevo.',
  generico: 'No se pudo subir el archivo. Inténtalo de nuevo.',
  entrarAlPanel: 'Entrar al panel (se abre en otra pestaña)',
} as const;

export type FalloSubida = {
  /** Frase lista para mostrar, en español, sin códigos. Con nombre de archivo si se indicó. */
  texto: string;
  /** La sesión se perdió: conviene ofrecer el enlace al login. */
  requiereLogin: boolean;
};

type Traduccion = { texto: string; requiereLogin: boolean };

const POR_CODIGO: Record<string, Traduccion> = {
  'sin-sesion': { texto: TEXTOS_SUBIDA.sesionVencida, requiereLogin: true },
  'sesion-expirada': { texto: TEXTOS_SUBIDA.sesionVencida, requiereLogin: true },
  'mfa-pendiente': { texto: TEXTOS_SUBIDA.verificacionPendiente, requiereLogin: true },
  'mfa-no-aprobado': { texto: TEXTOS_SUBIDA.verificacionPendiente, requiereLogin: true },
  'sin-acceso': { texto: TEXTOS_SUBIDA.sinAcceso, requiereLogin: false },
  'sin-permiso': { texto: TEXTOS_SUBIDA.sinPermiso, requiereLogin: false },
};

/** Un código técnico es una sola palabra o varias unidas con guiones, sin espacios ni tildes (`sin-sesion`). */
export function esCodigoTecnico(texto: string): boolean {
  return /^[a-z0-9]+([-_.][a-z0-9]+)*$/i.test(texto.trim());
}

function porEstado(status: number | undefined): Traduccion {
  if (status === 401) return { texto: TEXTOS_SUBIDA.sesionVencida, requiereLogin: true };
  if (status === 403) return { texto: TEXTOS_SUBIDA.sinPermiso, requiereLogin: false };
  if (status === 413) return { texto: TEXTOS_SUBIDA.pesado, requiereLogin: false };
  if (status === 415) return { texto: TEXTOS_SUBIDA.formato, requiereLogin: false };
  if (status === 429) return { texto: TEXTOS_SUBIDA.muchosIntentos, requiereLogin: false };
  if (status !== undefined && status >= 500) return { texto: TEXTOS_SUBIDA.servidor, requiereLogin: false };
  return { texto: TEXTOS_SUBIDA.generico, requiereLogin: false };
}

function primerErrorDeCampos(campos: unknown): string | null {
  if (!campos || typeof campos !== 'object') return null;
  for (const v of Object.values(campos as Record<string, unknown>)) {
    if (typeof v === 'string' && v.trim() && !esCodigoTecnico(v)) return v.trim();
  }
  return null;
}

export type RespuestaSubida = {
  status?: number | undefined;
  /** Cuerpo JSON ya leído (o `null` si no era JSON: HTML de Nginx, redirección al login, vacío). */
  cuerpo?: unknown;
  /** La petición terminó en la pantalla de acceso del panel (redirección que `fetch` siguió sola). */
  terminoEnLogin?: boolean | undefined;
  /** Nombre del archivo, solo cuando hay varios (se antepone al mensaje). */
  archivo?: string | undefined;
  /** Para importaciones de CSV/Excel el texto de sesión menciona «el archivo» en vez de «la imagen». */
  tipo?: 'imagen' | 'archivo' | undefined;
};

/** Traduce una respuesta fallida a un mensaje humano. Nunca devuelve un código técnico. */
export function mensajeDeSubida(entrada: RespuestaSubida): FalloSubida {
  const { status, cuerpo, archivo } = entrada;
  const error = cuerpo && typeof cuerpo === 'object' ? (cuerpo as { error?: unknown; campos?: unknown }) : null;
  const crudo = typeof error?.error === 'string' ? error.error.trim() : '';

  let r: Traduccion;
  if (entrada.terminoEnLogin) {
    r = { texto: TEXTOS_SUBIDA.sesionVencida, requiereLogin: true };
  } else if (crudo && esCodigoTecnico(crudo)) {
    r = POR_CODIGO[crudo.toLowerCase()] ?? porEstado(status);
  } else if (crudo) {
    // Frase que ya escribió la API para el dueño («La imagen supera los 15 MB.»): se respeta.
    r = { texto: primerErrorDeCampos(error?.campos) ?? crudo, requiereLogin: false };
  } else {
    r = porEstado(status);
  }
  if (r.texto === TEXTOS_SUBIDA.sesionVencida && entrada.tipo === 'archivo') r = { ...r, texto: TEXTOS_SUBIDA.sesionVencidaArchivo };
  return { texto: archivo ? `${archivo}: ${r.texto}` : r.texto, requiereLogin: r.requiereLogin };
}

/** Fallo cuando ni siquiera hubo respuesta (sin internet, corte, tiempo agotado). */
export function mensajeSinConexion(archivo?: string): FalloSubida {
  return { texto: archivo ? `${archivo}: ${TEXTOS_SUBIDA.sinConexion}` : TEXTOS_SUBIDA.sinConexion, requiereLogin: false };
}

type Respuesta = Pick<Response, 'ok' | 'status' | 'redirected' | 'url' | 'json'>;
type Peticion = (url: string, init: { method: 'POST'; body: FormData }) => Promise<Respuesta>;

export type ResultadoEnvio<T> = { ok: true; cuerpo: T } | { ok: false; fallo: FalloSubida };

/**
 * POST multipart al panel. Devuelve el cuerpo si salió bien o un fallo ya redactado. `valida` decide si el cuerpo de una
 * respuesta 2xx sirve (por ejemplo, que traiga `id`); si no, se trata como fallo del servidor.
 */
export async function enviarSubida<T extends object>(
  url: string,
  datos: FormData,
  opciones: {
    archivo?: string;
    tipo?: 'imagen' | 'archivo';
    valida?: (cuerpo: T) => boolean;
    peticion?: Peticion;
  } = {},
): Promise<ResultadoEnvio<T>> {
  const hacer: Peticion = opciones.peticion ?? ((u, init) => fetch(u, init));
  let r: Respuesta;
  try {
    r = await hacer(url, { method: 'POST', body: datos });
  } catch {
    return { ok: false, fallo: mensajeSinConexion(opciones.archivo) };
  }
  const cuerpo = (await r.json().catch(() => null)) as unknown;
  const terminoEnLogin = Boolean(r.redirected && /\/admin\/login(\?|$)/.test(r.url));
  const sirve =
    r.ok && !terminoEnLogin && cuerpo !== null && typeof cuerpo === 'object' && !('error' in (cuerpo as object)) &&
    (opciones.valida ? opciones.valida(cuerpo as T) : true);
  if (sirve) return { ok: true, cuerpo: cuerpo as T };
  return {
    ok: false,
    fallo: mensajeDeSubida({
      status: r.ok ? 500 : r.status,
      cuerpo,
      terminoEnLogin,
      archivo: opciones.archivo,
      tipo: opciones.tipo,
    }),
  };
}
