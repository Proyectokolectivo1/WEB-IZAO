/**
 * Textos y utilidades del módulo de plantillas de WhatsApp que también usa el navegador. No importa valores de
 * `@izao/whatsapp` (el paquete trae `node:crypto`): las constantes se repiten aquí y una prueba verifica que
 * coinciden con el paquete.
 */

export const CLAVES_PLANTILLA = ['cobro_abono', 'recordatorio_abono_1', 'recordatorio_abono_2', 'recordatorio_abono_final'] as const;
export type ClavePlantilla = (typeof CLAVES_PLANTILLA)[number];

export const ETIQUETA_CLAVE: Record<ClavePlantilla, string> = {
  cobro_abono: 'Cobro del abono',
  recordatorio_abono_1: 'Recordatorio del abono 1',
  recordatorio_abono_2: 'Recordatorio del abono 2',
  recordatorio_abono_final: 'Recordatorio final del abono',
};

export const ESTADOS_META = ['draft', 'pending', 'approved', 'rejected', 'paused'] as const;
export type EstadoMeta = (typeof ESTADOS_META)[number];

export const ETIQUETA_ESTADO_META: Record<EstadoMeta, string> = {
  draft: 'Borrador',
  pending: 'En revisión de Meta',
  approved: 'Aprobada',
  rejected: 'Rechazada',
  paused: 'Pausada',
};

/** Variables que el sistema sabe llenar al enviar (`VARIABLES_COBRO`). */
export const VARIABLES_PLANTILLA = {
  customer_first_name: 'Nombre del cliente',
  order_number: 'Número del pedido',
  cod_deposit_amount: 'Valor del abono',
  cod_collect_amount: 'Valor a pagar al recibir',
  pay_link_expires_at: 'Fecha y hora de vencimiento del link',
} as const;
export type VariablePlantilla = keyof typeof VARIABLES_PLANTILLA;

export const CLAVE_VARIABLE_BOTON = 'button_url_1';
export const VARIABLE_BOTON = 'pay_link_token';

const ETIQUETA_PROBLEMA: Record<string, string> = {
  LLAVES_INVALIDAS: 'El texto tiene llaves sueltas. Las variables se escriben {{1}}, {{2}}…',
  VARIABLES_NO_SECUENCIALES: 'Las variables deben aparecer en orden: {{1}}, {{2}}, {{3}}… sin saltos.',
  VARIABLE_EN_EXTREMO: 'Meta no acepta una variable al inicio ni al final del texto. Agrega palabras antes o después.',
  VARIABLE_SIN_MAPA: 'Falta elegir qué dato va en la variable {{%d}}.',
  VARIABLE_DESCONOCIDA: 'Hay una variable que el sistema no sabe llenar (%d).',
  CUERPO_VACIO: 'El texto del mensaje no puede estar vacío.',
  CUERPO_LARGO: 'El texto del mensaje supera los 1024 caracteres que permite Meta.',
  PIE_LARGO: 'El pie supera los 60 caracteres.',
  BOTON_LARGO: 'El texto del botón supera los 25 caracteres.',
  BOTON_INCOMPLETO: 'El botón necesita texto y enlace, o ninguno de los dos.',
  URL_BOTON_INVALIDA:
    'El enlace del botón debe ser https, terminar en una barra seguida de {{1}} (por ejemplo https://sitio.com/pagar/{{1}}).',
  NOMBRE_INVALIDO: 'El nombre en Meta solo admite minúsculas, números y guion bajo.',
  IDIOMA_INVALIDO: 'El idioma debe ser "es" o una variante como es_CO.',
  TEXTO_NO_PERMITIDO:
    'El texto usa una palabra que no está permitida (afirmaciones de originalidad o certificados, ni lenguaje promocional). Meta lo trataría como marketing.',
};

/** Mensaje para la persona de un problema devuelto por `validarPlantilla`. */
export function mensajeProblema(codigo: string, detalle?: string): string {
  const base = ETIQUETA_PROBLEMA[codigo] ?? `Problema de validación (${codigo}).`;
  return base.replace('%d', detalle ?? '?');
}

/** Posiciones `{{n}}` distintas del texto, en orden de aparición sin repetir. */
export function posicionesDelTexto(texto: string): number[] {
  const vistas: number[] = [];
  for (const m of texto.matchAll(/\{\{(\d+)\}\}/g)) {
    const n = Number(m[1]);
    if (!vistas.includes(n)) vistas.push(n);
  }
  return vistas;
}

/**
 * Normaliza el mapa: conserva solo las posiciones que el texto usa y agrega `button_url_1` cuando hay botón.
 * Así el mapa nunca queda con variables huérfanas que la validación rechazaría.
 */
export function normalizarMapa(
  mapa: Readonly<Record<string, string>>,
  hayBoton: boolean,
  posiciones: readonly number[],
): Record<string, string> {
  const salida: Record<string, string> = {};
  for (const n of posiciones) {
    const v = mapa[String(n)];
    if (v) salida[String(n)] = v;
  }
  if (hayBoton) salida[CLAVE_VARIABLE_BOTON] = VARIABLE_BOTON;
  return salida;
}

/** Valores de ejemplo que Meta pide al crear una plantilla y que usa la vista previa (no son datos de clientes). */
export const VALORES_EJEMPLO: Readonly<Record<VariablePlantilla, string>> = {
  customer_first_name: 'Camila',
  order_number: 'IZ-1001',
  cod_deposit_amount: '$ 20.000',
  cod_collect_amount: '$ 130.000',
  pay_link_expires_at: '15 de marzo, 6:00 p. m.',
};
export const TOKEN_EJEMPLO = 'ejemplo123';

/** Texto del mensaje con los valores de ejemplo, para la vista previa. */
export function textoDeEjemplo(cuerpo: string, mapa: Readonly<Record<string, string>>): string {
  return cuerpo.replace(/\{\{(\d+)\}\}/g, (todo, n: string) => {
    const v = mapa[n];
    return v && v in VALORES_EJEMPLO ? VALORES_EJEMPLO[v as VariablePlantilla] : todo;
  });
}
