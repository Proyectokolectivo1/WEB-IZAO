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
import { limpiarDato, limpiarLista, limpiarTextoLargo, type Alertas } from './datos-seguros';
import type { DefHerramienta } from './llm';

export const TEMAS_POLITICA = ['envios', 'garantias', 'devoluciones', 'pagos', 'tiempos_entrega', 'contra_entrega', 'terminos', 'quienes_somos'] as const;
export type TemaPolitica = (typeof TEMAS_POLITICA)[number];
export const MAX_ITERACIONES_HERRAMIENTAS = 4;
/** Tope por turno (anti-scraping): llamadas a herramientas y productos devueltos en total. */
export const MAX_LLAMADAS_POR_TURNO = 6;
export const MAX_PRODUCTOS_POR_TURNO = 12;
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
  /** Valor y nota de envío que muestra la tienda (espacios `valor_envio` y `nota_envio` del panel del país). */
  envio(): Promise<{ valor: string; nota: string }>;
  metodos(): Promise<{
    metodos: { nombre: string; descripcion: string | null; tipo: string }[];
    contraEntrega: { habilitada: boolean; abono: string; minimoRecaudo: string };
    recargoFinanciacion: Record<string, string>;
  }>;
  pedido(numero: string, celularE164: string): Promise<{ estado: string; guia: { transportadora: string | null; codigo: string | null; url: string | null } | null } | null>;
  codigosIza(): Promise<{ codigo: string; descripcion: string | null }[]>;
  enlaceAsesor(motivo: string): string | null;
  /** Tope de consultas de pedido por visitante (anti-enumeración). `false` = se alcanzó el límite. Opcional. */
  permitirConsultaPedido?(): Promise<boolean>;
}

const obj = (propiedades: Record<string, unknown>, requeridos: string[] = []) => ({ type: 'object', properties: propiedades, required: requeridos, additionalProperties: false });

