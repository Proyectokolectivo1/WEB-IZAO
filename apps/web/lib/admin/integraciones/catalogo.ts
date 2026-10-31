/**
 * Proveedores con credenciales administrables desde el panel (§24.1, §26.3). Cada uno declara su esquema en
 * `packages/integrations/{proveedor}`; el panel genera el formulario desde ahí. Código puro (sin servidor).
 * Addi y Sistecrédito se agregan aquí cuando existan sus esquemas. OpenRouter es global (sin país); su esquema vive aquí
 * porque no tiene paquete propio (el adaptador del chat está en `lib/store/chat/openrouter.ts`).
 */
import type { CredentialField, CredentialSchema } from '@izao/core/contracts';
import { maskedPreview, validateCredentials } from '@izao/core/contracts';
import { MASTERSHOP_CREDENTIALS, parseMasterShopCredentials } from '@izao/mastershop';
import { WHATSAPP_CREDENTIALS, leerCredencialesWhatsApp } from '@izao/whatsapp';
import { WOMPI_CREDENTIALS, parseWompiCredentials } from '@izao/wompi';
import type { ErroresCampo } from '../crud/comun';

export type PaisIntegracion = 'CO' | 'EC';
export type AmbienteIntegracion = 'sandbox' | 'production';
/** `global` = credencial sin país (`country_code = null`), como OpenRouter. */
export type AmbitoIntegracion = PaisIntegracion | 'global';
export const AMBITO_GLOBAL = 'global' as const;
export type ProveedorId = 'wompi' | 'mastershop' | 'whatsapp' | 'openrouter' | 'meta_ads' | 'meta_pixel' | 'ga4' | 'tiktok_pixel';

/** Esquema de OpenRouter: una sola llave, sin país ni sandbox (la API no tiene entorno de pruebas). */
export const OPENROUTER_CREDENTIALS: CredentialSchema = {
  provider: 'openrouter',
  countries: [],
  environments: ['production'],
  fields: [
    {
      key: 'api_key',
      label: 'Llave de API de OpenRouter',
      secret: true,
      required: true,
      kind: 'text',
      help: 'Se crea en openrouter.ai. Ponle un límite de crédito: es el tope duro del gasto de Iza.',
    },
  ],
};

const SOLO_PRODUCCION = ['production'] as const;

/**
 * Marketing (§22, §23.1). Los campos salen de la especificación: Meta Ads = token de usuario del sistema + cuenta publicitaria
 * por país; Meta Pixel = Pixel ID + token de la API de Conversiones; GA4 = Measurement ID + API secret opcional; TikTok = Pixel ID
 * + token de la Events API. Ninguno tiene sandbox. «Cada uno con interruptor» es el activar/desactivar de la credencial.
 * Los formatos de los identificadores son holgados a propósito (marcados [VERIFICAR] en la bitácora): solo atajan errores de
 * digitación evidentes y no sustituyen la prueba del proveedor.
 */
export const META_ADS_CREDENTIALS: CredentialSchema = {
  provider: 'meta_ads',
  countries: ['CO', 'EC'],
  environments: SOLO_PRODUCCION,
  fields: [
    { key: 'access_token', label: 'Token de usuario del sistema', secret: true, required: true, kind: 'text', help: 'Token con permiso de lectura de anuncios (ads_read).' },
    { key: 'ad_account_id', label: 'Cuenta publicitaria', secret: false, required: true, kind: 'text', help: 'Su número, con o sin el prefijo act_.' },
  ],
};

export const META_PIXEL_CREDENTIALS: CredentialSchema = {
  provider: 'meta_pixel',
  countries: ['CO', 'EC'],
  environments: SOLO_PRODUCCION,
  fields: [
    { key: 'pixel_id', label: 'Pixel ID de Meta', secret: false, required: true, kind: 'text', help: 'Solo números.' },
    { key: 'capi_token', label: 'Token de la API de Conversiones', secret: true, required: true, kind: 'text', help: 'Se genera en el Administrador de eventos de Meta.' },
  ],
};

export const GA4_CREDENTIALS: CredentialSchema = {
  provider: 'ga4',
  countries: ['CO', 'EC'],
  environments: SOLO_PRODUCCION,
  fields: [
    { key: 'measurement_id', label: 'Measurement ID de GA4', secret: false, required: true, kind: 'text', help: 'Empieza por G-.' },
    { key: 'api_secret', label: 'API secret (opcional)', secret: true, required: false, kind: 'text', help: 'Solo si quieres enviar eventos desde el servidor.' },
  ],
};

