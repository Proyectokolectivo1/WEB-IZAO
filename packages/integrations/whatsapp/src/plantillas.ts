/**
 * Plantillas de WhatsApp como datos (§13.2, Anexo B, D-025). El texto, el pie, el botón y el orden de las variables
 * viven en `whatsapp_templates` y se editan en el panel; aquí solo están la validación con las reglas de revisión de
 * Meta, la construcción de los cuerpos de la API y los textos por defecto del *seed*.
 *
 * `variables_map`: posición → variable conocida (`{"1":"customer_first_name", …, "button_url_1":"pay_link_token"}`).
 * El código nunca supone posiciones fijas: al enviar, los parámetros van en el orden de aparición, que la validación
 * exige igual a 1, 2, 3…
 */

export const VARIABLES_COBRO = [
  'customer_first_name',
  'order_number',
  'cod_deposit_amount',
  'cod_collect_amount',
  'pay_link_expires_at',
  /** Link de marca del abono, `https://…/{pais}/pagar/{token}` (`urlPagoAbono`), para plantillas que lo llevan en el cuerpo. */
  'pay_link_url',
] as const;
export type VariableCobro = (typeof VARIABLES_COBRO)[number];
/** Valores ya formateados para el cliente (dinero con `formatMoney`, fecha en la zona del país). */
/** `pay_link_url` es opcional en el tipo: solo lo exigen (en tiempo de ejecución) las plantillas que lo usan. */
export type ValoresCobro = Readonly<Record<Exclude<VariableCobro, 'pay_link_url'>, string> & { pay_link_url?: string }>;

export const CLAVES_PLANTILLA_COD = ['cobro_abono', 'recordatorio_abono_1', 'recordatorio_abono_2', 'recordatorio_abono_final'] as const;
export type ClavePlantillaCod = (typeof CLAVES_PLANTILLA_COD)[number];

export interface PlantillaWhatsApp {
  key: string;
  meta_template_name: string;
  language: string;
  body_text: string;
  footer_text: string | null;
  button_text: string | null;
  button_url: string | null;
  variables_map: Readonly<Record<string, string>>;
}

export type CodigoProblema =
  | 'LLAVES_INVALIDAS'
  | 'VARIABLES_NO_SECUENCIALES'
  | 'VARIABLE_EN_EXTREMO'
  | 'VARIABLE_SIN_MAPA'
  | 'VARIABLE_DESCONOCIDA'
  | 'CUERPO_VACIO'
  | 'CUERPO_LARGO'
  | 'PIE_LARGO'
  | 'BOTON_LARGO'
  | 'BOTON_INCOMPLETO'
  | 'URL_BOTON_INVALIDA'
  | 'NOMBRE_INVALIDO'
  | 'IDIOMA_INVALIDO'
  | 'TEXTO_NO_PERMITIDO';

export interface ProblemaPlantilla {
  codigo: CodigoProblema;
  detalle?: string;
}

const VARIABLE = /\{\{(\d+)\}\}/g;
const CLAVE_BOTON = 'button_url_1';
const IDIOMAS = /^es(_(AR|CL|CO|CR|DO|EC|ES|HN|MX|PA|PE|UY))?$/;
/**
 * Regla 7 del proyecto y categoría UTILITY: ni originalidad ni lenguaje promocional. "100 %" a secas no se rechaza:
 * la plantilla de cobro aprobada en Meta dice "100% seguro de tu compra" (D-048); "100 % original" cae por "original".
 */
const PROHIBIDO = /\b(original(es)?|aut[eé]ntic[oa]s?|certificad[oa]s?|r[ée]plica|promoci[oó]n|descuento|oferta|gratis)\b/i;

function posiciones(texto: string): number[] {
  return [...texto.matchAll(VARIABLE)].map((m) => Number(m[1]));
}

/**
 * Estructura que el envío necesita para que Meta acepte el mensaje: variables en orden y con dato, botón coherente,
 * nombre e idioma válidos. No revisa el texto: el que recibe el cliente es el aprobado en Meta, no esta copia (D-048).
 */
