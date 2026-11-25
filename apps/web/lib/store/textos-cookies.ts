/**
 * Textos del aviso de cookies y de las preferencias (§8.6, §23.2). Los de aquí son los valores por defecto del seed; el panel los
 * sobrescribe con espacios de contenido del país (`content_slots`), cada uno con título (campo título) y texto (campo cuerpo):
 * - `cookies_aviso`: título y texto del aviso.
 * - `cookies_preferencias`: título y texto introductorio de la ventana de preferencias.
 * - `cookies_necesarias`, `cookies_analitica`, `cookies_marketing`: nombre y descripción de cada categoría.
 * Los botones y las etiquetas de accesibilidad son de interfaz y no se editan. Ningún texto afirma originalidad ni relación con marcas.
 */
import type { EspacioContenido } from './types';

export const CLAVES_COOKIES = ['cookies_aviso', 'cookies_preferencias', 'cookies_necesarias', 'cookies_analitica', 'cookies_marketing'] as const;

export const TCK = {
  aviso: {
    titulo: 'Cookies en Izao',
    texto:
      'Usamos cookies necesarias para que la tienda funcione y, con tu permiso, otras para medir el sitio y mostrarte publicidad que te interese. Tú decides.',
    enlace: 'Más información',
  },
  preferencias: {
    titulo: 'Preferencias de cookies',
    texto:
      'Elige qué cookies aceptas. Las necesarias siempre están activas porque sin ellas la tienda no funciona. Puedes cambiar tu decisión cuando quieras desde «Cookies», en el pie de la página.',
  },
  necesarias: {
    titulo: 'Necesarias',
    texto: 'Guardan tu bolso, tu país y tu sesión. Siempre activas.',
  },
  analitica: {
    titulo: 'Analítica',
    texto: 'Nos ayudan a entender qué partes de la tienda se usan más, para mejorarla.',
  },
  marketing: {
    titulo: 'Publicidad',
    texto: 'Permiten medir nuestros anuncios en redes sociales (como Meta) y mostrarte los que más se parecen a lo que buscas.',
  },
  /** Interfaz: no se edita en el panel. */
  ui: {
    region: 'Aviso de cookies',
    aceptar: 'Aceptar',
    rechazar: 'Rechazar',
    preferencias: 'Preferencias',
    guardar: 'Guardar mi selección',
    aceptarTodas: 'Aceptar todas',
    rechazarTodas: 'Rechazar todas',
    siempreActivas: 'Siempre activas',
    cerrar: 'Cerrar',
    guardado: 'Listo, guardamos tu decisión.',
    recargar: 'Para que se aplique del todo, recarga la página.',
    recargarAhora: 'Recargar ahora',
    enlacePie: 'Cookies',
    enlacePieAria: 'Cookies: cambiar mi decisión',
  },
} as const;

type Espacio = Pick<EspacioContenido, 'key' | 'title' | 'body'>;

export interface TextosCookies {
  avisoTitulo: string;
  avisoTexto: string;
  preferenciasTitulo: string;
  preferenciasTexto: string;
  necesariasTitulo: string;
  necesariasTexto: string;
  analiticaTitulo: string;
  analiticaTexto: string;
  marketingTitulo: string;
  marketingTexto: string;
}

const campo = (espacios: readonly Espacio[], key: string, c: 'title' | 'body'): string | null => espacios.find((e) => e.key === key)?.[c]?.trim() || null;

/** Textos del país: lo que haya en el panel y, si falta algún campo, el del seed. */
export function textosCookies(espacios: readonly Espacio[]): TextosCookies {
  return {
    avisoTitulo: campo(espacios, 'cookies_aviso', 'title') ?? TCK.aviso.titulo,
    avisoTexto: campo(espacios, 'cookies_aviso', 'body') ?? TCK.aviso.texto,
    preferenciasTitulo: campo(espacios, 'cookies_preferencias', 'title') ?? TCK.preferencias.titulo,
    preferenciasTexto: campo(espacios, 'cookies_preferencias', 'body') ?? TCK.preferencias.texto,
    necesariasTitulo: campo(espacios, 'cookies_necesarias', 'title') ?? TCK.necesarias.titulo,
    necesariasTexto: campo(espacios, 'cookies_necesarias', 'body') ?? TCK.necesarias.texto,
    analiticaTitulo: campo(espacios, 'cookies_analitica', 'title') ?? TCK.analitica.titulo,
    analiticaTexto: campo(espacios, 'cookies_analitica', 'body') ?? TCK.analitica.texto,
    marketingTitulo: campo(espacios, 'cookies_marketing', 'title') ?? TCK.marketing.titulo,
    marketingTexto: campo(espacios, 'cookies_marketing', 'body') ?? TCK.marketing.texto,
  };
}

/** Página de la política de datos (que cubre las cookies) publicada en el país, para el enlace del aviso. */
export function enlacePoliticaDatos(pais: string, paginas: readonly { slug: string; kind: string }[]): string | null {
  const p = paginas.find((x) => x.kind === 'tratamiento_datos');
  return p ? `/${pais}/pagina/${p.slug}` : null;
}
