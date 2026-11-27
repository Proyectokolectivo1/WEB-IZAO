/**
 * Filtro de salida de Iza: lo último que ocurre antes de que el texto llegue a la persona. Determinista, por oraciones y
 * en streaming (una oración se retiene hasta cerrar). Tres capas, de la más grave a la menos:
 *  1. Fuga: copia del prompt de sistema (ventanas de palabras y marca interna), secretos, nombres de sistemas internos,
 *     costos/márgenes/proveedores y URLs que no son de la tienda → mensaje fijo de rechazo.
 *  2. Regla 7: originalidad, autenticidad, certificados o relación con marcas → derivar al asesor.
 *  3. Cifras: precios, descuentos, plazos, existencias, «gratis» o códigos que no salieron de las herramientas de este
 *     turno (ver `cifras.ts`) → «ese dato no lo tengo confirmado».
 * Cada mensaje de reemplazo sale una sola vez por respuesta; las demás oraciones afectadas se omiten.
 */
import { cifraNoRespaldada, type DatosPermitidos, type MotivoCifra } from './cifras';
import { FIN_ORACION, MENSAJE_DERIVAR_ASESOR, violaReglaSiete } from './regla7';

export const MENSAJE_SIN_DATO = 'Ese dato exacto no lo tengo confirmado en este momento. Puedes verlo en la ficha del producto o un asesor te lo confirma por WhatsApp.';
export const MENSAJE_CATALOGO = 'Para recorrer todo el catálogo te invito a explorar la tienda; yo te recomiendo dos o tres opciones a la vez. Cuéntame para quién es el perfume o qué aromas te gustan y te muestro lo mejor.';
export const MENSAJE_RECHAZO = 'Con gusto te ayudo con tus fragancias, pero de ese tema no puedo hablar. ¿Te cuento de aromas, precios o envíos?';

export type MotivoSalida = 'fuga_prompt' | 'secreto' | 'interno' | 'costos' | 'url' | 'regla7' | `cifra_${MotivoCifra}`;

const sinTildes = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const palabras = (t: string) =>
  sinTildes(t)
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

const VENTANA = 8;

const RE_SECRETO = [
  /\bsk-[a-z0-9_-]{16,}/i,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}/i,
  /\b(?=[A-Za-z0-9]*\d)(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{32,}\b/,
];
const RE_INTERNO =
  /\b(service[_ ]?role|supabase|openrouter|open router|mastershop|master shop|bullmq|redis|docker|nginx|contabo|hostinger|app_encryption_key|process\.env|variables? de entorno|api[_ ]?key|apikey|llave secreta|secret key|webhook secret|system prompt|prompt (del )?sistema|\.env)\b|\/(admin|api)\/[a-z]|\b(localhost|127\.0\.0\.1)\b|\b(192\.168|10\.\d{1,3}|172\.(1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b|\b169\.58\.\d/i;
const RE_COSTOS =
  /\b(precio de costo|costo de compra|costo unitario|costo de adquisici[oó]n|costo real|margen(es)? de (ganancia|utilidad|beneficio)|margen bruto|utilidad (bruta|neta)|precio (mayorista|al por mayor|de proveedor|de f[aá]brica)|nuestro proveedor|mi proveedor|el proveedor (de|del)|sku (del )?proveedor|c[oó]digo (del )?proveedor|dropshipp?(ing|er))\b/iu;
const RE_URL = /\b(?:https?:\/\/|www\.)([^\s/"'<>)\]]+)/giu;

export interface ConfigFuga {
  /** Texto confidencial que no debe salir (prompt base, reglas e instrucciones del panel). */
  reservado: string;
  /** Marca interna incluida en el prompt: si aparece en la salida, hubo fuga. */
  canario: string;
  /** Hosts de la tienda que pueden aparecer en enlaces (p. ej. `izaoperfumeria.com`, `wa.me`). */
  hostsPropios: string[];
}

export function crearDetectorFuga(c: ConfigFuga, datos: DatosPermitidos) {
  const ventanas = new Set<string>();
  const w = palabras(c.reservado);
  for (let i = 0; i + VENTANA <= w.length; i++) ventanas.add(w.slice(i, i + VENTANA).join(' '));
  const propios = c.hostsPropios.map((h) => h.toLowerCase());

  return function detectar(oracion: string): MotivoSalida | null {
    if (c.canario && oracion.includes(c.canario)) return 'fuga_prompt';
    const o = palabras(oracion);
    for (let i = 0; i + VENTANA <= o.length; i++) if (ventanas.has(o.slice(i, i + VENTANA).join(' '))) return 'fuga_prompt';
    if (RE_SECRETO.some((r) => r.test(oracion))) return 'secreto';
    if (RE_INTERNO.test(oracion)) return 'interno';
    if (RE_COSTOS.test(sinTildes(oracion)) || RE_COSTOS.test(oracion)) return 'costos';
    for (const m of oracion.matchAll(RE_URL)) {
      const host = (m[1] ?? '').toLowerCase().replace(/[.,;:!?]+$/, '');
      const ok = propios.some((p) => host === p || host.endsWith(`.${p}`)) || [...datos.hosts].some((h) => host === h || host.endsWith(`.${h}`));
      if (!ok) return 'url';
    }
    return null;
  };
}

export class FiltroSalida {
  private buffer = '';
  private dichos = new Set<string>();
  readonly motivos = new Set<MotivoSalida>();
  private readonly detectarFuga: (o: string) => MotivoSalida | null;

  constructor(
    private readonly datos: DatosPermitidos,
    fuga: ConfigFuga,
  ) {
    this.detectarFuga = crearDetectorFuga(fuga, datos);
  }

  /** Se reemplazó una oración que afirmaba originalidad/marcas o traía una cifra sin respaldo: conviene ofrecer al asesor. */
  get derivarAsesor(): boolean {
    return [...this.motivos].some((m) => m === 'regla7' || m.startsWith('cifra_'));
  }

  /** Se reemplazó una oración por la regla 7 (compatibilidad con el aviso de regla 7 del turno). */
  get huboRegla7(): boolean {
    return this.motivos.has('regla7');
  }

  /** Se reemplazó por una cifra sin respaldo. */
  get huboCifraSinRespaldo(): boolean {
    return [...this.motivos].some((m) => m.startsWith('cifra_'));
  }

  private reemplazo(clave: string, mensaje: string, oracion: string): string {
    if (this.dichos.has(clave)) return '';
    this.dichos.add(clave);
    return (/^\s/.test(oracion) ? ' ' : '') + mensaje;
  }

  private procesar(oracion: string): string {
    const fuga = this.detectarFuga(oracion);
    if (fuga) {
      this.motivos.add(fuga);
      return this.reemplazo('rechazo', MENSAJE_RECHAZO, oracion);
    }
    if (violaReglaSiete(oracion)) {
      this.motivos.add('regla7');
      return this.reemplazo('regla7', MENSAJE_DERIVAR_ASESOR, oracion);
    }
    const cifra = cifraNoRespaldada(oracion, this.datos);
    if (cifra) {
      this.motivos.add(`cifra_${cifra}`);
      return this.reemplazo('cifra', MENSAJE_SIN_DATO, oracion);
    }
    return oracion;
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

  cerrar(): string {
    const resto = this.buffer;
    this.buffer = '';
    return resto ? this.procesar(resto) : '';
  }
}
