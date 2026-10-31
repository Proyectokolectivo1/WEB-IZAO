/**
 * Herramientas de Iza (§20.2): funciones de SOLO LECTURA que consultan la base del país de la conversación. Ninguna
 * devuelve costos, existencias exactas ("disponible / pocas unidades / agotado") ni datos de otras personas;
 * `estado_pedido` exige número + celular coincidentes y responde igual si no coinciden. Los errores vuelven al modelo
 * como `{ error }` (nunca excepciones ni detalles técnicos). Las dependencias entran por `DepsHerramientas`.
 */
import { z } from 'zod';
import { normalizePhone } from '@izao/core/schemas';
import type { CountryCode } from '@izao/core/money';
import { normalizarNumeroPedido, numeroPedidoValido } from '../garantias/logica';
import { aCodigoCore, formatearPrecio } from '../pais';
import { TC } from '../textos-checkout';
import type { CodigoPais, FichaProducto, ItemCatalogo } from '../types';
import type { DefHerramienta } from './llm';

export const TEMAS_POLITICA = ['envios', 'garantias', 'devoluciones', 'pagos', 'tiempos_entrega', 'contra_entrega'] as const;
export type TemaPolitica = (typeof TEMAS_POLITICA)[number];
export const MAX_ITERACIONES_HERRAMIENTAS = 4;
const MAX_TEXTO_POLITICA = 1800;

export interface ConsultaBusqueda {
  texto?: string;
  genero?: string;
  familia?: string;
  /** Unidad menor de la moneda del país. */
  precioMin?: number;
  precioMax?: number;
  limite: number;
}

export interface DepsHerramientas {
  pais: CodigoPais;
  buscar(c: ConsultaBusqueda): Promise<ItemCatalogo[]>;
  ficha(slug: string): Promise<FichaProducto | null>;
  /** Texto vigente del panel para el tema (HTML ya convertido a texto), o `null` si no hay. */
  politica(tema: Exclude<TemaPolitica, 'pagos' | 'contra_entrega'>): Promise<{ titulo: string; texto: string } | null>;
  metodos(): Promise<{
    metodos: { nombre: string; descripcion: string | null; tipo: string }[];
    contraEntrega: { habilitada: boolean; abono: string; minimoRecaudo: string };
    recargoFinanciacion: Record<string, string>;
  }>;
  pedido(numero: string, celularE164: string): Promise<{ estado: string; guia: { transportadora: string | null; codigo: string | null; url: string | null } | null } | null>;
  codigosIza(): Promise<{ codigo: string; descripcion: string | null }[]>;
  enlaceAsesor(motivo: string): string | null;
}

const obj = (propiedades: Record<string, unknown>, requeridos: string[] = []) => ({ type: 'object', properties: propiedades, required: requeridos, additionalProperties: false });

export const DEFINICIONES: DefHerramienta[] = [
  {
    name: 'buscar_productos',
    description: 'Busca fragancias del catálogo del país. Devuelve slug, nombre, precio y disponibilidad (máximo 6).',
    parameters: obj({
      texto: { type: 'string', description: 'Palabras clave: aroma, nota, ocasión o nombre.' },
      genero: { type: 'string', description: 'Género en slug: mujer, hombre o unisex.' },
      familia: { type: 'string', description: 'Familia olfativa en slug (floral, amaderado, fresco…).' },
      precio_min: { type: 'number', description: 'Precio mínimo en la moneda del país (unidad mayor).' },
      precio_max: { type: 'number', description: 'Precio máximo en la moneda del país (unidad mayor).' },
      limite: { type: 'integer', minimum: 1, maximum: 6 },
    }),
  },
  {
    name: 'ver_producto',
    description: 'Ficha de un producto por slug: notas, presentaciones con precio y disponibilidad, atributos.',
    parameters: obj({ slug: { type: 'string' } }, ['slug']),
  },
  {
    name: 'consultar_politica',
    description: 'Texto vigente de una política de la tienda.',
    parameters: obj({ tema: { type: 'string', enum: [...TEMAS_POLITICA] } }, ['tema']),
  },
  { name: 'metodos_de_pago', description: 'Métodos de pago activos en el país y sus reglas (recargo de financiación, abono de contra entrega).', parameters: obj({}) },
  {
    name: 'estado_pedido',
    description: 'Estado de un pedido y su guía. Exige el número de pedido y el celular con el que se compró.',
    parameters: obj({ numero: { type: 'string' }, celular: { type: 'string' } }, ['numero', 'celular']),
  },
  { name: 'promociones_vigentes', description: 'Códigos de descuento que Iza puede ofrecer ahora.', parameters: obj({}) },
  {
    name: 'contactar_asesor',
    description: 'Entrega el enlace de WhatsApp para hablar con un asesor humano.',
    parameters: obj({ motivo: { type: 'string', description: 'Motivo breve de la consulta.' } }, ['motivo']),
  },
];