export function validarEnvio(p: PlantillaWhatsApp): ProblemaPlantilla[] {
  const out: ProblemaPlantilla[] = [];
  const cuerpo = p.body_text;
  if (!cuerpo.trim()) out.push({ codigo: 'CUERPO_VACIO' });
  if (cuerpo.replace(VARIABLE, '').includes('{') || cuerpo.replace(VARIABLE, '').includes('}')) {
    out.push({ codigo: 'LLAVES_INVALIDAS' });
  }
  const pos = posiciones(cuerpo);
  if (pos.some((n, i) => n !== i + 1)) out.push({ codigo: 'VARIABLES_NO_SECUENCIALES' });
  const recortado = cuerpo.trim();
  if (/^\{\{\d+\}\}/.test(recortado) || /\{\{\d+\}\}$/.test(recortado)) out.push({ codigo: 'VARIABLE_EN_EXTREMO' });
  for (const n of new Set(pos)) {
    const v = p.variables_map[String(n)];
    if (!v) out.push({ codigo: 'VARIABLE_SIN_MAPA', detalle: String(n) });
    else if (!(VARIABLES_COBRO as readonly string[]).includes(v)) out.push({ codigo: 'VARIABLE_DESCONOCIDA', detalle: v });
  }
  for (const [k, v] of Object.entries(p.variables_map)) {
    if (k === CLAVE_BOTON) {
      if (v !== 'pay_link_token') out.push({ codigo: 'VARIABLE_DESCONOCIDA', detalle: v });
    } else if (!/^\d+$/.test(k) || !(VARIABLES_COBRO as readonly string[]).includes(v)) {
      out.push({ codigo: 'VARIABLE_DESCONOCIDA', detalle: k });
    }
  }
  if (!!p.button_text !== !!p.button_url) out.push({ codigo: 'BOTON_INCOMPLETO' });
  if (p.button_url) {
    const base = p.button_url.slice(0, -'{{1}}'.length);
    if (
      p.button_url.length > 2000 ||
      !p.button_url.endsWith('{{1}}') ||
      !/^https:\/\/[^\s{}]+\/$/.test(base)
    ) {
      out.push({ codigo: 'URL_BOTON_INVALIDA' });
    }
  }
  if (!/^[a-z0-9_]{1,512}$/.test(p.meta_template_name)) out.push({ codigo: 'NOMBRE_INVALIDO' });
  if (!IDIOMAS.test(p.language)) out.push({ codigo: 'IDIOMA_INVALIDO' });
  return out;
}

/** Validación completa para guardar o crear una versión en Meta: estructura, límites y reglas de texto. */
export function validarPlantilla(p: PlantillaWhatsApp): ProblemaPlantilla[] {
  const out = validarEnvio(p);
  if (p.body_text.length > 1024) out.push({ codigo: 'CUERPO_LARGO' });
  if (p.footer_text && p.footer_text.length > 60) out.push({ codigo: 'PIE_LARGO' });
  if (p.button_text && p.button_text.length > 25) out.push({ codigo: 'BOTON_LARGO' });
  const cuerpo = p.body_text;
  const textos = [cuerpo, p.footer_text ?? '', p.button_text ?? ''].join(' ');
  if (PROHIBIDO.test(textos)) out.push({ codigo: 'TEXTO_NO_PERMITIDO' });
  return out;
}

function asegurarValida(p: PlantillaWhatsApp, validar: (p: PlantillaWhatsApp) => ProblemaPlantilla[] = validarPlantilla): void {
  const problemas = validar(p);
  if (problemas.length) throw new RangeError(`Plantilla inválida: ${problemas.map((x) => x.codigo).join(', ')}`);
}

function parametrosEnOrden(p: PlantillaWhatsApp, valores: ValoresCobro): string[] {
  return posiciones(p.body_text).map((n) => {
    const v = valores[p.variables_map[String(n)] as VariableCobro];
    if (typeof v !== 'string' || !v.trim() || /[\n\t]|\s{5,}/.test(v) || v.length > 200) {
      throw new RangeError(`Valor inválido para la variable ${n}.`);
    }
    return v.trim();
  });
}

