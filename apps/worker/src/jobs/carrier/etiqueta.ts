/**
 * Job `carrier.poll_label` (§14.5 paso 3): cada 2 min, mientras el pedido esté confirmado y sin etiqueta,
 * consulta `GET /api/orders` y copia guía, rastreo y estado a `shipments`. Cuando aparece `shippingLabel`
 * descarga el PDF a `MEDIA_ROOT/labels/` y crea el `print_job`. Cada consulta es un job nuevo con id fijo
 * `carrier.poll_label.{id}.{n}`; tras `LABEL_POLL_MAX_ATTEMPTS` se alerta al admin y se deja de consultar
 * (la sincronización por webhook sigue guardando la etiqueta si llega después).
 */
import { LABEL_POLL_INTERVAL_MS, LABEL_POLL_MAX_ATTEMPTS, type DatosJobEtiqueta } from '@izao/mastershop';
import {
  ACTOR_SISTEMA,
  ESPERAN_ETIQUETA,
  errorParaEvento,
  esReintentable,
  guardarEtiqueta,
  guardarRemoto,
  type DepsCarrier,
} from './comun.js';

export type AccionEtiqueta =
  | 'guardada'
  | 'ya_guardada'
  | 'remota'
  | 'sin_etiqueta'
  | 'consulta_programada'
  | 'agotado'
  | 'cancelado'
  | 'fuera_de_fase'
  | 'sin_envio'
  | 'sin_credenciales'
  | 'error';

export async function procesarEtiqueta(
  datos: DatosJobEtiqueta,
  deps: DepsCarrier,
): Promise<{ accion: AccionEtiqueta; order_id: string }> {
  const r = (accion: AccionEtiqueta) => ({ accion, order_id: datos.order_id });
  const pedido = await deps.fuente.pedido(datos.order_id);
  if (!pedido || !ESPERAN_ETIQUETA.has(pedido.status)) return r('fuera_de_fase');
  const envio = await deps.fuente.envio(pedido.id);
  if (!envio || envio.provider_order_id === null) return r('sin_envio');
  if (envio.label_local_path) return r(await guardarEtiqueta(deps, pedido.id, pedido.number, envio, ACTOR_SISTEMA));

  const creds = await deps.fuente.credenciales(pedido.country_code);
  if (!creds) {
    await deps.fuente.registrarEvento(pedido.id, 'alerta', ACTOR_SISTEMA, { motivo: 'sin_credenciales', etapa: 'etiqueta' });
    return r('sin_credenciales');
  }

  const siguiente = async (e: unknown = null): Promise<AccionEtiqueta> => {
    if (datos.intento + 1 >= LABEL_POLL_MAX_ATTEMPTS) {
      await deps.fuente.registrarEvento(pedido.id, 'alerta', ACTOR_SISTEMA, {
        motivo: 'etiqueta_no_disponible',
        intentos: datos.intento + 1,
        error: e === null ? null : errorParaEvento(e),
      });
      return 'agotado';
    }
    await deps.programar.etiqueta(pedido.id, datos.intento + 1, LABEL_POLL_INTERVAL_MS);
    return e === null ? 'sin_etiqueta' : 'consulta_programada';
  };

  try {
    const remoto = await deps.transportadora(creds, undefined, pedido.country_code).getOrder({ providerOrderId: envio.provider_order_id });
    const actualizado = await guardarRemoto(deps, pedido.id, pedido.number, envio, remoto, 'poll_label');
    if (remoto.statusId === 9) return r('cancelado');
    if (!actualizado.label_url) return r(await siguiente());
    return r(await guardarEtiqueta(deps, pedido.id, pedido.number, actualizado, ACTOR_SISTEMA));
  } catch (e) {
    if (esReintentable(e)) return r(await siguiente(e));
    await deps.fuente.registrarEvento(pedido.id, 'alerta', ACTOR_SISTEMA, {
      motivo: 'etiqueta_error',
      error: errorParaEvento(e),
    });
    return r('error');
  }
}