const disponibilidad = (en: boolean, bajo: boolean) => (!en ? 'agotado' : bajo ? 'pocas unidades' : 'disponible');

const esquemaBuscar = z.object({
  texto: z.string().max(120).optional(),
  genero: z.string().max(40).optional(),
  familia: z.string().max(40).optional(),
  precio_min: z.number().nonnegative().max(1e9).optional(),
  precio_max: z.number().nonnegative().max(1e9).optional(),
  limite: z.number().int().min(1).max(100).optional(),
});
const esquemaVer = z.object({ slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,118}$/i) });
const esquemaTema = z.object({ tema: z.enum(TEMAS_POLITICA) });
const esquemaPedido = z.object({ numero: z.string().max(40), celular: z.string().max(30) });
const esquemaAsesor = z.object({ motivo: z.string().max(200) });

/** Unidad mayor → menor (COP exponente 0, USD exponente 2) sin float acumulado. */
const aMenor = (mayor: number, pais: CodigoPais) => Math.round(mayor * (pais === 'ec' ? 100 : 1));

export interface ResultadoHerramienta {
  resultado: unknown;
  /** Slugs que el modelo ya conoce por esta llamada (para validar luego sus tarjetas). */
  slugs: string[];
}

const falla = (error: string): ResultadoHerramienta => ({ resultado: { error }, slugs: [] });

