/**
 * Plantillas de WhatsApp en el panel (§13.2): esquema del formulario y validación con las reglas de
 * `@izao/whatsapp`. Lógica pura; el acceso a datos está en `plantillas-servidor.ts`. Solo servidor y pruebas
 * (importa el paquete, que trae `node:crypto`); el navegador usa `etiquetas.ts`.
 */
import { z } from 'zod';
import { validarPlantilla, type PlantillaWhatsApp } from '@izao/whatsapp';
import { mensajeProblema } from './etiquetas';

export const PAISES_PLANTILLA = ['CO', 'EC'] as const;
export type PaisPlantilla = (typeof PAISES_PLANTILLA)[number];

export { TOKEN_EJEMPLO, VALORES_EJEMPLO } from './etiquetas';

const textoOpcional = (max: number) =>
  z
    .string()
    .max(max, `Máximo ${max} caracteres.`)
    .transform((v) => v.trim())
    .transform((v) => (v === '' ? null : v));

const variablesDesdeTexto = z.string().transform((v, ctx) => {
  try {
    const parsed: unknown = JSON.parse(v || '{}');
    const r = z.record(z.string().max(40), z.string().max(60)).safeParse(parsed);
    if (r.success) return r.data;
  } catch {
    // cae al error de abajo
  }
  ctx.addIssue({ code: 'custom', message: 'El mapa de variables no es válido.' });
  return z.NEVER;
});

export const esquemaPlantilla = z.object({
  id: z.guid(),
  language: z.string().trim().min(2, 'Indica el idioma.').max(10),
  body_text: z.string().max(1500, 'El texto es demasiado largo.'),
  footer_text: textoOpcional(120),
  button_text: textoOpcional(60),
  button_url: textoOpcional(2100),
  variables_map: variablesDesdeTexto,
});
export type DatosPlantilla = z.infer<typeof esquemaPlantilla>;

export type FilaPlantilla = {
  id: string;
  key: string;
  country_code: PaisPlantilla;
  meta_template_name: string;
  meta_template_id: string | null;
  language: string;
  body_text: string;
  footer_text: string | null;
  button_text: string | null;
  button_url: string | null;
  variables_map: Record<string, string>;
  meta_status: string;
  meta_rejection_reason: string | null;
  version: number;
  is_active: boolean;
  updated_at: string;
};

export type Problema = { codigo: string; mensaje: string };

export type CamposEditables = Pick<
  FilaPlantilla,
  'key' | 'meta_template_name' | 'language' | 'body_text' | 'footer_text' | 'button_text' | 'button_url' | 'variables_map'
>;

export function aPlantillaWhatsApp(p: CamposEditables): PlantillaWhatsApp {
  return {
    key: p.key,
    meta_template_name: p.meta_template_name,
    language: p.language,
    body_text: p.body_text,
    footer_text: p.footer_text,
    button_text: p.button_text,
    button_url: p.button_url,
    variables_map: p.variables_map,
  };
}

/** Reglas de revisión de Meta y de Izao (`validarPlantilla`) con mensajes para la persona. */
export function validarCampos(p: CamposEditables): Problema[] {
  return validarPlantilla(aPlantillaWhatsApp(p)).map((x) => ({
    codigo: x.codigo,
    mensaje: mensajeProblema(x.codigo, x.detalle),
  }));
}