export const TIKTOK_PIXEL_CREDENTIALS: CredentialSchema = {
  provider: 'tiktok_pixel',
  countries: ['CO', 'EC'],
  environments: SOLO_PRODUCCION,
  fields: [
    { key: 'pixel_id', label: 'Pixel ID de TikTok', secret: false, required: true, kind: 'text' },
    { key: 'events_api_token', label: 'Token de la Events API', secret: true, required: true, kind: 'text', help: 'Se genera en TikTok Events Manager.' },
  ],
};

export type ProveedorPanel = {
  id: ProveedorId;
  nombre: string;
  descripcion: string;
  esquema: CredentialSchema;
  /** `global`: una sola credencial para todo el sitio. Por defecto, una por país. */
  ambito?: 'pais' | 'global';
};

export const PROVEEDORES: readonly ProveedorPanel[] = [
  {
    id: 'wompi',
    nombre: 'Wompi',
    descripcion: 'Pago completo con tarjeta, PSE y otros medios, y link de pago del abono de contra entrega.',
    esquema: WOMPI_CREDENTIALS,
  },
  {
    id: 'mastershop',
    nombre: 'MasterShop',
    descripcion: 'Transportadora: creación de pedidos, guías, etiquetas y estados de envío.',
    esquema: MASTERSHOP_CREDENTIALS,
  },
  {
    id: 'whatsapp',
    nombre: 'WhatsApp Cloud API',
    descripcion: 'Mensajes de cobro y recordatorio del abono, y plantillas aprobadas por Meta.',
    esquema: WHATSAPP_CREDENTIALS,
  },
  {
    id: 'openrouter',
    nombre: 'OpenRouter (Iza)',
    descripcion: 'Modelos de lenguaje del chatbot Iza. Una llave para todo el sitio.',
    esquema: OPENROUTER_CREDENTIALS,
    ambito: 'global',
  },
  {
    id: 'meta_ads',
    nombre: 'Meta Ads (pauta)',
    descripcion: 'Trae la inversión diaria de cada cuenta publicitaria para el gasto «Pauta Meta» y el ROAS.',
    esquema: META_ADS_CREDENTIALS,
  },
  {
    id: 'meta_pixel',
    nombre: 'Meta Pixel y API de Conversiones',
    descripcion: 'Eventos de la tienda para Meta (navegador y servidor). El interruptor es activar o desactivar la credencial.',
    esquema: META_PIXEL_CREDENTIALS,
  },
  {
    id: 'ga4',
    nombre: 'Google Analytics 4',
    descripcion: 'Medición de la tienda en GA4, con el API secret opcional para eventos del servidor.',
    esquema: GA4_CREDENTIALS,
  },
  {
    id: 'tiktok_pixel',
    nombre: 'TikTok Pixel y Events API',
    descripcion: 'Eventos de la tienda para TikTok (navegador y servidor).',
    esquema: TIKTOK_PIXEL_CREDENTIALS,
  },
];

export function esGlobal(p: ProveedorPanel): boolean {
  return p.ambito === 'global';
}

/** Ámbitos en que se configura un proveedor: sus países, o `global`. */
export function ambitosDe(p: ProveedorPanel): readonly AmbitoIntegracion[] {
  return esGlobal(p) ? [AMBITO_GLOBAL] : p.esquema.countries;
}

export function esAmbito(v: unknown): v is AmbitoIntegracion {
  return v === AMBITO_GLOBAL || esPais(v);
}

/** Valor de `country_code` en la base para un ámbito (`global` → `null`). */
export function paisDb(ambito: AmbitoIntegracion): PaisIntegracion | null {
  return ambito === AMBITO_GLOBAL ? null : ambito;
}

export const ETIQUETA_AMBIENTE: Record<AmbienteIntegracion, string> = {
  sandbox: 'Pruebas (sandbox)',
  production: 'Producción',
};

export function proveedorPorId(id: string): ProveedorPanel | null {
  return PROVEEDORES.find((p) => p.id === id) ?? null;
}

export function esPais(v: unknown): v is PaisIntegracion {
  return v === 'CO' || v === 'EC';
}

export function esAmbiente(v: unknown): v is AmbienteIntegracion {
  return v === 'sandbox' || v === 'production';
}

/** Campos del formulario de un proveedor: solo metadatos, nunca valores. */
export function camposDe(proveedor: ProveedorPanel): readonly CredentialField[] {
  return proveedor.esquema.fields;
}

/**
 * Valida país, ambiente y valores. Devuelve errores por campo (`form` para los generales); los mensajes nunca
 * incluyen el valor escrito.
 */
