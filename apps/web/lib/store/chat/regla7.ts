/**
 * Regla 7 en la salida del modelo (§20.3): ningún texto afirma originalidad, autenticidad, certificados, réplicas ni relación
 * con marcas. El prompt lo pide, pero un modelo puede fallar o ser empujado; este filtro es DETERMINISTA y se aplica a lo que
 * se manda a la persona, en streaming y por oraciones: la oración que menciona alguno de esos temas se reemplaza por el
 * mensaje de asesor (una sola vez por respuesta) y el turno ofrece `contactar_asesor`. Es deliberadamente conservador: prefiere
 * derivar a un asesor de más que dejar pasar una afirmación. Código puro.
 */

export const MENSAJE_DERIVAR_ASESOR = 'Sobre eso prefiero que un asesor te dé todos los detalles. Puedes escribirle por WhatsApp con el botón de abajo.';

const sinTildes = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Se prueba sobre el texto sin tildes y en minúsculas. */
const PATRON =
  /\b(original(es|idad|mente)?|autentic[oa]s?|autenticidad|certificad[oa]s?|certificacion(es)?|replicas?|imitacion(es)?|genuin[oa]s?|falsific\w*|pirata\w*|clon(es)?|afiliad[oa]s?|licenciad[oa]s?|licencia oficial|(distribuidor|revendedor|representante|aliado|socio|proveedor|importador)(es)? (oficial(es)?|autorizad[oa]s?|directo)|(oficial(es)?|autorizad[oa]s?) de (la )?marca|marca registrada|(100|cien)\s?%?\s?(real|puro)|de (la )?casa (original|oficial))\b/;

export function violaReglaSiete(oracion: string): boolean {
  return PATRON.test(sinTildes(oracion));
}

/** Fin de oración: punto, cierre de interrogación/exclamación o salto de línea (no los puntos de decimales ni «1.5»). */
const FIN_ORACION = /[.!?…]+(?=\s|$)|\n/;

export class FiltroReglaSiete {
  private buffer = '';
  private derivado = false;
  /** `true` si en esta respuesta se reemplazó alguna oración. */
  huboReemplazo = false;

  private procesar(oracion: string): string {
    if (!violaReglaSiete(oracion)) return oracion;
    this.huboReemplazo = true;
    if (this.derivado) return '';
    this.derivado = true;
    // Conserva el espacio inicial para no pegar el aviso a la oración anterior.
    return (/^\s/.test(oracion) ? ' ' : '') + MENSAJE_DERIVAR_ASESOR;
  }

  /** Devuelve lo ya revisado y seguro de mostrar; lo que no cerró su oración queda retenido. */
  empujar(delta: string): string {
    this.buffer += delta;
    let salida = '';
    for (;;) {
      const m = FIN_ORACION.exec(this.buffer);
      if (!m) break;
      const fin = m.index + m[0].length;
      salida += this.procesar(this.buffer.slice(0, fin));
      this.buffer = this.buffer.slice(fin);
    }
    return salida;
  }

  /** Fin de la respuesta: se revisa lo que quedó sin punto final. */
  cerrar(): string {
    const resto = this.buffer;
    this.buffer = '';
    return resto ? this.procesar(resto) : '';
  }
}
