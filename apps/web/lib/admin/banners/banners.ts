/**
 * Banners (§9.1, §24.1): carrusel superior del home (`hero`), banner intermedio (`mid`) y banner de categoría
 * (`category`), cada uno por país. Código puro compartido por las Server Actions, el formulario y las pruebas.
 *
 * Destino del clic. El esquema actual solo tiene `link_url`, así que el destino estructurado (producto, variante,
 * categoría o URL) se guarda como una ruta interna ya resuelta (`/co/perfume/{slug}?variante={sku}`) y se reconstruye
 * al editar con `destinoDeUrl`. Cuando izao-db agregue `link_type/link_product_id/link_variant_id/link_category_id`
 * solo cambian `columnasBanner` y `destinoDeFila`; el formulario y la tienda no.
 */
import { z } from 'zod';
import { nulaSiVacio } from '../crud/comun';

export const UBICACIONES = ['hero', 'mid', 'category'] as const;
export type Ubicacion = (typeof UBICACIONES)[number];

export const ETIQUETA_UBICACION: Record<Ubicacion, string> = {
  hero: 'Carrusel del home',
  mid: 'Banner intermedio',
  category: 'Banner de categoría',
};

export const AYUDA_UBICACION: Record<Ubicacion, string> = {
  hero: 'Se muestra arriba del home, en carrusel. Recomendado: escritorio 1920×800 y móvil 1080×1350.',
  mid: 'Banner de descuento entre las secciones del home. Recomendado: escritorio 1920×600 y móvil 1080×1080.',
  category: 'Cabecera de la página de una categoría. Recomendado: escritorio 1920×500 y móvil 1080×900.',
};

export const POSICIONES_TEXTO = ['left', 'center', 'right'] as const;
export const ETIQUETA_POSICION: Record<(typeof POSICIONES_TEXTO)[number], string> = {
  left: 'Izquierda',
  center: 'Centro',
  right: 'Derecha',
};

export type PaisBanner = 'CO' | 'EC';
export const NOMBRE_PAIS_BANNER: Record<PaisBanner, string> = { CO: 'Colombia', EC: 'Ecuador' };

export function esUbicacion(v: unknown): v is Ubicacion {
  return typeof v === 'string' && (UBICACIONES as readonly string[]).includes(v);
}

export function leerUbicacion(v: string | string[] | undefined): Ubicacion {
  const x = Array.isArray(v) ? v[0] : v;
  return esUbicacion(x) ? x : 'hero';
}

// ── Destino ──────────────────────────────────────────────────────────────────────────────────────

export const TIPOS_DESTINO = ['ninguno', 'producto', 'categoria', 'url'] as const;
export type TipoDestino = (typeof TIPOS_DESTINO)[number];

export const ETIQUETA_DESTINO: Record<TipoDestino, string> = {
  ninguno: 'Sin enlace',
  producto: 'Un producto (lleva a su ficha para comprar)',
  categoria: 'Una categoría',
  url: 'Otra página o dirección web',
};

export type Destino =
  | { tipo: 'ninguno' }
  | { tipo: 'producto'; slug: string; sku: string | null }
  | { tipo: 'categoria'; slug: string }
  | { tipo: 'url'; url: string };

const PRODUCTO = /^\/(co|ec)\/perfume\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\?variante=([A-Za-z0-9][A-Za-z0-9._-]{0,63}))?$/;
const CATEGORIA = /^\/(co|ec)\/categoria\/([a-z0-9]+(?:-[a-z0-9]+)*)$/;

/** Ruta interna que debe seguir la tienda. Es lo que se guarda en `banners.link_url`. */
export function urlDeDestino(destino: Destino, pais: PaisBanner): string | null {
  const p = pais.toLowerCase();
  switch (destino.tipo) {
    case 'ninguno':
      return null;
    case 'producto':
      return `/${p}/perfume/${destino.slug}${destino.sku ? `?variante=${encodeURIComponent(destino.sku)}` : ''}`;
    case 'categoria':
      return `/${p}/categoria/${destino.slug}`;
    case 'url':
      return destino.url;
  }
}

