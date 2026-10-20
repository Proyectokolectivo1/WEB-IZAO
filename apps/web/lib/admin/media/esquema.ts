import { z } from 'zod';

export const TIPOS_MEDIA = ['product', 'banner', 'site', 'category', 'review', 'warranty'] as const;

/** Campos del formulario de subida. `alt` es obligatorio (accesibilidad y SEO). */
export const esquemaSubida = z.object({
  kind: z.enum(TIPOS_MEDIA),
  alt: z
    .string()
    .trim()
    .min(3, 'Describe la imagen en al menos 3 caracteres.')
    .max(200, 'El texto alternativo admite hasta 200 caracteres.'),
  recorte45: z.preprocess((v) => v === 'true' || v === 'on' || v === true, z.boolean()),
});

export type DatosSubida = z.infer<typeof esquemaSubida>;