const TOKEN = /^[A-Za-z0-9_-]{6,64}$/;

export interface ParametrosEnvio {
  /** E.164 con o sin `+` (`57…`, `593…`). */
  to: string;
  valores: ValoresCobro;
  tokenBoton: string;
}

export interface MensajePlantillaMeta {
  messaging_product: 'whatsapp';
  recipient_type: 'individual';
  to: string;
  type: 'template';
  template: {
    name: string;
    language: { code: string };
    components: Array<
      | { type: 'body'; parameters: Array<{ type: 'text'; text: string }> }
      | { type: 'button'; sub_type: 'url'; index: '0'; parameters: Array<{ type: 'text'; text: string }> }
    >;
  };
}

export function numeroE164(to: string): string {
  const n = to.replace(/^\+/, '');
  if (!/^(57|593)\d{8,10}$/.test(n)) throw new RangeError('Número de destino fuera de E.164 de CO/EC.');
  return n;
}

export function mensajePlantilla(p: PlantillaWhatsApp, e: ParametrosEnvio): MensajePlantillaMeta {
  asegurarValida(p, validarEnvio);
  const to = numeroE164(e.to);
  const parametros = parametrosEnOrden(p, e.valores);
  const components: MensajePlantillaMeta['template']['components'] = [
    { type: 'body', parameters: parametros.map((text) => ({ type: 'text' as const, text })) },
  ];
  if (p.button_url) {
    if (!TOKEN.test(e.tokenBoton)) throw new RangeError('Token del botón inválido.');
    components.push({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: e.tokenBoton }] });
  }
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'template',
    template: { name: p.meta_template_name, language: { code: p.language }, components },
  };
}

const PAISES_PAGO = new Set(['CO', 'EC']);

/** Link de marca del abono. La ruta pública es `/{pais}/pagar/{token}`: sin el país responde 404. */
export function urlPagoAbono(origen: string, pais: string, token: string): string {
  const o = origen.replace(/\/+$/, '');
  if (!/^https:\/\/[^\s/]+$/.test(o)) throw new RangeError('El origen del sitio debe ser https sin ruta.');
  if (!PAISES_PAGO.has(pais)) throw new RangeError('País sin tienda.');
  if (!TOKEN.test(token)) throw new RangeError('Token de pago inválido.');
  return `${o}/${pais.toLowerCase()}/pagar/${token}`;
}

export function nombreVersion(key: string, version: number): string {
  if (!Number.isInteger(version) || version < 1) throw new RangeError('Versión inválida.');
  const n = `${key}_v${version}`;
  if (!/^[a-z0-9_]{1,512}$/.test(n)) throw new RangeError('Nombre de plantilla inválido.');
  return n;
}

export interface SolicitudPlantillaMeta {
  name: string;
  language: string;
  category: 'UTILITY';
  components: Array<
    | { type: 'BODY'; text: string; example: { body_text: string[][] } }
    | { type: 'FOOTER'; text: string }
    | { type: 'BUTTONS'; buttons: Array<{ type: 'URL'; text: string; url: string; example: string[] }> }
  >;
}

/** Cuerpo de `POST /{waba_id}/message_templates` para una nueva versión (siempre UTILITY, con ejemplos). */
export function solicitudCreacion(p: PlantillaWhatsApp, ejemplo: ValoresCobro, tokenEjemplo: string): SolicitudPlantillaMeta {
  asegurarValida(p);
  const components: SolicitudPlantillaMeta['components'] = [
    { type: 'BODY', text: p.body_text, example: { body_text: [parametrosEnOrden(p, ejemplo)] } },
  ];
  if (p.footer_text) components.push({ type: 'FOOTER', text: p.footer_text });
  if (p.button_text && p.button_url) {
    if (!TOKEN.test(tokenEjemplo)) throw new RangeError('Token de ejemplo inválido.');
    components.push({ type: 'BUTTONS', buttons: [{ type: 'URL', text: p.button_text, url: p.button_url, example: [tokenEjemplo] }] });
  }
  return { name: p.meta_template_name, language: p.language, category: 'UTILITY', components };
}

