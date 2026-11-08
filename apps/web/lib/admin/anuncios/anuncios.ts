/**
 * Cinta superior de la tienda (barra de anuncios, §9.2): frases por país, en orden, que se activan o desactivan, con enlace
 * opcional, y los segundos que dura cada una. Código puro compartido por las Server Actions, el formulario y las pruebas.
 * Tablas existentes: `announcements` (frases) y `country_settings.announcement_rotation_seconds` (rotación).
 */
import { z } from 'zod';
import { afirmaOriginalidad } from '../pagos/ajustes';
import { apuntaAOtroPais, esUrlDestinoValida, NOMBRE_PAIS_BANNER } from '../banners/banners';

export const MAX_FRASE = 120;
/** Rotación: la barra no baja de 2 s (se leería a medias) ni pasa de 30 s (parecería quieta). */
export const ROTACION_SEGUNDOS = { minimo: 2, maximo: 30 } as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const casilla = z.preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean());

export const esquemaAnuncio = z
  .object({
    id: z
      .string()
      .trim()
      .default('')
      .refine((v) => v === '' || UUID.test(v), 'Identificador no válido.')
      .transform((v) => (v === '' ? null : v)),
    country_code: z.enum(['CO', 'EC'], { message: 'Elige el país.' }),
    text: z.string().trim().min(3, 'Escribe la frase (mínimo 3 caracteres).').max(MAX_FRASE, `Máximo ${MAX_FRASE} caracteres.`),
    link_url: z
      .string()
      .trim()
      .default('')
      .transform((v) => (v === '' ? null : v)),
    is_active: casilla,
  })
  .superRefine((d, ctx) => {
    // Regla 7: ningún texto visible afirma originalidad, autenticidad ni certificados.
    if (afirmaOriginalidad(d.text)) {
      ctx.addIssue({ code: 'custom', path: ['text'], message: 'No afirmes originalidad, autenticidad ni certificados.' });
    }
    if (d.link_url !== null) {
      if (d.link_url.startsWith('/') && apuntaAOtroPais(d.link_url, d.country_code)) {
        ctx.addIssue({
          code: 'custom',
          path: ['link_url'],
          message: `Esta frase es de ${NOMBRE_PAIS_BANNER[d.country_code]}: no puede llevar a una página de otro país.`,
        });
      } else if (!esUrlDestinoValida(d.link_url, d.country_code)) {
        ctx.addIssue({ code: 'custom', path: ['link_url'], message: 'Usa una ruta que empiece por / (por ejemplo /co/catalogo) o una dirección https://.' });
      }
    }
  });
export type DatosAnuncio = z.infer<typeof esquemaAnuncio>;

export const esquemaRotacion = z.object({
  country_code: z.enum(['CO', 'EC'], { message: 'Elige el país.' }),
  seconds: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() !== '' ? Number(v.replace(',', '.')) : v),
    z
      .number({ message: 'Escribe los segundos de cada frase.' })
      .int('Usa un número entero de segundos.')
      .min(ROTACION_SEGUNDOS.minimo, `Mínimo ${ROTACION_SEGUNDOS.minimo} segundos.`)
      .max(ROTACION_SEGUNDOS.maximo, `Máximo ${ROTACION_SEGUNDOS.maximo} segundos.`),
  ),
});
export type DatosRotacion = z.infer<typeof esquemaRotacion>;
