/**
 * Esquemas de entrada del login y del MFA. Se usan en el servidor (Server
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
});

export const esquemaCodigoTotp = z.object({
  codigo: z
    .string({ error: 'Escribe el código de 6 dígitos.' })
    .trim()
    .regex(/^\d{6}$/, 'El código tiene 6 dígitos.'),
  factorId: z.uuid().optional(),
  siguiente: z.string().max(300).optional(),
});

export type EstadoFormulario = {
  error?: string;
  /** Errores por campo. */
  campos?: Partial<Record<'correo' | 'contrasena' | 'codigo', string>>;
};
