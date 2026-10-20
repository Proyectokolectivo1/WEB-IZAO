/**
 * Colecciones y destacados (§6.2, §24.1). Las colecciones son por país; las
 * manuales llevan productos en orden y las de regla se calculan en la tienda.
 * Código puro compartido por servidor, cliente y pruebas.
 */
import { z } from 'zod';
import { PATRON_SLUG } from '../crud/comun';

export const REGLAS = ['badge', 'new_days', 'best_sellers_days', 'category_id'] as const;
export type TipoRegla = (typeof REGLAS)[number];

export const ETIQUETA_REGLA: Record<TipoRegla, string> = {
  badge: 'Productos con una insignia (ej. hot_sale)',
  new_days: 'Novedades de los últimos N días',
  best_sellers_days: 'Más vendidos de los últimos N días',
  category_id: 'Productos de una categoría',
};

/** Regla guardada en `collections.rule` (jsonb). Devuelve un mensaje si el valor no sirve. */
export function construirRegla(tipo: TipoRegla, valor: string): { regla: Record<string, unknown> } | { error: string } {
  const v = valor.trim();
  switch (tipo) {
    case 'badge':
      return /^[a-z0-9_]{2,40}$/.test(v)
        ? { regla: { badge: v } }
        : { error: 'La insignia usa minúsculas, números y guion bajo (ej. hot_sale).' };
    case 'new_days':
    case 'best_sellers_days': {
      const n = Number(v);
      return Number.isInteger(n) && n >= 1 && n <= 365
        ? { regla: { [tipo]: n } }
        : { error: 'Escribe un número de días entero entre 1 y 365.' };
    }
    case 'category_id':
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
        ? { regla: { category_id: v } }
        : { error: 'Elige una categoría.' };
  }
}

/** Separa una regla guardada en tipo y valor para rellenar el formulario. */
export function descomponerRegla(regla: unknown): { tipo: TipoRegla | ''; valor: string } {
  if (regla && typeof regla === 'object') {
    for (const t of REGLAS) {
      const v = (regla as Record<string, unknown>)[t];
      if (v !== undefined && v !== null) return { tipo: t, valor: String(v) };
    }
  }
  return { tipo: '', valor: '' };
}

const casilla = z.preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean());

export const esquemaColeccion = z
  .object({
    id: z.string().uuid().optional().or(z.literal('').transform(() => undefined)),
    country_code: z.enum(['CO', 'EC'], { message: 'Elige el país.' }),
    name: z.string().trim().min(2, 'Escribe al menos 2 caracteres.').max(80, 'Máximo 80 caracteres.'),
    slug: z
      .string()
      .trim()
      .min(2, 'El identificador de URL es obligatorio.')
      .max(120)
      .regex(PATRON_SLUG, 'Usa minúsculas, números y guiones (ej. hot-sale).'),
    type: z.enum(['manual', 'rule'], { message: 'Elige el tipo.' }),
    regla_tipo: z.enum(REGLAS).optional().or(z.literal('').transform(() => undefined)),
    regla_valor: z.string().trim().max(60).optional(),
    sort_order: z.coerce.number({ message: 'Debe ser un número.' }).int('Debe ser entero.').min(0).max(9999).default(0),
    show_in_home_tabs: casilla,
    is_active: casilla,
  })
  .superRefine((d, ctx) => {
    if (d.type !== 'rule') return;
    if (!d.regla_tipo) {
      ctx.addIssue({ code: 'custom', path: ['regla_tipo'], message: 'Elige la regla de la colección.' });
      return;
    }
    const r = construirRegla(d.regla_tipo, d.regla_valor ?? '');
    if ('error' in r) ctx.addIssue({ code: 'custom', path: ['regla_valor'], message: r.error });
  });

export type DatosColeccion = z.infer<typeof esquemaColeccion>;

export function columnasColeccion(d: DatosColeccion): Record<string, unknown> {
  let rule: Record<string, unknown> | null = null;
  if (d.type === 'rule' && d.regla_tipo) {
    const r = construirRegla(d.regla_tipo, d.regla_valor ?? '');
    rule = 'regla' in r ? r.regla : null;
  }
  return {
    country_code: d.country_code,
    name: d.name,
    slug: d.slug,
    type: d.type,
    rule,
    sort_order: d.sort_order,
    show_in_home_tabs: d.show_in_home_tabs,
    is_active: d.is_active,
  };
}

/** Mueve un elemento una posición; los bordes y los ausentes no cambian la lista. */
export function moverEnLista<T>(lista: readonly T[], elemento: T, direccion: 'arriba' | 'abajo'): T[] {
  const i = lista.indexOf(elemento);
  const j = direccion === 'arriba' ? i - 1 : i + 1;
  const copia = [...lista];
  if (i < 0 || j < 0 || j >= copia.length) return copia;
  [copia[i], copia[j]] = [copia[j]!, copia[i]!];
  return copia;
}

/** Posiciones consecutivas 1..n (el rango de `featured_rank` empieza en 1). */
export function renumerar<T>(lista: readonly T[]): { valor: T; posicion: number }[] {
  return lista.map((valor, i) => ({ valor, posicion: i + 1 }));
}