export const DEFINICIONES: DefHerramienta[] = [
  {
    name: 'buscar_productos',
    description: 'Busca fragancias del catálogo del país. Devuelve slug, nombre, precio_desde (el precio exacto de cada presentación sale de ver_producto) y disponibilidad (máximo 6; no hay paginación).',
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
    description: 'Texto vigente de una política de la tienda (envíos y valor de envío, garantías, devoluciones, pagos, contra entrega, términos, quiénes somos). Si no está publicada, lo indica: no la inventes.',
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
  /** Avisos de seguridad de la llamada (p. ej. `inyeccion_indirecta`: un texto de la base intentó darle órdenes al modelo). */
  alertas?: string[];
}

const falla = (error: string): ResultadoHerramienta => ({ resultado: { error }, slugs: [] });

/** Sin dato publicado: el modelo debe decir «aún no tengo esa información» y ofrecer al asesor, nunca inventar. */
const sinPublicar = (tema: string): ResultadoHerramienta => ({
  resultado: {
    tema,
    disponible: false,
    mensaje: 'Aún no hay información publicada sobre este tema. Responde: «aún no tengo esa información, te comunico con un asesor» y usa contactar_asesor. No inventes valores, plazos ni condiciones.',
  },
  slugs: [],
});

const CODIGO_DESCUENTO = /^[A-Z0-9][A-Z0-9_-]{2,23}$/;

/** Una búsqueda sin letras ni números («*», «%», «a») no sirve para filtrar: sería un volcado del catálogo. */
const textoUtil = (t: string | undefined) => {
  const limpio = (t ?? '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  return [...limpio.replace(/\s/g, '')].length >= 2 ? limpio : '';
};

export async function ejecutarHerramienta(deps: DepsHerramientas, nombre: string, argumentosJson: string): Promise<ResultadoHerramienta> {
  let args: unknown;
  try {
    args = argumentosJson.trim() ? JSON.parse(argumentosJson) : {};
  } catch {
    return falla('Los argumentos no son un JSON válido.');
  }
  const precio = (m: number | bigint | string) => formatearPrecio(m, deps.pais);
  const alertas: Alertas = [];
  const dato = (t: string | null | undefined, max = 200) => limpiarDato(t, max, alertas);
  const lista = (v: readonly (string | null | undefined)[] | null | undefined) => limpiarLista(v, 60, 10, alertas);
  const conAlertas = (r: ResultadoHerramienta): ResultadoHerramienta => (alertas.length > 0 ? { ...r, alertas: [...new Set(alertas)] } : r);
  try {
    switch (nombre) {
      case 'buscar_productos': {
        const a = esquemaBuscar.safeParse(args);
        if (!a.success) return falla('Argumentos inválidos.');
        const texto = textoUtil(a.data.texto);
        const items = await deps.buscar({
          ...(texto ? { texto } : {}),
          ...(a.data.genero ? { genero: a.data.genero } : {}),
          ...(a.data.familia ? { familia: a.data.familia } : {}),
          ...(a.data.precio_min !== undefined ? { precioMin: aMenor(a.data.precio_min, deps.pais) } : {}),
          ...(a.data.precio_max !== undefined ? { precioMax: aMenor(a.data.precio_max, deps.pais) } : {}),
          limite: Math.min(a.data.limite ?? 4, 6),
        });
        const lista6 = items.slice(0, 6);
        return conAlertas({
          resultado: {
            productos: lista6.map((p) => ({
              slug: p.slug,
              nombre: dato(p.name, 100),
              precio_desde: precio(p.min_price),
              ...(p.discount_pct ? { descuento_pct: p.discount_pct } : {}),
              familia: p.family_slug,
              genero: p.gender_slug,
              disponibilidad: p.in_stock ? 'disponible' : 'agotado',
            })),
            ...(lista6.length === 0 ? { nota: 'Sin resultados para esa búsqueda. No inventes productos: ofrece afinar la búsqueda o un asesor.' } : {}),
          },
          slugs: lista6.map((p) => p.slug),
        });
      }
      case 'ver_producto': {
        const a = esquemaVer.safeParse(args);
        if (!a.success) return falla('Argumentos inválidos.');
        const f = await deps.ficha(a.data.slug.toLowerCase());
        if (!f) return falla('Ese producto no existe o no está disponible en este país.');
        const opcion = (v: FichaProducto['variants'][number]) =>
          dato(f.options.flatMap((o) => o.values).filter((x) => v.option_value_ids.includes(x.id)).map((x) => x.value).join(' · '), 60) || 'Presentación única';
        return conAlertas({
          resultado: {
            slug: f.slug,
            nombre: dato(f.name, 100),
            genero: dato(f.gender_name, 40),
            familia: dato(f.family_name, 40),
            concentracion: dato(f.concentration_name, 40),
            descripcion_corta: dato(f.short_description, 300),
            notas_salida: lista(f.notes_top),
            notas_corazon: lista(f.notes_heart),
            notas_fondo: lista(f.notes_base),
            ocasiones: lista(f.occasion),
            temporadas: lista(f.season),
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
        });
      }
      case 'consultar_politica': {
        const a = esquemaTema.safeParse(args);
        if (!a.success) return falla('Tema no válido.');
        if (a.data.tema === 'pagos' || a.data.tema === 'contra_entrega') {
          const m = await deps.metodos();
          return conAlertas({
            resultado: {
              tema: a.data.tema,
              contra_entrega: m.contraEntrega.habilitada
                ? { abono_para_confirmar: m.contraEntrega.abono, minimo_a_recaudar: m.contraEntrega.minimoRecaudo, explicacion: 'Se paga un abono para confirmar el pedido y el resto al recibirlo.' }
                : 'No disponible en este país.',
              metodos: m.metodos.map((x) => dato(x.nombre, 60)).filter(Boolean),
            },
            slugs: [],
          });
        }
        const esEnvio = a.data.tema === 'envios' || a.data.tema === 'tiempos_entrega';
        const p = await deps.politica(a.data.tema);
        const texto = p ? limpiarTextoLargo(p.texto, MAX_TEXTO_POLITICA, alertas) : '';
        if (esEnvio) {
          const e = await deps.envio();
          return conAlertas({
            resultado: {
              tema: a.data.tema,
              valor_envio: dato(e.valor, 80),
              nota_envio: dato(e.nota, 240),
              ...(p ? { titulo: dato(p.titulo, 100), texto } : { politica_publicada: false, aviso: 'No hay política de envíos publicada: no inventes plazos, transportadoras ni zonas de cobertura.' }),
            },
            slugs: [],
          });
        }
        if (!p || !texto) return sinPublicar(a.data.tema);
        return conAlertas({ resultado: { tema: a.data.tema, titulo: dato(p.titulo, 100), texto }, slugs: [] });
      }
      case 'metodos_de_pago': {
        const m = await deps.metodos();
        return conAlertas({
          resultado: {
            metodos: m.metodos.map((x) => ({ nombre: dato(x.nombre, 60), descripcion: dato(x.descripcion, 160) || null })),
            contra_entrega: m.contraEntrega.habilitada ? { abono: m.contraEntrega.abono, minimo_a_recaudar: m.contraEntrega.minimoRecaudo } : null,
            recargo_financiacion_pct: m.recargoFinanciacion,
          },
          slugs: [],
        });
      }
      case 'estado_pedido': {
        const a = esquemaPedido.safeParse(args);
        // Tope por visitante, cuente o no la consulta: evita probar números de pedido al azar.
        if (deps.permitirConsultaPedido && !(await deps.permitirConsultaPedido())) {
          return falla('Por seguridad no puedo hacer más consultas de pedidos por ahora; un asesor te ayuda por WhatsApp.');
        }
        const igual = falla('No encontramos un pedido con esos datos. Revisa el número y el celular con el que compraste, o habla con un asesor.');
        if (!a.success) return igual;
        const numero = normalizarNumeroPedido(a.data.numero);
        const tel = normalizePhone(aCodigoCore(deps.pais) as CountryCode, a.data.celular);
        if (!tel || !numeroPedidoValido(numero, aCodigoCore(deps.pais))) return igual;
        const p = await deps.pedido(numero, tel.e164);
        if (!p) return igual;
        const titulos = TC.pedido.titulos as Record<string, string>;
        const guia = p.guia ? { transportadora: dato(p.guia.transportadora, 60) || null, codigo: dato(p.guia.codigo, 60) || null, url: p.guia.url } : null;
        return conAlertas({ resultado: { estado: titulos[p.estado] ?? 'Tu pedido está en proceso.', ...(guia ? { guia } : {}) }, slugs: [] });
      }
      case 'promociones_vigentes': {
        const codigos = (await deps.codigosIza())
          .filter((c) => CODIGO_DESCUENTO.test(c.codigo))
          .map((c) => ({ codigo: c.codigo, descripcion: dato(c.descripcion, 160) || null }));
        return conAlertas({ resultado: { codigos }, slugs: [] });
      }
      case 'contactar_asesor': {
        const a = esquemaAsesor.safeParse(args);
        const enlace = deps.enlaceAsesor(a.success ? dato(a.data.motivo, 160) : '');
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