export async function ejecutarHerramienta(deps: DepsHerramientas, nombre: string, argumentosJson: string): Promise<ResultadoHerramienta> {
  let args: unknown;
  try {
    args = argumentosJson.trim() ? JSON.parse(argumentosJson) : {};
  } catch {
    return falla('Los argumentos no son un JSON válido.');
  }
  const precio = (m: number | bigint | string) => formatearPrecio(m, deps.pais);
  try {
    switch (nombre) {
      case 'buscar_productos': {
        const a = esquemaBuscar.safeParse(args);
        if (!a.success) return falla('Argumentos inválidos.');
        const items = await deps.buscar({
          ...(a.data.texto ? { texto: a.data.texto } : {}),
          ...(a.data.genero ? { genero: a.data.genero } : {}),
          ...(a.data.familia ? { familia: a.data.familia } : {}),
          ...(a.data.precio_min !== undefined ? { precioMin: aMenor(a.data.precio_min, deps.pais) } : {}),
          ...(a.data.precio_max !== undefined ? { precioMax: aMenor(a.data.precio_max, deps.pais) } : {}),
          limite: Math.min(a.data.limite ?? 4, 6),
        });
        const lista = items.slice(0, 6);
        return {
          resultado: {
            productos: lista.map((p) => ({
              slug: p.slug,
              nombre: p.name,
              precio_desde: precio(p.min_price),
              ...(p.discount_pct ? { descuento_pct: p.discount_pct } : {}),
              familia: p.family_slug,
              genero: p.gender_slug,
              disponibilidad: p.in_stock ? 'disponible' : 'agotado',
            })),
            ...(lista.length === 0 ? { nota: 'Sin resultados para esa búsqueda.' } : {}),
          },
          slugs: lista.map((p) => p.slug),
        };
      }
      case 'ver_producto': {
        const a = esquemaVer.safeParse(args);
        if (!a.success) return falla('Argumentos inválidos.');
        const f = await deps.ficha(a.data.slug.toLowerCase());
        if (!f) return falla('Ese producto no existe o no está disponible en este país.');
        const opcion = (v: FichaProducto['variants'][number]) =>
          f.options.flatMap((o) => o.values).filter((x) => v.option_value_ids.includes(x.id)).map((x) => x.value).join(' · ') || 'Presentación única';
        return {
          resultado: {
            slug: f.slug,
            nombre: f.name,
            genero: f.gender_name,
            familia: f.family_name,
            concentracion: f.concentration_name,
            descripcion_corta: f.short_description,
            notas_salida: f.notes_top,
            notas_corazon: f.notes_heart,
            notas_fondo: f.notes_base,
            ocasiones: f.occasion,
            temporadas: f.season,
            duracion: f.longevity,
            estela: f.sillage,
            presentaciones: f.variants.map((v) => ({
              presentacion: opcion(v),
              precio: precio(v.price),
              ...(v.compare_at_price ? { precio_antes: precio(v.compare_at_price) } : {}),
              disponibilidad: disponibilidad(v.in_stock, v.stock_bajo),
            })),
            calificacion: f.reviews.avg,
            resenas: f.reviews.count,
          },
          slugs: [f.slug],
        };
      }
      case 'consultar_politica': {
        const a = esquemaTema.safeParse(args);
        if (!a.success) return falla('Tema no válido.');
        if (a.data.tema === 'pagos' || a.data.tema === 'contra_entrega') {
          const m = await deps.metodos();
          return {
            resultado: {
              tema: a.data.tema,
              contra_entrega: m.contraEntrega.habilitada
                ? { abono_para_confirmar: m.contraEntrega.abono, minimo_a_recaudar: m.contraEntrega.minimoRecaudo, explicacion: 'Se paga un abono para confirmar el pedido y el resto al recibirlo.' }
                : 'No disponible en este país.',
              metodos: m.metodos.map((x) => x.nombre),
            },
            slugs: [],
          };
        }
        const p = await deps.politica(a.data.tema);
        if (!p) return falla('No hay una política publicada para ese tema; ofrece un asesor.');
        return { resultado: { tema: a.data.tema, titulo: p.titulo, texto: p.texto.slice(0, MAX_TEXTO_POLITICA) }, slugs: [] };
      }
      case 'metodos_de_pago': {
        const m = await deps.metodos();
        return {
          resultado: {
            metodos: m.metodos.map((x) => ({ nombre: x.nombre, descripcion: x.descripcion })),
            contra_entrega: m.contraEntrega.habilitada ? { abono: m.contraEntrega.abono, minimo_a_recaudar: m.contraEntrega.minimoRecaudo } : null,
            recargo_financiacion_pct: m.recargoFinanciacion,
          },
          slugs: [],
        };
      }
      case 'estado_pedido': {
        const a = esquemaPedido.safeParse(args);
        const igual = falla('No encontramos un pedido con esos datos. Revisa el número y el celular con el que compraste, o habla con un asesor.');
        if (!a.success) return igual;
        const numero = normalizarNumeroPedido(a.data.numero);
        const tel = normalizePhone(aCodigoCore(deps.pais) as CountryCode, a.data.celular);
        if (!tel || !numeroPedidoValido(numero, aCodigoCore(deps.pais))) return igual;
        const p = await deps.pedido(numero, tel.e164);
        if (!p) return igual;
        const titulos = TC.pedido.titulos as Record<string, string>;
        return { resultado: { estado: titulos[p.estado] ?? 'Tu pedido está en proceso.', ...(p.guia ? { guia: p.guia } : {}) }, slugs: [] };
      }
      case 'promociones_vigentes':
        return { resultado: { codigos: await deps.codigosIza() }, slugs: [] };
      case 'contactar_asesor': {
        const a = esquemaAsesor.safeParse(args);
        const enlace = deps.enlaceAsesor(a.success ? a.data.motivo : '');
        return { resultado: enlace ? { enlace_whatsapp: enlace } : { error: 'El WhatsApp del asesor no está disponible ahora.' }, slugs: [] };
      }
      default:
        return falla('Herramienta desconocida.');
    }
  } catch (e) {
    console.error(`[iza] herramienta ${nombre} falló: ${e instanceof Error ? e.name : 'error'}`);
    return falla('No pude consultar eso en este momento; ofrece un asesor.');
  }
}
