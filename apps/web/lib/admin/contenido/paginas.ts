/**
 * Páginas y políticas del sitio (§9.5): tipo, estado, versión y HTML depurado. Código puro compartido por
 * servidor, formulario y pruebas.
 *
 * Reglas de la base (migraciones 20261019170439 y 20261020213954):
 *  - `kind` distinto de `general` admite a lo sumo UNA página publicada por país (índice único parcial).
 *  - Una página con marcadores `[COMPLETAR]`, `[RAZÓN SOCIAL]`... no se publica (trigger).
 *  - `version` no sube sola: la sube el panel al publicar o al cambiar el texto publicado.
 */
import { z } from 'zod';
import { depurarHtml } from '@/lib/store/html-seguro';
import { PATRON_SLUG, nulaSiVacio } from '../crud/comun';

export const PAISES_PAGINA = ['CO', 'EC'] as const;
export type PaisPagina = (typeof PAISES_PAGINA)[number];
export const NOMBRE_PAIS_PAGINA: Record<PaisPagina, string> = { CO: 'Colombia', EC: 'Ecuador' };

export const TIPOS_PAGINA = ['general', 'quienes_somos', 'envios', 'tratamiento_datos', 'terminos', 'devoluciones'] as const;
export type TipoPagina = (typeof TIPOS_PAGINA)[number];

export const ETIQUETA_TIPO: Record<TipoPagina, string> = {
  general: 'Página general',
  quienes_somos: 'Quiénes somos',
  envios: 'Política de envíos',
  tratamiento_datos: 'Tratamiento de datos',
  terminos: 'Términos y condiciones',
  devoluciones: 'Devoluciones y garantías',
};

/** Identificador de URL sugerido por tipo (coincide con el seed). */
export const SLUG_SUGERIDO: Record<TipoPagina, string> = {
  general: '',
  quienes_somos: 'quienes-somos',
  envios: 'politica-de-envios',
  tratamiento_datos: 'tratamiento-de-datos',
  terminos: 'terminos-y-condiciones',
  devoluciones: 'devoluciones-y-garantias',
};

export const ESTADOS_PAGINA = ['draft', 'published'] as const;
export type EstadoPagina = (typeof ESTADOS_PAGINA)[number];
export const ETIQUETA_ESTADO: Record<EstadoPagina, string> = { draft: 'Borrador', published: 'Publicada' };

/** ¿Solo puede haber una publicada por país? (todo menos `general`). */
export function esTipoUnico(kind: TipoPagina): boolean {
  return kind !== 'general';
}

/** Mismos marcadores que bloquea el trigger `enforce_page_publish_markers`. */
const MARCADORES = /\[(COMPLETAR|RAZÓN SOCIAL|NIT|DIRECCIÓN[^\]]*|CORREO|TELÉFONO|NÚMERO|HORARIO|FECHA|URL|CONFIRMAR[^\]]*|VERIFICAR[^\]]*)\]/g;

/** Marcadores sin resolver dentro del texto (únicos, en orden de aparición). */
export function marcadoresPendientes(html: string): string[] {
  return [...new Set(html.match(MARCADORES) ?? [])];
}

const casillaTexto = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo ${max} caracteres.`)
    .optional()
    .transform((v) => nulaSiVacio(v));

export const esquemaPagina = z.object({
  id: z.string().uuid().optional().or(z.literal('').transform(() => undefined)),
  country_code: z.enum(PAISES_PAGINA, { message: 'Elige un país.' }),
  kind: z.enum(TIPOS_PAGINA, { message: 'Elige el tipo de página.' }),
  slug: z
    .string()
    .trim()
    .min(2, 'El identificador de URL es obligatorio.')
    .max(120)
    .regex(PATRON_SLUG, 'Usa minúsculas, números y guiones (ej. politica-de-envios).'),
  title: z.string().trim().min(2, 'Escribe al menos 2 caracteres.').max(160, 'Máximo 160 caracteres.'),
  // El HTML se depura al validar: lo que llega a la base ya está dentro de la lista blanca de la tienda.
  content_html: z
    .string()
    .max(200_000, 'El texto es demasiado largo.')
    .transform((v) => depurarHtml(v).trim()),
  seo_title: casillaTexto(70),
  seo_description: casillaTexto(160),
  status: z.enum(ESTADOS_PAGINA, { message: 'Elige el estado.' }),
});

export type DatosPagina = z.infer<typeof esquemaPagina>;

/** Lo que cambia la versión: estado, título y texto de la página. */
export type EstadoVersionable = { status: string; version: number; title: string; content_html: string };

/**
 * Versión que debe quedar guardada. Sube en 1 cuando la página queda publicada y (a) antes no lo estaba o
 * (b) cambió el título o el texto. Un borrador conserva su versión; crear una página ya publicada deja 1.
 */
export function calcularVersion(
  antes: EstadoVersionable | null,
  despues: { status: EstadoPagina; title: string; content_html: string },
): number {
  if (!antes) return 1;
  if (despues.status !== 'published') return antes.version;
  const cambia =
    antes.status !== 'published' || antes.title !== despues.title || antes.content_html !== despues.content_html;
  return cambia ? antes.version + 1 : antes.version;
}

/** Columnas de `pages` a escribir (sin `version`, que calcula el servidor). */
export function columnasPagina(d: DatosPagina) {
  return {
    country_code: d.country_code,
    kind: d.kind,
    slug: d.slug,
    title: d.title,
    content_html: d.content_html,
    seo_title: d.seo_title,
    seo_description: d.seo_description,
    status: d.status,
  };
}