/** Inversa de `urlDeDestino`: reconoce producto y categoría; cualquier otra cosa es una URL libre. */
export function destinoDeUrl(url: string | null | undefined): Destino {
  const u = (url ?? '').trim();
  if (u === '') return { tipo: 'ninguno' };
  const prod = PRODUCTO.exec(u);
  if (prod) return { tipo: 'producto', slug: prod[2]!, sku: prod[3] ?? null };
  const cat = CATEGORIA.exec(u);
  if (cat) return { tipo: 'categoria', slug: cat[2]! };
  return { tipo: 'url', url: u };
}

/** `/ec/...` dentro de un banner de Colombia (o al revés): lo comercial es por país, no se cruza. */
export function apuntaAOtroPais(url: string, pais: PaisBanner): boolean {
  const m = /^\/(co|ec)(?=[/?#]|$)/i.exec(url);
  return m !== null && m[1]!.toUpperCase() !== pais;
}

/**
 * Una URL libre debe ser una ruta interna (`/co/pagina/envios`) o una dirección https. Se rechazan `javascript:`,
 * `//host`, barras invertidas y caracteres de control.
 */
export function esUrlDestinoValida(url: string, pais?: PaisBanner): boolean {
  if (url.length === 0 || url.length > 500) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\s\\]/.test(url)) return false;
  if (url.startsWith('/')) return !url.startsWith('//') && !(pais && apuntaAOtroPais(url, pais));
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname.includes('.');
  } catch {
    return false;
  }
}

// ── Fechas (America/Bogota; Ecuador continental usa el mismo UTC-5 fijo) ──────────────────────────

