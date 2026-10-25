/**
 * Home (§8.5, §24.1): orden y activación de las secciones por país, y el contenido propio de cada tipo (`config`).
 * Código puro compartido por las Server Actions, el formulario y las pruebas. La tienda lee `home_sections` y solo
 * entiende estas claves (ver `components/store/home/HomeSecciones.tsx`): título en todas; asesoría con texto y botón;
 * beneficios con ítems (ícono, título y texto). Las claves que el formulario no conoce se conservan al guardar.
 */
import { z } from 'zod';
import { afirmaOriginalidad } from '../pagos/ajustes';

export const TIPOS_SECCION = ['hero', 'categories', 'families', 'banner', 'collection_tabs', 'advice', 'benefits', 'reviews'] as const;
export type TipoSeccion = (typeof TIPOS_SECCION)[number];

export const ETIQUETA_TIPO: Record<TipoSeccion, string> = {
  hero: 'Carrusel principal',
  categories: 'Categorías con imagen',
  families: 'Aromas por familia olfativa',
  banner: 'Banner intermedio',
  collection_tabs: 'Colecciones en pestañas',
  advice: 'Bloque de asesoría',
  benefits: 'Beneficios',
  reviews: 'Reseñas de clientes',
};

/** De dónde sale el contenido de cada sección (para orientar a quien edita). */
export const ORIGEN_CONTENIDO: Record<TipoSeccion, string> = {
  hero: 'Banners del carrusel',
  categories: 'Categorías',
  families: 'Familias olfativas',
  banner: 'Banner intermedio',
  collection_tabs: 'Colecciones con «mostrar en el home»',
  advice: 'Texto de esta pantalla',
  benefits: 'Texto de esta pantalla',
  reviews: 'Reseñas aprobadas y destacadas',
};

/** Íconos que sabe dibujar la tienda (`@izao/ui`, `NombreIcono`). */
export const ICONOS_BENEFICIO = ['camion', 'caja', 'escudo', 'tarjeta', 'chat', 'reloj', 'check', 'estrella', 'gota', 'flor', 'hoja'] as const;
export const MAX_BENEFICIOS = 6;

export function esTipoSeccion(v: unknown): v is TipoSeccion {
  return typeof v === 'string' && (TIPOS_SECCION as readonly string[]).includes(v);
}

export type SeccionAdmin = {
  id: string;
  country_code: 'CO' | 'EC';
  type: TipoSeccion;
  config: Record<string, unknown>;
  sort_order: number;
  is_active: boolean;
};

// ── Orden ────────────────────────────────────────────────────────────────────────────────────────

const PASO = 10;

/**
 * Mueve una sección una posición y devuelve el orden renumerado (10, 20, 30…). Solo cambian las que cambian de
 * número. Si el id no existe o ya está en el borde, devuelve `null`.
 */
export function moverSeccion<T extends { id: string; sort_order: number }>(
  lista: readonly T[],
  id: string,
  sentido: 'arriba' | 'abajo',
): { id: string; sort_order: number }[] | null {
  const ordenada = [...lista].sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id));
  const i = ordenada.findIndex((s) => s.id === id);
  const j = sentido === 'arriba' ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= ordenada.length) return null;
  [ordenada[i], ordenada[j]] = [ordenada[j]!, ordenada[i]!];
  const nuevo = ordenada.map((s, k) => ({ id: s.id, sort_order: (k + 1) * PASO }));
  const antes = new Map(lista.map((s) => [s.id, s.sort_order]));
  return nuevo.filter((s) => antes.get(s.id) !== s.sort_order);
}

export function siguienteOrden(lista: readonly { sort_order: number }[]): number {
  return lista.reduce((m, s) => Math.max(m, s.sort_order), 0) + PASO;
}

// ── Contenido de una sección ─────────────────────────────────────────────────────────────────────

const casilla = z.preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean());
const vacioANull = (max: number, msg = `Máximo ${max} caracteres.`) =>
  z
    .string()
    .trim()
    .max(max, msg)
    .default('')
    .transform((v) => (v === '' ? null : v));

/** Solo rutas del sitio (`/co/...`) o enlaces https: nunca `javascript:` ni `//otro-dominio`. */
export function enlaceSeguro(v: string): boolean {
  if (v.startsWith('//') || v.startsWith('/\\')) return false;
  return v.startsWith('/') || /^https:\/\/[^\s]+$/i.test(v);
}

