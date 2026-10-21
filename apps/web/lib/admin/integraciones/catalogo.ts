/**
 * Proveedores con credenciales administrables desde el panel (§24.1, §26.3). Cada uno declara su esquema en
 * `packages/integrations/{proveedor}`; el panel genera el formulario desde ahí. Código puro (sin servidor).
 * Addi, Sistecrédito, OpenRouter y Meta Ads se agregan aquí cuando existan sus esquemas.
 */
import type { CredentialField, CredentialSchema } from '@izao/core/contracts';
import { maskedPreview, validateCredentials } from '@izao/core/contracts';
import { MASTERSHOP_CREDENTIALS, parseMasterShopCredentials } from '@izao/mastershop';
import { WHATSAPP_CREDENTIALS, leerCredencialesWhatsApp } from '@izao/whatsapp';
import { WOMPI_CREDENTIALS, parseWompiCredentials } from '@izao/wompi';
import type { ErroresCampo } from '../crud/comun';

export type PaisIntegracion = 'CO' | 'EC';
export type AmbienteIntegracion = 'sandbox' | 'production';
export type ProveedorId = 'wompi' | 'mastershop' | 'whatsapp';

export type ProveedorPanel = {
  id: ProveedorId;
  nombre: string;
  descripcion: string;
  esquema: CredentialSchema;
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
];

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
  if (!esPais(pais) || !proveedor.esquema.countries.includes(pais)) {
    errores.pais = `${proveedor.nombre} no está disponible para ese país.`;
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
