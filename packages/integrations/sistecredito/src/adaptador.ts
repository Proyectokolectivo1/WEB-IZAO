/**
 * Adaptador de Sistecrédito en modo seguro (D-032). Sistecrédito no publica documentación técnica abierta y el
 * dueño aún no entrega la de su contrato (`[VERIFICAR]`, §12.4), así que:
 * - No hay endpoints, formatos de monto, estados ni esquema de autenticación del webhook: nada se inventa.
 * - `crearCheckoutSistecredito` falla con `NO_VERIFICADO` (no reintentable): el checkout debe ocultar el método o
 *   devolver al cliente a elegir otro; nunca se crea un pedido pagable con este método.
 * - `verificarWebhookSistecredito` rechaza todo: sin autenticación verificada no se confía en ninguna notificación,
 *   así que ningún pedido puede pasar a `pagado` por esta vía.
 * - Ninguna función sale a la red.
 */
import type { SistecreditoCredentials } from './credentials';

export const ESTADO_INTEGRACION_SISTECREDITO = 'pendiente_documentacion' as const;

export type CodigoErrorSistecredito = 'NO_VERIFICADO';

export class ErrorSistecredito extends Error {
  readonly codigo: CodigoErrorSistecredito;
  readonly reintentable: boolean;
  constructor(codigo: CodigoErrorSistecredito, reintentable: boolean) {
    super(`Sistecrédito: ${codigo}`);
    this.name = 'ErrorSistecredito';
    this.codigo = codigo;
    this.reintentable = reintentable;
  }
}

export interface OpcionesAdaptadorSistecredito {
  /** Se acepta para fijar la firma futura; hoy nunca se usa. */
  fetchImpl?: typeof fetch;
}

const MENSAJE_PENDIENTE = 'La integración con Sistecrédito está pendiente de la documentación oficial del contrato.';

/** "Probar conexión" del panel. Las credenciales ya fueron validadas contra el esquema. */
export async function probarCredencialesSistecredito(
  _credenciales: SistecreditoCredentials,
  _o: OpcionesAdaptadorSistecredito = {},
): Promise<{ ok: boolean; message: string }> {
  return { ok: false, message: MENSAJE_PENDIENTE };
}

/** Crear la transacción de crédito. Hasta tener la documentación oficial, siempre falla sin red. */
export async function crearCheckoutSistecredito(
  _credenciales: SistecreditoCredentials,
  _o: OpcionesAdaptadorSistecredito = {},
): Promise<{ url: string; referencia: string }> {
  throw new ErrorSistecredito('NO_VERIFICADO', false);
}

export type ResultadoWebhookSistecredito = { ok: false; motivo: 'no_verificado' };

/** Webhook de Sistecrédito: sin esquema de autenticación verificado, se rechaza siempre. */
export function verificarWebhookSistecredito(
  _crudo: Uint8Array,
  _cabeceras: Readonly<Record<string, string>>,
): ResultadoWebhookSistecredito {
  return { ok: false, motivo: 'no_verificado' };
}