/** `2026-11-05T14:30` (hora de Colombia) → ISO UTC. `null` si está vacío o es inválido. */
export function fechaLocalAIso(v: string | null | undefined): string | null {
  const t = (v ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(t)) return null;
  const d = new Date(`${t}:00-05:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** ISO UTC → `2026-11-05T14:30` en hora de Colombia, para el campo `datetime-local`. */
export function isoAFechaLocal(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Date(d.getTime() - 5 * 3600_000).toISOString().slice(0, 16);
}

export type EstadoVigencia = 'vigente' | 'programado' | 'vencido' | 'inactivo';

export const ETIQUETA_VIGENCIA: Record<EstadoVigencia, string> = {
  vigente: 'Visible',
  programado: 'Programado',
  vencido: 'Vencido',
  inactivo: 'Desactivado',
};

/** Lo que verá el público ahora: activo y dentro de su ventana de fechas. */
export function estadoVigencia(
  b: { is_active: boolean; starts_at: string | null; ends_at: string | null },
  ahora: Date = new Date(),
): EstadoVigencia {
  if (!b.is_active) return 'inactivo';
  if (b.starts_at && new Date(b.starts_at) > ahora) return 'programado';
  if (b.ends_at && new Date(b.ends_at) <= ahora) return 'vencido';
  return 'vigente';
}

// ── Formulario ───────────────────────────────────────────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

const texto = (max: number, mensaje: string) =>
  z
    .string()
    .trim()
    .max(max, mensaje)
    .default('')
    .transform((v) => nulaSiVacio(v));
const uuidOpcional = z
  .string()
  .trim()
  .default('')
  .refine((v) => v === '' || UUID.test(v), 'Identificador no válido.')
  .transform((v) => (v === '' ? null : v));
const casilla = z.preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean());

export const esquemaBanner = z
  .object({
    id: uuidOpcional,
    country_code: z.enum(['CO', 'EC'], { message: 'Elige el país.' }),
    placement: z.enum(UBICACIONES, { message: 'Elige dónde se muestra.' }),
    category_id: uuidOpcional,
    desktop_media_id: z.string().trim().regex(UUID, 'Sube la imagen de escritorio.'),
    mobile_media_id: z.string().trim().regex(UUID, 'Sube la imagen móvil.'),
    alt: z.string().trim().min(3, 'Describe el banner en al menos 3 caracteres.').max(200, 'Máximo 200 caracteres.'),
    title: texto(120, 'Máximo 120 caracteres.'),
    subtitle: texto(200, 'Máximo 200 caracteres.'),
    cta_label: texto(40, 'Máximo 40 caracteres.'),
    text_position: z.enum(POSICIONES_TEXTO).default('left'),
    text_color: z
      .string()
      .trim()
      .default('')
      .refine((v) => v === '' || HEX.test(v), 'Usa un color como #382E2B.')
      .transform((v) => (v === '' ? null : v.toUpperCase())),
    starts_at: z.string().trim().default(''),
    ends_at: z.string().trim().default(''),
    is_active: casilla,
    destino_tipo: z.enum(TIPOS_DESTINO).default('ninguno'),
    destino_producto_id: uuidOpcional,
    destino_variante_id: uuidOpcional,
    destino_categoria_id: uuidOpcional,
    destino_url: z.string().trim().default(''),
  })
  .superRefine((d, ctx) => {
    if (d.placement === 'category' && !d.category_id) {
      ctx.addIssue({ code: 'custom', path: ['category_id'], message: 'Elige la categoría de este banner.' });
    }
    if (d.starts_at !== '' && fechaLocalAIso(d.starts_at) === null) {
      ctx.addIssue({ code: 'custom', path: ['starts_at'], message: 'Fecha de inicio no válida.' });
    }
    if (d.ends_at !== '' && fechaLocalAIso(d.ends_at) === null) {
      ctx.addIssue({ code: 'custom', path: ['ends_at'], message: 'Fecha de fin no válida.' });
    }
    const ini = fechaLocalAIso(d.starts_at);
    const fin = fechaLocalAIso(d.ends_at);
    if (ini && fin && new Date(fin) <= new Date(ini)) {
      ctx.addIssue({ code: 'custom', path: ['ends_at'], message: 'El fin debe ser posterior al inicio.' });
    }
    if (d.destino_tipo === 'producto' && !d.destino_producto_id) {
      ctx.addIssue({ code: 'custom', path: ['destino_producto_id'], message: 'Elige el producto al que lleva el banner.' });
    }
    if (d.destino_tipo === 'categoria' && !d.destino_categoria_id) {
      ctx.addIssue({ code: 'custom', path: ['destino_categoria_id'], message: 'Elige la categoría a la que lleva el banner.' });
    }
    if (d.destino_tipo === 'url' && d.destino_url.startsWith('/') && apuntaAOtroPais(d.destino_url, d.country_code)) {
      ctx.addIssue({
        code: 'custom',
        path: ['destino_url'],
        message: `Este banner es de ${NOMBRE_PAIS_BANNER[d.country_code]}: no puede llevar a una página de otro país.`,
      });
    } else if (d.destino_tipo === 'url' && !esUrlDestinoValida(d.destino_url, d.country_code)) {
      ctx.addIssue({
        code: 'custom',
        path: ['destino_url'],
        message: 'Usa una ruta interna que empiece por / (por ejemplo /co/catalogo) o una dirección https://.',
      });
    }
    if (d.cta_label && d.destino_tipo === 'ninguno') {
      ctx.addIssue({ code: 'custom', path: ['destino_tipo'], message: 'El botón necesita un destino: elige adónde lleva.' });
    }
  });

export type DatosBanner = z.infer<typeof esquemaBanner>;

/** Columnas de `banners` a partir del formulario y la URL de destino ya resuelta por el servidor. */
export function columnasBanner(d: DatosBanner, linkUrl: string | null): Record<string, unknown> {
  return {
    country_code: d.country_code,
    placement: d.placement,
    category_id: d.placement === 'category' ? d.category_id : null,
    desktop_media_id: d.desktop_media_id,
    mobile_media_id: d.mobile_media_id,
    alt: d.alt,
    title: d.title,
    subtitle: d.subtitle,
    cta_label: d.cta_label,
    link_url: linkUrl,
    text_position: d.text_position,
    text_color: d.text_color,
    starts_at: fechaLocalAIso(d.starts_at),
    ends_at: fechaLocalAIso(d.ends_at),
    is_active: d.is_active,
  };
}
