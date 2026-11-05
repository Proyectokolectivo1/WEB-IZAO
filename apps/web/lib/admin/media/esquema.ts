import { z } from 'zod';

export const TIPOS_MEDIA = ['product', 'banner', 'site', 'category', 'review', 'warranty', 'expense'] as const;

/** Campos del formulario de subida. `alt` es obligatorio (accesibilidad y SEO). */
export const esquemaSubida = z.object({
  kind: z.enum(TIPOS_MEDIA),
  alt: z
    .string()
    .trim()
    .min(3, 'Describe la imagen en al menos 3 caracteres.')
    .max(200, 'El texto alternativo admite hasta 200 caracteres.'),
  /** Solo banners: cada variante se procesa por separado (escritorio 800/1600/2400, móvil 400/800/1200). */
  variante: z.preprocess((v) => (v === null || v === '' ? undefined : v), z.enum(['desktop', 'movil']).optional()),
  recorte45: z.preprocess((v) => v === 'true' || v === 'on' || v === true, z.boolean()),
});

export type DatosSubida = z.infer<typeof esquemaSubida>;
