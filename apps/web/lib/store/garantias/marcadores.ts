/**
 * Marcadores de plantilla en los textos de garantías.
 *
 * El texto base del seed trae `[30]` (días de garantía tras la entrega) y `[5]` (días hábiles de respuesta) y `[URL]`
 * entre corchetes; eran los valores de ejemplo de la plantilla. En la página pública cada uno se reemplaza por el valor
 * configurado en /admin/garantias (`period_days`, `response_days`) y nunca llega un corchete al cliente:
 * - `[30]` y `[5]` (los números de la plantilla) → días del plazo y de la respuesta del país.
 * - cualquier otro número entre corchetes (el dueño ya escribió su valor) → el número sin corchetes.
 * - `[URL]` → la ruta del formulario de garantías del país.
 * - cualquier otro marcador en mayúsculas (`[COMPLETAR]`…) → se quita; el texto sigue leyéndose con naturalidad.
 */
export const PLAZO_PLANTILLA = 30;
export const RESPUESTA_PLANTILLA = 5;

export interface ValoresMarcadores {
  diasPlazo: number;
  diasRespuesta: number;
  /** Ruta del formulario del país, p. ej. `/co/garantias`. */
  rutaFormulario: string;
}

export function resolverMarcadoresGarantia(html: string, v: ValoresMarcadores): string {
  return html
    .replace(/\[(\d{1,3})\]/g, (_t, n: string) => {
      const num = Number(n);
      if (num === PLAZO_PLANTILLA) return String(v.diasPlazo);
      if (num === RESPUESTA_PLANTILLA) return String(v.diasRespuesta);
      return String(num);
    })
    .replace(/\[URL\]/g, v.rutaFormulario)
    .replace(/[ \t]*\[[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ0-9 _-]{1,40}\]/g, '');
}
