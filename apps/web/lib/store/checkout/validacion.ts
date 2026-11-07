/**
 * Validación del formulario y armado del cuerpo del pedido. Vive aparte de `logica.ts` porque usa `@izao/core/schemas`
 * (reglas de documento, celular y nombre del servidor, con zod ≈ 26 KB gzip): el formulario lo carga con `import()` en cuanto
 * la persona toca un campo, así el JS inicial del checkout no lo trae. Es la misma validación de siempre; el servidor repite todo.
 */
import type { CountryCode } from '@izao/core/money';
import { documentSchemaFor, normalizeName, normalizePhone } from '@izao/core/schemas';
import type { LineaCarrito } from '../carrito/logica';
import { aCodigoCore } from '../pais';
import { TC } from '../textos-checkout';
import type { CuerpoCheckout } from './contrato';
import type { ConfigCheckout, ErroresFormulario, ValoresFormulario } from './tipos';

const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validarFormulario(v: ValoresFormulario, config: ConfigCheckout): ErroresFormulario {
  const pais = config.pais;
  const codigo = aCodigoCore(pais);
  const e: ErroresFormulario = {};
  const T = TC.checkout.errores;

  const nombre = normalizeName(v.nombre);
  if (nombre.length === 0 || nombre.length > 80) e.nombre = T.nombre;
  const apellido = normalizeName(v.apellido);
  if (apellido.length === 0 || apellido.length > 80) e.apellido = T.apellido;

  if (!v.celular.trim()) e.celular = T.obligatorio;
  else if (!normalizePhone(codigo, v.celular)) e.celular = mensajeCelular(codigo);

  const correo = v.correo.trim();
  if (correo && (correo.length > 254 || !CORREO.test(correo))) e.correo = T.correo;

  if (!v.tipoDocumento || !config.tiposDocumento.includes(v.tipoDocumento)) e.tipoDocumento = T.obligatorio;
  else if (!v.numeroDocumento.trim()) e.numeroDocumento = T.obligatorio;
  else {
    const r = documentSchemaFor(codigo).safeParse({ type: v.tipoDocumento, number: v.numeroDocumento });
    if (!r.success) e.numeroDocumento = r.error.issues[0]?.message ?? T.obligatorio;
  }

  if (!v.regionId) e.regionId = T.region[pais];
  if (!v.ciudadId) e.ciudadId = T.ciudad[pais];
  if (v.direccion.trim().length < 3) e.direccion = T.direccion;

  if (!v.metodo) e.metodo = T.metodo;
  if (!v.terminos) e.terminos = T.terminos;
  if (v.metodo === 'cod' && !v.whatsapp) e.whatsapp = T.whatsapp;
  return e;
}

function mensajeCelular(codigo: CountryCode): string {
  return codigo === 'CO' ? 'El celular debe tener 10 dígitos y empezar por 3.' : 'El celular debe tener 9 dígitos y empezar por 9.';
}

const vacioANulo = (s: string): string | null => {
  const t = s.trim();
  return t === '' ? null : t;
};

/** Cuerpo para `POST /api/checkout`: solo variantes y cantidades, nunca precios (regla 2). */
export function armarCuerpo(
  v: ValoresFormulario,
  config: ConfigCheckout,
  lineas: readonly LineaCarrito[],
  codigoDescuento: string | null,
  claveIdempotencia: string,
): CuerpoCheckout {
  if (!v.metodo) throw new Error('Falta el método de pago.');
  return {
    country_code: aCodigoCore(config.pais),
    idempotency_key: claveIdempotencia,
    items: lineas.map((l) => ({ variant_id: l.variantId, quantity: l.cantidad })),
    contact: {
      first_name: normalizeName(v.nombre),
      last_name: normalizeName(v.apellido),
      phone: v.celular.trim(),
      email: vacioANulo(v.correo),
    },
    document: { type: v.tipoDocumento, number: v.numeroDocumento.trim() },
    shipping: {
      region_id: v.regionId,
      city_id: v.ciudadId,
      district: vacioANulo(v.barrio),
      address1: v.direccion.trim(),
      address2: vacioANulo(v.complemento),
      notes: vacioANulo(v.indicaciones),
    },
    payment_method: v.metodo,
    discount_code: codigoDescuento,
    consents: { terms_and_data: true, whatsapp: v.whatsapp },
    data_policy_version: config.versionPoliticaDatos,
  };
}
