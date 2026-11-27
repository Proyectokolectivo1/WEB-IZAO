/**
 * Datos que viajan al modelo desde la base (descripciones, políticas, nombres de métodos de pago…): son DATOS, nunca
 * instrucciones. Dos defensas contra la inyección indirecta (un texto de producto o de política que «le habla» al asistente):
 *  1. `limpiarDato` / `limpiarTextoLargo`: quitan caracteres invisibles y etiquetas, recortan, y OMITEN la frase que intenta
 *     manipular al asistente (se avisa con `alertas` para registrarlo en el panel).
 *  2. `envolverResultado`: el resultado de cada herramienta entra al modelo dentro de `<datos_herramienta>` con `<` y `>`
 *     escapados, así que ningún texto de la base puede cerrar la etiqueta ni abrir una falsa de sistema.
 * Código puro.
 */
import { detectarManipulacion, sanearEntrada } from './entrada-segura';

export const MAX_RESULTADO_HERRAMIENTA = 5000;

/** Fuente de avisos de inyección indirecta mientras se arma un resultado. */
export type Alertas = string[];

const sinEtiquetas = (t: string) => t.replace(/<[^>]*>/g, ' ').replace(/[<>]/g, ' ');

/** Un valor corto de la base (nombre, nota, descripción). Cadena vacía si es nulo, vacío o intenta manipular. */
export function limpiarDato(valor: string | null | undefined, max: number, alertas?: Alertas): string {
  if (!valor) return '';
  const t = sinEtiquetas(sanearEntrada(valor).texto).replace(/\s+/g, ' ').trim().slice(0, max);
  if (!t) return '';
  if (detectarManipulacion(t)) {
    alertas?.push('inyeccion_indirecta');
    return '';
  }
  return t;
}

/** Un texto largo (política): se revisa por oraciones y solo se omiten las que intentan manipular. */
export function limpiarTextoLargo(valor: string | null | undefined, max: number, alertas?: Alertas): string {
  if (!valor) return '';
  const base = sinEtiquetas(sanearEntrada(valor).texto);
  const partes = base.split(/(?<=[.!?…])\s+|\n+/);
  const buenas: string[] = [];
  for (const p of partes) {
    const o = p.replace(/\s+/g, ' ').trim();
    if (!o) continue;
    if (detectarManipulacion(o)) {
      alertas?.push('inyeccion_indirecta');
      continue;
    }
    buenas.push(o);
  }
  return buenas.join('\n').slice(0, max);
}

/** Lista de textos cortos sin vacíos. */
export function limpiarLista(valores: readonly (string | null | undefined)[] | null | undefined, maxCada: number, maxItems: number, alertas?: Alertas): string[] {
  return (valores ?? [])
    .slice(0, maxItems)
    .map((v) => limpiarDato(v, maxCada, alertas))
    .filter(Boolean);
}

/** Resultado de herramienta listo para el modelo: JSON con `<`/`>` escapados dentro de una etiqueta de datos. */
export function envolverResultado(nombre: string, resultado: unknown): string {
  const seguro = /^[a-z_]{1,40}$/.test(nombre) ? nombre : 'desconocida';
  const json = (JSON.stringify(resultado) ?? 'null').replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
  const cuerpo = json.length > MAX_RESULTADO_HERRAMIENTA ? `${json.slice(0, MAX_RESULTADO_HERRAMIENTA)}…(recortado)` : json;
  return `<datos_herramienta nombre="${seguro}">${cuerpo}</datos_herramienta>`;
}
