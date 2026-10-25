/**
 * Utilidades de prueba de Sistecrédito, sin red. Valores ficticios con la forma del esquema inicial; no
 * representan el formato real de Sistecrédito (D-032). Nunca usar en producción.
 */
export const VALORES_SISTECREDITO_PRUEBA = {
  subscription_key: 'llave-suscripcion-ficticia-0001',
  application_key: 'application-key-ficticia-0001',
  application_token: 'application-token-ficticio-0001',
  merchant_id: 'comercio-ficticio-01',
  store_id: 'tienda-ficticia-01',
} as const;

export interface FetchVigilado {
  fetch: typeof fetch;
  readonly llamadas: number;
}

/** `fetch` que cuenta llamadas y siempre falla: para comprobar que el adaptador no sale a la red. */
export function fetchVigilado(): FetchVigilado {
  let llamadas = 0;
  const f = (async () => {
    llamadas += 1;
    throw new TypeError('red deshabilitada en pruebas');
  }) as typeof fetch;
  return {
    fetch: f,
    get llamadas() {
      return llamadas;
    },
  };
}
