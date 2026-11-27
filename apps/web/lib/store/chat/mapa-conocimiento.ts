/**
 * Mapa de conocimiento de Iza: un resumen corto, por país y generado desde la base, de QUÉ existe en la tienda y qué no.
 * Se entrega al modelo dentro del prompt (después de las reglas, como dato) para que sepa qué categorías, familias,
 * métodos de pago y políticas hay, y no invente lo que no existe. Los valores nunca están quemados: cada línea sale de
 * `DatosMapa`, que `fuente-supabase.ts` arma con la base y cachea unos minutos.
 *
 * Presupuesto de tokens: listas recortadas (máx. 12 por lista, 40 caracteres cada una) → ~250-400 tokens por país.
 * Las cifras que trae el mapa (rango de precios, abono, envío) son referencia: Iza debe confirmar con herramientas.
 * Código puro.
 */
import { limpiarDato } from './datos-seguros';

export type TipoPoliticaMapa = 'envios' | 'devoluciones' | 'terminos' | 'quienes_somos' | 'tratamiento_datos';

export interface DatosMapa {
  nombrePais: string;
  moneda: 'COP' | 'USD';
  generos: string[];
  familias: string[];
  concentraciones: string[];
  categorias: { nombre: string; hijos: string[] }[];
  colecciones: string[];
  /** Rango de precios del catálogo ya formateado en la moneda del país (o `null` si no hay productos). */
  rangoPrecios: { min: string; max: string } | null;
  metodosPago: { nombre: string; descripcion: string | null }[];
  contraEntrega: { habilitada: boolean; abono: string; minimoRecaudo: string };
  /** Pct de recargo por proveedor de financiación (`{ addi: '10' }`); vacío si no hay. */
  recargoFinanciacion: Record<string, string>;
  /** Valor y nota de envío que muestra la tienda (panel). */
  envio: { valor: string; nota: string };
  /** Tipos de página publicados en el país. */
  paginasPublicadas: TipoPoliticaMapa[];
  /** ¿El país tiene WhatsApp de asesor configurado? */
  asesorDisponible: boolean;
  /** Códigos de descuento que Iza puede ofrecer ahora (solo la cantidad; el detalle sale de promociones_vigentes). */
  codigosIza: number;
}

const ETIQUETA_POLITICA: Record<Exclude<TipoPoliticaMapa, 'tratamiento_datos'>, string> = {
  envios: 'Envíos',
  devoluciones: 'Devoluciones y garantías',
  terminos: 'Términos y condiciones',
  quienes_somos: 'Quiénes somos',
};

const MAX_LISTA = 12;
const lista = (v: readonly string[]) =>
  v
    .map((x) => limpiarDato(x, 40))
    .filter(Boolean)
    .slice(0, MAX_LISTA);

export function renderizarMapa(d: DatosMapa): string {
  const l: string[] = [];
  l.push(`MAPA DE LA TIENDA (${d.nombrePais}, ${d.moneda}). Es lo que existe hoy; lo que no aparece aquí ni lo devuelve una herramienta no existe: no lo inventes.`);
  const generos = lista(d.generos);
  if (generos.length) l.push(`- Géneros: ${generos.join(', ')}.`);
  const familias = lista(d.familias);
  if (familias.length) l.push(`- Familias olfativas: ${familias.join(', ')}.`);
  const conc = lista(d.concentraciones);
  if (conc.length) l.push(`- Concentraciones: ${conc.join(', ')}.`);
  const cats = d.categorias
    .slice(0, MAX_LISTA)
    .map((c) => {
      const nombre = limpiarDato(c.nombre, 40);
      const hijos = lista(c.hijos).slice(0, 6);
      return nombre ? (hijos.length ? `${nombre} (${hijos.join(', ')})` : nombre) : '';
    })
    .filter(Boolean);
  if (cats.length) l.push(`- Categorías: ${cats.join('; ')}.`);
  const cols = lista(d.colecciones);
  if (cols.length) l.push(`- Colecciones: ${cols.join(', ')}.`);
  if (d.rangoPrecios) l.push(`- Rango de precios del catálogo: de ${d.rangoPrecios.min} a ${d.rangoPrecios.max} (solo orientativo: el precio de cada producto sale de las herramientas).`);

  const pagos = d.metodosPago
    .slice(0, 8)
    .map((m) => {
      const n = limpiarDato(m.nombre, 40);
      const desc = limpiarDato(m.descripcion, 80);
      return n ? (desc ? `${n} (${desc})` : n) : '';
    })
    .filter(Boolean);
  l.push(`- Pagos habilitados: ${pagos.length ? pagos.join('; ') : 'ninguno publicado (no ofrezcas métodos de pago; pasa con un asesor)'}.`);
  if (d.contraEntrega.habilitada) l.push(`- Contra entrega: sí, con abono de ${d.contraEntrega.abono} para confirmar y el resto al recibir.`);
  else l.push('- Contra entrega: no disponible en este país.');
  const recargos = Object.entries(d.recargoFinanciacion)
    .filter(([k]) => /^[a-z_]{2,20}$/.test(k))
    .map(([k, v]) => `${k} ${v}%`);
  if (recargos.length) l.push(`- Recargo de financiación: ${recargos.join(', ')}.`);

  const valor = limpiarDato(d.envio.valor, 80);
  const nota = limpiarDato(d.envio.nota, 200);
  l.push(`- Envío (lo que muestra la tienda): ${valor ? `«${valor}»` : 'sin valor publicado'}${nota ? `. ${nota}` : ''}`);

  const publicadas = (Object.keys(ETIQUETA_POLITICA) as (keyof typeof ETIQUETA_POLITICA)[]).filter((k) => d.paginasPublicadas.includes(k));
  const ausentes = (Object.keys(ETIQUETA_POLITICA) as (keyof typeof ETIQUETA_POLITICA)[]).filter((k) => !d.paginasPublicadas.includes(k));
  l.push(`- Políticas publicadas: ${publicadas.length ? publicadas.map((k) => ETIQUETA_POLITICA[k]).join(', ') : 'ninguna'}.`);
  if (ausentes.length) l.push(`- Políticas SIN publicar (responde «aún no tengo esa información, te comunico con un asesor»): ${ausentes.map((k) => ETIQUETA_POLITICA[k]).join(', ')}.`);

  l.push(`- Asesor humano por WhatsApp: ${d.asesorDisponible ? 'disponible con contactar_asesor' : 'no disponible ahora'}. Horarios de atención: no publicados (no los inventes).`);
  l.push(`- Códigos de descuento que puedes ofrecer: ${d.codigosIza > 0 ? `${d.codigosIza} (consúltalos con promociones_vigentes)` : 'ninguno'}.`);
  l.push('- No existen (no los inventes ni los prometas): productos o marcas que no devuelva buscar_productos, promociones, sorteos, puntos o regalos no listados, plazos de entrega o costos de envío no publicados.');
  return l.join('\n');
}