export function validarCredencial(
  proveedor: ProveedorPanel,
  pais: string,
  ambiente: string,
  valores: Readonly<Record<string, string>>,
): ErroresCampo {
  const errores: ErroresCampo = {};
  const ambitoValido = esGlobal(proveedor)
    ? pais === AMBITO_GLOBAL
    : esPais(pais) && proveedor.esquema.countries.includes(pais);
  if (!ambitoValido) {
    errores.pais = esGlobal(proveedor) ? `${proveedor.nombre} es global: no se configura por país.` : `${proveedor.nombre} no está disponible para ese país.`;
  }
  if (!esAmbiente(ambiente) || !proveedor.esquema.environments.includes(ambiente)) {
    errores.ambiente = `${proveedor.nombre} no admite ese ambiente.`;
  }
  if (Object.keys(errores).length > 0) return errores;

  for (const p of validateCredentials(proveedor.esquema, valores)) errores[p.key] ??= p.message;
  if (Object.keys(errores).length > 0) return errores;

  if (proveedor.id === 'wompi') {
    const r = parseWompiCredentials(valores, ambiente as AmbienteIntegracion);
    if (!r.ok) for (const p of r.problemas) errores[p.key === '*' ? 'form' : p.key] ??= p.message;
  } else if (proveedor.id === 'mastershop') {
    if (parseMasterShopCredentials(valores) === null) errores.api_key = 'La llave de API no es válida.';
  } else if (proveedor.id === 'meta_ads') {
    if (!/^(act_)?\d{5,20}$/.test(valores.ad_account_id ?? '')) errores.ad_account_id = 'La cuenta publicitaria es un número (con o sin act_).';
    if (/\s/.test(valores.access_token ?? '')) errores.access_token = 'El token no debe llevar espacios.';
  } else if (proveedor.id === 'meta_pixel') {
    if (!/^\d{5,20}$/.test(valores.pixel_id ?? '')) errores.pixel_id = 'El Pixel ID de Meta son solo números.';
    if (/\s/.test(valores.capi_token ?? '')) errores.capi_token = 'El token no debe llevar espacios.';
  } else if (proveedor.id === 'ga4') {
    if (!/^G-[A-Za-z0-9]{4,20}$/.test(valores.measurement_id ?? '')) errores.measurement_id = 'El Measurement ID empieza por G- (por ejemplo G-ABC123XYZ).';
    if (/\s/.test(valores.api_secret ?? '')) errores.api_secret = 'El API secret no debe llevar espacios.';
  } else if (proveedor.id === 'tiktok_pixel') {
    if (!/^[A-Za-z0-9]{6,40}$/.test(valores.pixel_id ?? '')) errores.pixel_id = 'El Pixel ID de TikTok son letras y números, sin espacios.';
    if (/\s/.test(valores.events_api_token ?? '')) errores.events_api_token = 'El token no debe llevar espacios.';
  } else if (proveedor.id === 'openrouter') {
    const llave = valores.api_key ?? '';
    if (llave.length < 16 || /\s/.test(llave)) errores.api_key = 'La llave de OpenRouter no parece válida (sin espacios, mínimo 16 caracteres).';
  } else if (proveedor.id === 'whatsapp') {
    if (leerCredencialesWhatsApp(valores) === null) {
      errores.phone_number_id = 'Revisa los identificadores (solo números) y la versión de Graph (p. ej. v26.0).';
    }
  }
  return errores;
}

/**
 * Valores nuevos + guardados: un campo secreto en blanco conserva el valor guardado (nunca se reenvía al
 * navegador); los demás campos en blanco se vacían. Solo se conservan claves del esquema.
 */
export function mezclarConGuardados(
  proveedor: ProveedorPanel,
  nuevos: Readonly<Record<string, string>>,
  guardados: Readonly<Record<string, string>> | null,
): Record<string, string> {
  const salida: Record<string, string> = {};
  for (const campo of proveedor.esquema.fields) {
    const nuevo = (nuevos[campo.key] ?? '').trim();
    if (nuevo !== '') salida[campo.key] = nuevo;
    else if (campo.secret && guardados?.[campo.key]) salida[campo.key] = guardados[campo.key]!;
  }
  return salida;
}

/** `masked_preview` del esquema: secretos con los últimos 4 caracteres, el resto tal cual. */
export function vistaPrevia(proveedor: ProveedorPanel, valores: Readonly<Record<string, string>>): Record<string, string> {
  return maskedPreview(proveedor.esquema, valores);
}

/** Quita de un texto cualquier valor secreto que contenga (los mensajes del proveedor no deben filtrarlos). */
export function redactarSecretos(
  texto: string,
  proveedor: ProveedorPanel,
  valores: Readonly<Record<string, string>>,
): string {
  let salida = texto;
  for (const campo of proveedor.esquema.fields) {
    const v = valores[campo.key];
    if (campo.secret && v && v.length >= 4) salida = salida.split(v).join('****');
  }
  return salida;
}
