/**
 * WhatsApp del asesor por país (botón flotante de la tienda, Iza y el pie). Validación pura: el número se guarda solo con
 * dígitos y con el código de país (`countries.phone_prefix`: CO `+57`, EC `+593`); el mensaje inicial es texto libre sin
 * afirmar originalidad (regla 7). Sin servidor: la lectura y la escritura están en `whatsapp-asesor-servidor.ts`.
 */
import { z } from 'zod';
import { afirmaOriginalidad } from './ajustes';

/** Largo máximo del mensaje prellenado (coincide con el check de la base). */
export const MAX_MENSAJE_WHATSAPP = 300;

/** Largo del número nacional (sin el código de país) que se acepta. */
const NACIONAL_MIN = 7;
const NACIONAL_MAX = 10;

export type ResultadoNumero = { ok: true; valor: string } | { ok: false; mensaje: string };

/**
 * Lleva lo que escribió la persona a «solo dígitos con código de país». Acepta `+57 300 123 4567`, `(300) 123-4567`,
 * `573001234567`, `0057…` y el número nacional sin código (se le antepone `prefijo`, p. ej. `+57`); el cero de marcación
 * nacional de Ecuador (`099…`) se quita. Rechaza letras y números que no entran en un rango razonable.
 */
export function normalizarWhatsapp(entrada: string, prefijo: string): ResultadoNumero {
  const texto = entrada.trim();
  const codigo = prefijo.replace(/\D/g, '');
  if (codigo === '') return { ok: false, mensaje: 'Este país no tiene un código telefónico configurado.' };
  if (!/^[+\d\s().-]+$/.test(texto) || !/\d/.test(texto)) {
    return { ok: false, mensaje: 'Escribe solo números, con el código del país (p. ej. +57 300 123 4567).' };
  }
  let d = texto.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (!(d.startsWith(codigo) && d.length - codigo.length >= NACIONAL_MIN)) {
    // Número nacional: se quita el cero de marcación y se antepone el código.
    const nacional = d.replace(/^0+/, '');
    if (nacional.length < NACIONAL_MIN || nacional.length > NACIONAL_MAX) {
      return { ok: false, mensaje: `El número debe empezar con +${codigo} y tener entre ${NACIONAL_MIN} y ${NACIONAL_MAX} dígitos después del código.` };
    }
    d = `${codigo}${nacional}`;
  }
  const nacionalFinal = d.length - codigo.length;
  if (nacionalFinal < NACIONAL_MIN || nacionalFinal > NACIONAL_MAX) {
    return { ok: false, mensaje: `Después de +${codigo} van entre ${NACIONAL_MIN} y ${NACIONAL_MAX} dígitos. Revisa el número.` };
  }
  return { ok: true, valor: d };
}

/** Campos del formulario «WhatsApp del asesor»; todo llega como texto. */
export const esquemaWhatsappAsesor = z
  .object({
    advisor_whatsapp: z.string().trim().max(40, 'Máximo 40 caracteres.').default(''),
    advisor_whatsapp_message: z.string().trim().max(MAX_MENSAJE_WHATSAPP, `Máximo ${MAX_MENSAJE_WHATSAPP} caracteres.`).default(''),
    advisor_whatsapp_button_enabled: z.string().optional(),
  })
  .superRefine((d, ctx) => {
    if (afirmaOriginalidad(d.advisor_whatsapp_message)) {
      ctx.addIssue({
        code: 'custom',
        path: ['advisor_whatsapp_message'],
        message: 'Ese texto afirma originalidad o certificados; no está permitido.',
      });
    }
    // eslint-disable-next-line no-control-regex -- se rechazan los caracteres de control del mensaje
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(d.advisor_whatsapp_message)) {
      ctx.addIssue({ code: 'custom', path: ['advisor_whatsapp_message'], message: 'El mensaje tiene caracteres no permitidos.' });
    }
  })
  .transform((d) => ({
    /** Texto tal cual lo escribió la persona; se normaliza en el servidor con el prefijo del país. `''` = sin número. */
    numero: d.advisor_whatsapp,
    /** `null` = usar el texto por defecto de la tienda. */
    mensaje: d.advisor_whatsapp_message === '' ? null : d.advisor_whatsapp_message,
    activo: d.advisor_whatsapp_button_enabled === 'on',
  }));

export type DatosWhatsappAsesor = z.output<typeof esquemaWhatsappAsesor>;

/** Valores del formulario del panel, como texto. */
export type FormularioWhatsappAsesor = {
  advisor_whatsapp: string;
  advisor_whatsapp_message: string;
  advisor_whatsapp_button_enabled: boolean;
  /** `countries.phone_prefix` (solo lectura, para la ayuda del campo). */
  prefijo: string;
  updated_at: string | null;
};
