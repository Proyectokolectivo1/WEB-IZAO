/**
 * Reseñas (§9.6, §24.1): filtros de la bandeja, reglas de moderación y validación de las reseñas que escribe el
 * administrador. Código puro compartido por Server Actions y pruebas. Regla 7: ninguna reseña publicada afirma
 * originalidad ni autenticidad; la bandeja avisa a quien modera y el formulario de admin lo impide.
 */
import { z } from 'zod';
import { afirmaOriginalidad } from '../pagos/ajustes';

export const ESTADOS_RESENA = ['pending', 'approved', 'rejected'] as const;
export type EstadoResena = (typeof ESTADOS_RESENA)[number];
export const ETIQUETA_ESTADO_RESENA: Record<EstadoResena, string> = {
  pending: 'Por revisar',
  approved: 'Aprobada',
  rejected: 'Rechazada',
};

export function esEstadoResena(v: unknown): v is EstadoResena {
  return typeof v === 'string' && (ESTADOS_RESENA as readonly string[]).includes(v);
}

export const FUENTES_RESENA = ['customer', 'admin'] as const;
export const ETIQUETA_FUENTE: Record<(typeof FUENTES_RESENA)[number], string> = { customer: 'Cliente', admin: 'Escrita por Izao' };

export type FiltrosResena = {
  pagina: number;
  /** Por defecto, las que esperan revisión. `todas` quita el filtro. */
  estado: EstadoResena | 'todas';
  pais: 'CO' | 'EC' | '';
  fuente: 'customer' | 'admin' | '';
  soloDestacadas: boolean;
};

type Buscables = Record<string, string | string[] | undefined>;
const primero = (v: string | string[] | undefined): string => ((Array.isArray(v) ? v[0] : v) ?? '').trim();

export function leerFiltrosResena(sp: Buscables): FiltrosResena {
  const estado = primero(sp.estado);
  const pais = primero(sp.pais).toUpperCase();
  const fuente = primero(sp.fuente);
  const n = Number.parseInt(primero(sp.page), 10);
  return {
    pagina: Number.isFinite(n) && n >= 1 && n <= 10000 ? n : 1,
    estado: estado === 'todas' ? 'todas' : esEstadoResena(estado) ? estado : 'pending',
    pais: pais === 'CO' || pais === 'EC' ? pais : '',
    fuente: fuente === 'customer' || fuente === 'admin' ? fuente : '',
    soloDestacadas: primero(sp.destacadas) === '1',
  };
}

export function parametrosDeFiltrosResena(f: FiltrosResena): Record<string, string> {
  const salida: Record<string, string> = { estado: f.estado };
  if (f.pais) salida.pais = f.pais;
  if (f.fuente) salida.fuente = f.fuente;
  if (f.soloDestacadas) salida.destacadas = '1';
  return salida;
}

/** ¿El texto de la reseña afirma originalidad o autenticidad? (se avisa a quien modera). */
export function resenaAfirmaOriginalidad(r: { body: string | null; author_name: string }): boolean {
  return afirmaOriginalidad(`${r.author_name} ${r.body ?? ''}`);
}

/** Una reseña solo puede estar en el home si está aprobada. */
export function destacadaValida(estado: EstadoResena, destacada: boolean): boolean {
  return !destacada || estado === 'approved';
}

/** Al rechazar o devolver a revisión, deja de estar destacada. */
export function destacadaTrasModerar(nuevoEstado: EstadoResena, destacadaActual: boolean): boolean {
  return nuevoEstado === 'approved' ? destacadaActual : false;
}

// ── Reseñas de Izao ──────────────────────────────────────────────────────────────────────────────

export type DatosResenaAdmin = {
  id: string | null;
  country_code: 'CO' | 'EC';
  /** URL del producto (slug) o `null` para una reseña de la tienda. */
  product_slug: string | null;
  author_name: string;
  city: string | null;
  rating: number;
  body: string;
  status: EstadoResena;
  featured_home: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const casilla = z.preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean());
const sinOriginalidad = (etiqueta: string) => (v: string | null) => v === null || !afirmaOriginalidad(v) || `${etiqueta}: no afirmes originalidad ni autenticidad.`;

export const esquemaResenaAdmin = z
  .object({
    id: z.string().trim().default('').refine((v) => v === '' || UUID.test(v), 'Identificador no válido.').transform((v) => (v === '' ? null : v)),
    country_code: z.enum(['CO', 'EC'], { message: 'Elige un país.' }),
    product_slug: z
      .string()
      .trim()
      .toLowerCase()
      .default('')
      .refine((v) => v === '' || /^[a-z0-9]+(-[a-z0-9]+)*$/.test(v), 'Usa solo la URL del producto, sin barras ni dominio.')
      .transform((v) => (v === '' ? null : v)),
    author_name: z.string().trim().min(2, 'Escribe el nombre.').max(60, 'Máximo 60 caracteres.'),
    city: z.string().trim().max(60, 'Máximo 60 caracteres.').default('').transform((v) => (v === '' ? null : v)),
    rating: z
      .string()
      .trim()
      .regex(/^[1-5]$/, 'Elige de 1 a 5 estrellas.')
      .transform(Number),
    body: z.string().trim().min(10, 'Escribe al menos 10 caracteres.').max(1000, 'Máximo 1000 caracteres.'),
    status: z.enum(ESTADOS_RESENA).default('approved'),
    featured_home: casilla,
  })
  .superRefine((d, ctx) => {
    for (const [campo, etiqueta] of [['author_name', 'El nombre'], ['city', 'La ciudad'], ['body', 'El texto']] as const) {
      const r = sinOriginalidad(etiqueta)(d[campo]);
      if (r !== true) ctx.addIssue({ code: 'custom', path: [campo], message: r });
    }
    if (!destacadaValida(d.status, d.featured_home)) {
      ctx.addIssue({ code: 'custom', path: ['featured_home'], message: 'Solo una reseña aprobada puede destacarse en el home.' });
    }
  }) as unknown as z.ZodType<DatosResenaAdmin, unknown>;
