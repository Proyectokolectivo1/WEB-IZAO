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
  pais: PaisIntegracion;
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
    const errores = validarCredencial(proveedor, pais, ambiente, valores);
    if (Object.keys(errores).length > 0) {
      return { ok: false, message: 'Simulación: las credenciales no tienen el formato correcto.' };
    }
    return { ok: true, message: 'Simulación: las credenciales tienen el formato correcto (no se contactó al proveedor).' };
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
  const base = modo === 'mock' ? { wompi: sondaMock('wompi'), mastershop: sondaMock('mastershop'), whatsapp: sondaMock('whatsapp') } : sondasReales(fetchImpl);
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
