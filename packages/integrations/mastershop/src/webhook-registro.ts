/**
 * Registro de webhooks con un clic desde el panel (§14.2, skill izao-mastershop): suscribe los eventos 16 y 17
 * con `idProduct: null` a `https://{dominio}/api/webhooks/mastershop/{MASTERSHOP_WEBHOOK_PATH_SECRET}`.
 * Cada `idProductWebhook` se guarda en el almacén (`integration_webhooks`) apenas se registra: no se puede listar
 * después. La URL lleva el secreto de ruta: no se guarda, no se registra en logs ni se devuelve al navegador.
 */
import { IZAO_WEBHOOKS, type MasterShopClient, type WebhookRegistrado } from './client';
import { MasterShopError } from './errors';

export const NOMBRE_WEBHOOK_IZAO = 'Izao Perfumeria';

export function urlWebhookIzao(origen: string, secreto: string): string {
  if (!/^[A-Za-z0-9_-]{32,}$/.test(secreto)) {
    throw new MasterShopError({ kind: 'validacion', message: 'MASTERSHOP_WEBHOOK_PATH_SECRET debe tener al menos 32 caracteres seguros.' });
  }
  const u = new URL(origen);
  if (u.protocol !== 'https:') throw new MasterShopError({ kind: 'validacion', message: 'El origen del webhook debe ser https.' });
  return `${u.origin}/api/webhooks/mastershop/${secreto}`;
}

export interface WebhookGuardado extends WebhookRegistrado {
  eventName: string;
}

/** Persistencia de las suscripciones (`integration_webhooks` en la web; memoria en pruebas). */
export interface AlmacenWebhooks {
  /** `event_id` (= `idWebhook`) ya registrados. */
  registrados(): Promise<ReadonlySet<number>>;
  guardar(w: WebhookGuardado): Promise<void>;
}

/**
 * Registra cada evento de Izao que el almacén no tenga y lo guarda enseguida (si falla el segundo, el primero ya
 * quedó guardado y un nuevo clic solo registra el que falta). Devuelve los registrados en esta llamada.
 */
export async function registrarWebhooksIzao(
  client: MasterShopClient,
  url: string,
  almacen: AlmacenWebhooks,
): Promise<WebhookGuardado[]> {
  const ya = await almacen.registrados();
  const r: WebhookGuardado[] = [];
  for (const w of IZAO_WEBHOOKS) {
    if (ya.has(w.idWebhook)) continue;
    const reg = await client.registerWebhook({ name: NOMBRE_WEBHOOK_IZAO, webhookName: w.webhookName, url, idWebhook: w.idWebhook });
    const guardado = { ...reg, eventName: w.webhookName };
    await almacen.guardar(guardado);
    r.push(guardado);
  }
  return r;
}