/**
 * Plantillas ya creadas y aprobadas en Meta (D-048). El envío exige nombre, idioma y orden de variables idénticos;
 * las demás claves aún no tienen nombre ni texto confirmados por el dueño y siguen inactivas.
 */
export const PLANTILLAS_META: Readonly<Partial<Record<ClavePlantillaCod, { meta_template_name: string; language: string }>>> = {
  cobro_abono: { meta_template_name: 'izao_pago_envio_inicial', language: 'es_CO' },
};

const MAPA_ESTANDAR = {
  '1': 'customer_first_name',
  '2': 'order_number',
  '3': 'cod_deposit_amount',
  '4': 'cod_collect_amount',
  '5': 'pay_link_expires_at',
  [CLAVE_BOTON]: 'pay_link_token',
} as const;

/**
 * Textos por defecto del *seed* (Anexo B ajustado a las reglas de Meta, D-025): `recordatorio_abono_2` y
 * `recordatorio_abono_final` empezaban con variable y el final saltaba `{{4}}`. El panel los reemplaza.
 */
export const PLANTILLAS_SEMILLA: ReadonlyArray<Omit<PlantillaWhatsApp, 'meta_template_name'> & { key: ClavePlantillaCod }> = [
  {
    // Copia literal del texto aprobado en Meta (izao_pago_envio_inicial, encabezado fijo "Cobro de envio", sin botón).
    key: 'cobro_abono',
    language: 'es_CO',
    body_text:
      'Hola {{1}}, recibimos tu pedido #{{2}} en IZAO Perfumería. Para despachar tu pedido bajo la modalidad pago contra entrega, solo te pedimos un abono de {{3}} Como muestra de tu compromiso con recibir el paquete, queremos que estes 100% seguro de tu compra en el siguiente link: {{4}}. Si tienes alguna duda puedes verificar al numero 3161791082. tienes 24 horas para realizar el pago.',
    footer_text: null,
    button_text: null,
    button_url: null,
    variables_map: { '1': 'customer_first_name', '2': 'order_number', '3': 'cod_deposit_amount', '4': 'pay_link_url' },
  },
  {
    key: 'recordatorio_abono_1',
    language: 'es',
    body_text:
      'Hola, {{1}}. Tu pedido {{2}} sigue reservado para ti.\nSolo falta el abono de {{3}} para despacharlo; al recibir pagas {{4}}. Disponible hasta el {{5}}.',
    footer_text: 'Izao Perfumería',
    button_text: 'Pagar abono',
    button_url: 'https://izaoperfumeria.com/co/pagar/{{1}}',
    variables_map: MAPA_ESTANDAR,
  },
  {
    key: 'recordatorio_abono_2',
    language: 'es',
    body_text:
      'Hola, {{1}}. Te recordamos que tu pedido {{2}} está pendiente del abono de {{3}}.\nEn cuanto lo recibamos, lo despachamos. Al recibir pagas {{4}}. Link disponible hasta el {{5}}.',
    footer_text: 'Izao Perfumería',
    button_text: 'Pagar abono',
    button_url: 'https://izaoperfumeria.com/co/pagar/{{1}}',
    variables_map: MAPA_ESTANDAR,
  },
  {
    key: 'recordatorio_abono_final',
    language: 'es',
    body_text:
      'Hola, {{1}}. Tu pedido {{2}} se libera el {{3}} si no recibimos el abono de {{4}}.\nSi aún lo quieres, hazlo desde el botón y lo despachamos de inmediato.',
    footer_text: 'Izao Perfumería',
    button_text: 'Pagar abono',
    button_url: 'https://izaoperfumeria.com/co/pagar/{{1}}',
    variables_map: {
      '1': 'customer_first_name',
      '2': 'order_number',
      '3': 'pay_link_expires_at',
      '4': 'cod_deposit_amount',
      [CLAVE_BOTON]: 'pay_link_token',
    },
  },
];
