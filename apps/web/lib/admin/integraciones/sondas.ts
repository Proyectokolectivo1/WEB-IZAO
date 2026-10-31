/**
 * "Probar conexión" por proveedor (§24.1). Dos implementaciones por adaptador:
 *  - `real`: una lectura inocua contra la API del proveedor con las credenciales guardadas.
 *  - `mock`: sin red; solo comprueba que las credenciales tengan el formato correcto (desarrollo y pruebas).
 * El modo mock se pide con `INTEGRACIONES_MODO=mock` y se ignora en producción. Los mensajes devueltos
 * nunca incluyen los valores secretos.
 */
import { MasterShopClient } from '@izao/mastershop';
import { VERSION_GRAPH_POR_DEFECTO } from '@izao/whatsapp';
import { ErrorWompi, WOMPI_API_BASE, crearClienteWompi } from '@izao/wompi';
import {
  proveedorPorId,
  redactarSecretos,
  validarCredencial,
  type AmbienteIntegracion,
  type PaisIntegracion,
  type ProveedorId,
} from './catalogo';

export type ModoIntegraciones = 'real' | 'mock';
export type ResultadoSonda = { ok: boolean; message: string };
export type EntradaSonda = {
  /** `null` en los proveedores globales (OpenRouter). */
  pais: PaisIntegracion | null;
  ambiente: AmbienteIntegracion;
  valores: Readonly<Record<string, string>>;
};
export type Sonda = (e: EntradaSonda) => Promise<ResultadoSonda>;

/** El mock solo existe fuera de producción. */
export function modoIntegraciones(env: Record<string, string | undefined> = process.env): ModoIntegraciones {
  return env.INTEGRACIONES_MODO === 'mock' && env.NODE_ENV !== 'production' ? 'mock' : 'real';
}

const TIEMPO_MS = 10_000;

async function leer(fetchImpl: typeof fetch, url: string, cabeceras: Record<string, string>): Promise<number | 'red'> {
  try {
    const res = await fetchImpl(url, {
      method: 'GET',
      headers: { accept: 'application/json', ...cabeceras },
      signal: AbortSignal.timeout(TIEMPO_MS),
    });
    return res.status;
  } catch {
    return 'red';
  }
}

function sondaMock(id: ProveedorId): Sonda {
  return async ({ pais, ambiente, valores }) => {
    const proveedor = proveedorPorId(id)!;
    const errores = validarCredencial(proveedor, pais ?? 'global', ambiente, valores);
    if (Object.keys(errores).length > 0) {
      return { ok: false, message: 'Simulación: las credenciales no tienen el formato correcto.' };
    }
    return { ok: true, message: 'Simulación: las credenciales tienen el formato correcto (no se contactó al proveedor).' };
  };
}

const MENSAJE_SOLO_FORMATO =
  'El formato es correcto. No se enviaron eventos de prueba: confirma la recepción en el administrador de eventos del proveedor.';

function sondaSoloFormato(id: ProveedorId): Sonda {
  return async ({ pais, ambiente, valores }) => {
    const errores = validarCredencial(proveedorPorId(id)!, pais ?? 'global', ambiente, valores);
    return Object.keys(errores).length > 0
      ? { ok: false, message: 'Las credenciales no tienen el formato correcto.' }
      : { ok: true, message: MENSAJE_SOLO_FORMATO };
  };
}

