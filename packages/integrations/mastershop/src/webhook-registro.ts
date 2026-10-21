/**
 * Registro de webhooks con un clic desde el panel (§14.2, skill izao-mastershop): suscribe los eventos 16 y 17
 * con `idProduct: null` a `https://{dominio}/api/webhooks/mastershop/{MASTERSHOP_WEBHOOK_PATH_SECRET}`.
 * Devuelve los `idProductWebhook` para guardarlos (no se pueden listar después). La URL lleva el secreto de ruta:
 * quien llama no la registra en logs ni la devuelve al navegador.
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

/** Registra cada evento de Izao omitiendo los que ya tienen `idProductWebhook` guardado. */
export async function registrarWebhooksIzao(
  client: MasterShopClient,
  url: string,
  yaRegistrados: ReadonlySet<number> = new Set(),
): Promise<WebhookRegistrado[]> {
  const r: WebhookRegistrado[] = [];
  for (const w of IZAO_WEBHOOKS) {
    if (yaRegistrados.has(w.idWebhook)) continue;
    r.push(await client.registerWebhook({ name: NOMBRE_WEBHOOK_IZAO, webhookName: w.webhookName, url, idWebhook: w.idWebhook }));
  }
  return r;
}