export type DatosSeccion = {
  id: string | null;
  type: TipoSeccion;
  is_active: boolean;
  title: string | null;
  body: string | null;
  cta_label: string | null;
  cta_url: string | null;
  beneficios: { icon: (typeof ICONOS_BENEFICIO)[number]; title: string; text: string | null }[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `benef_{n}_icon|title|text` del formulario → lista de beneficios (las filas sin título se descartan). */
export function beneficiosDeFormulario(obj: Record<string, unknown>): Record<string, unknown>[] {
  const salida: Record<string, unknown>[] = [];
  for (let n = 0; n < MAX_BENEFICIOS; n += 1) {
    const titulo = String(obj[`benef_${n}_title`] ?? '').trim();
    if (titulo === '') continue;
    salida.push({ icon: String(obj[`benef_${n}_icon`] ?? 'check'), title: titulo, text: String(obj[`benef_${n}_text`] ?? '').trim() });
  }
  return salida;
}

export const esquemaSeccion = z
  .object({
    id: z.string().trim().default('').refine((v) => v === '' || UUID.test(v), 'Identificador no válido.').transform((v) => (v === '' ? null : v)),
    type: z.enum(TIPOS_SECCION, { message: 'Elige un tipo de sección.' }),
    is_active: casilla,
    title: vacioANull(80),
    body: vacioANull(400),
    cta_label: vacioANull(40),
    cta_url: vacioANull(300).refine((v) => v === null || enlaceSeguro(v), 'Usa una ruta del sitio (/co/...) o un enlace https.'),
    beneficios: z
      .array(
        z.object({
          icon: z.enum(ICONOS_BENEFICIO),
          title: z.string().trim().min(1).max(60, 'Máximo 60 caracteres.'),
          text: z
            .string()
            .trim()
            .max(160, 'Máximo 160 caracteres.')
            .transform((v) => (v === '' ? null : v)),
        }),
      )
      .max(MAX_BENEFICIOS),
  })
  .superRefine((d, ctx) => {
    // Regla 7: ningún texto visible de la tienda afirma originalidad, autenticidad ni certificados.
    const textos: [string, string | null][] = [
      ['title', d.title],
      ['body', d.body],
      ['cta_label', d.cta_label],
      ...d.beneficios.flatMap((b, n): [string, string | null][] => [[`beneficios.${n}.title`, b.title], [`beneficios.${n}.text`, b.text]]),
    ];
    for (const [campo, texto] of textos) {
      if (texto !== null && afirmaOriginalidad(texto)) {
        ctx.addIssue({ code: 'custom', path: [campo], message: 'No afirmes originalidad, autenticidad ni certificados.' });
      }
    }
    if (d.type === 'benefits' && d.beneficios.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['benef_0_title'], message: 'Agrega al menos un beneficio.' });
    }
    if (d.type === 'advice' && d.cta_label !== null && d.cta_url === null) {
      ctx.addIssue({ code: 'custom', path: ['cta_url'], message: 'Si hay botón, indica a dónde lleva.' });
    }
  }) as unknown as z.ZodType<DatosSeccion, unknown>;

/** Entrada cruda del formulario → forma que valida `esquemaSeccion` (arma la lista de beneficios). */
export function entradaSeccion(formData: Record<string, unknown>): Record<string, unknown> {
  return { ...formData, beneficios: beneficiosDeFormulario(formData) };
}

/** `config` a guardar: lo previo con las claves de este tipo reemplazadas; las que no se conocen se conservan. */
export function configDeSeccion(previo: Record<string, unknown> | null, d: DatosSeccion): Record<string, unknown> {
  const salida: Record<string, unknown> = { ...(previo ?? {}) };
  const poner = (k: string, v: unknown) => {
    if (v === null || v === undefined) delete salida[k];
    else salida[k] = v;
  };
  poner('title', d.title);
  if (d.type === 'advice') {
    poner('body', d.body);
    poner('cta_label', d.cta_label);
    poner('cta_url', d.cta_url);
  }
  if (d.type === 'benefits') {
    salida.items = d.beneficios.map((b) => ({ icon: b.icon, title: b.title, ...(b.text ? { text: b.text } : {}) }));
  }
  return salida;
}

/** Lo que muestra el formulario a partir del `config` guardado. */
export function valoresDeConfig(config: Record<string, unknown>) {
  const t = (v: unknown) => (typeof v === 'string' ? v : '');
  const items = Array.isArray(config['items']) ? (config['items'] as Record<string, unknown>[]) : [];
  return {
    title: t(config['title']),
    body: t(config['body']),
    cta_label: t(config['cta_label']),
    cta_url: t(config['cta_url']),
    beneficios: items.slice(0, MAX_BENEFICIOS).map((it) => ({
      icon: (ICONOS_BENEFICIO as readonly string[]).includes(String(it['icon'])) ? String(it['icon']) : 'check',
      title: t(it['title']),
      text: t(it['text']),
    })),
  };
}