function sondasReales(fetchImpl: typeof fetch): Record<ProveedorId, Sonda> {
  return {
    async mastershop({ valores }) {
      const apiKey = valores.api_key?.trim();
      if (!apiKey) return { ok: false, message: 'Falta la llave de API de MasterShop.' };
      return new MasterShopClient({ apiKey, fetch: fetchImpl, timeoutMs: TIEMPO_MS }).testCredentials();
    },

    async wompi({ ambiente, valores }) {
      const base = WOMPI_API_BASE[ambiente];
      // 1) La llave pública se consulta sin autenticación: existe y pertenece al ambiente.
      const publica = await leer(fetchImpl, `${base}/merchants/${encodeURIComponent(valores.public_key ?? '')}`, {});
      if (publica === 'red') return { ok: false, message: 'No se pudo contactar a Wompi. Inténtalo de nuevo.' };
      if (publica === 404 || publica === 403) return { ok: false, message: 'Wompi no reconoce la llave pública.' };
      if (publica !== 200) return { ok: false, message: `Wompi respondió con un error (${publica}).` };
      // 2) La llave privada: una transacción inexistente da 404 si la llave es válida y 401 si no.
      try {
        await crearClienteWompi({
          ambiente,
          llavePrivada: valores.private_key ?? '',
          fetchImpl,
          timeoutMs: TIEMPO_MS,
        }).obtenerTransaccion('izao-prueba-conexion');
        return { ok: true, message: 'Conexión con Wompi correcta.' };
      } catch (e) {
        if (e instanceof ErrorWompi) {
          if (e.codigo === 'NO_ENCONTRADA') return { ok: true, message: 'Conexión con Wompi correcta.' };
          if (e.codigo === 'CREDENCIALES') return { ok: false, message: 'Wompi rechazó la llave privada.' };
          if (e.codigo === 'RED') return { ok: false, message: 'No se pudo contactar a Wompi. Inténtalo de nuevo.' };
        }
        return { ok: false, message: 'Wompi respondió algo inesperado. Inténtalo de nuevo.' };
      }
    },

    async meta_ads({ valores }) {
      // Lectura inocua de la cuenta publicitaria con el token (Graph API: nodo de la cuenta, solo el id).
      const version = VERSION_GRAPH_POR_DEFECTO;
      const cuenta = (valores.ad_account_id ?? '').replace(/^act_/, '');
      const estado = await leer(fetchImpl, `https://graph.facebook.com/${version}/act_${encodeURIComponent(cuenta)}?fields=id`, {
        authorization: `Bearer ${valores.access_token ?? ''}`,
      });
      if (estado === 'red') return { ok: false, message: 'No se pudo contactar a Meta. Inténtalo de nuevo.' };
      if (estado === 200) return { ok: true, message: 'Conexión con Meta Ads correcta.' };
      if (estado === 401 || estado === 403) return { ok: false, message: 'Meta rechazó el token o no tiene acceso a esa cuenta.' };
      if (estado === 400 || estado === 404) return { ok: false, message: 'Meta no encontró esa cuenta publicitaria (revisa el número).' };
      return { ok: false, message: `Meta respondió con un error (${estado}).` };
    },

    // Píxeles: no hay una lectura inocua y documentada que valide el token de eventos sin enviar uno. Se revisa el formato y se
    // dice con claridad; la recepción de eventos se comprueba en el Administrador de eventos de cada plataforma.
    meta_pixel: sondaSoloFormato('meta_pixel'),
    ga4: sondaSoloFormato('ga4'),
    tiktok_pixel: sondaSoloFormato('tiktok_pixel'),

    async openrouter({ valores }) {
      // GET /api/v1/key: informa de la llave actual; con una llave inválida responde 401 (doc de OpenRouter, «Get current API key»).
      const estado = await leer(fetchImpl, 'https://openrouter.ai/api/v1/key', { authorization: `Bearer ${valores.api_key ?? ''}` });
      if (estado === 'red') return { ok: false, message: 'No se pudo contactar a OpenRouter. Inténtalo de nuevo.' };
      if (estado === 200) return { ok: true, message: 'Conexión con OpenRouter correcta.' };
      if (estado === 401 || estado === 403) return { ok: false, message: 'OpenRouter rechazó la llave de API.' };
      return { ok: false, message: `OpenRouter respondió con un error (${estado}).` };
    },

    async whatsapp({ valores }) {
      const version = valores.graph_version?.trim() || VERSION_GRAPH_POR_DEFECTO;
      const id = encodeURIComponent(valores.phone_number_id ?? '');
      const estado = await leer(fetchImpl, `https://graph.facebook.com/${version}/${id}?fields=id`, {
        authorization: `Bearer ${valores.access_token ?? ''}`,
      });
      if (estado === 'red') return { ok: false, message: 'No se pudo contactar a Meta. Inténtalo de nuevo.' };
      if (estado === 200) return { ok: true, message: 'Conexión con WhatsApp correcta.' };
      if (estado === 401 || estado === 403) return { ok: false, message: 'Meta rechazó el token de acceso.' };
      if (estado === 400 || estado === 404) return { ok: false, message: 'Meta no encontró ese número (revisa el Phone number ID).' };
      return { ok: false, message: `Meta respondió con un error (${estado}).` };
    },
  };
}

export function crearSondas(modo: ModoIntegraciones, fetchImpl: typeof fetch = fetch): Record<ProveedorId, Sonda> {
  const base = modo === 'mock' ? { wompi: sondaMock('wompi'), mastershop: sondaMock('mastershop'), whatsapp: sondaMock('whatsapp'), openrouter: sondaMock('openrouter'), meta_ads: sondaMock('meta_ads'), meta_pixel: sondaMock('meta_pixel'), ga4: sondaMock('ga4'), tiktok_pixel: sondaMock('tiktok_pixel') } : sondasReales(fetchImpl);
  // Defensa final: lo que devuelva una sonda se limpia de secretos y se acota.
  const salida = {} as Record<ProveedorId, Sonda>;
  for (const id of Object.keys(base) as ProveedorId[]) {
    salida[id] = async (e) => {
      const r = await base[id](e);
      const texto = redactarSecretos(r.message, proveedorPorId(id)!, e.valores).slice(0, 200);
      return { ok: r.ok, message: texto };
    };
  }
  return salida;
}
