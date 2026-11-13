/**
 * Esquemas de entrada del login. Se usan en el servidor (Server
 * Actions) y pueden importarse en el cliente para validar antes de enviar.
 */
import { z } from 'zod';

export const esquemaLogin = z.object({
  correo: z
    .string({ error: 'Escribe tu correo.' })
    .trim()
    .toLowerCase()
    .min(1, 'Escribe tu correo.')
    .max(254, 'El correo es demasiado largo.')
    .pipe(z.email('Escribe un correo válido.')),
  contrasena: z
    .string({ error: 'Escribe tu contraseña.' })
    .min(1, 'Escribe tu contraseña.')
    .max(200, 'La contraseña es demasiado larga.'),
  siguiente: z.string().max(300).optional(),
  /** Token de Turnstile; vacío si el CAPTCHA está apagado o el widget aún no responde. */
  captchaToken: z.string().max(2048).optional(),
});

export type EstadoFormulario = {
  error?: string;
  /** Errores por campo. */
  campos?: Partial<Record<'correo' | 'contrasena', string>>;
};
