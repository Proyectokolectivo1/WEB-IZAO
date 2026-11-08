/**
 * Registro de los webhooks de MasterShop desde el panel (SOLO SERVIDOR; izao-admin lo conecta al botón y pasa la
 * llave ya descifrada). Guarda cada `idProductWebhook` en `integration_webhooks` (event_id = idWebhook,
 * external_id = idProductWebhook); los ya guardados no se vuelven a registrar. La URL (lleva
 * `MASTERSHOP_WEBHOOK_PATH_SECRET`) no se guarda ni se devuelve.
 */
import 'server-only';
import { MasterShopClient, registrarWebhooksIzao, urlWebhookIzao, type AlmacenWebhooks } from '@izao/mastershop';
import { clienteDb } from '@/lib/db/cliente';

export type AmbienteWebhook = 'sandbox' | 'production';
/** Cada país tiene su propio negocio y su propia llave en MasterShop (D-052): los webhooks se registran por país. */
export type PaisWebhook = 'CO' | 'EC';

/** Lo mínimo del cliente de Supabase que usa el almacén (inyectable en pruebas). */
export interface DbWebhooks {
  from(tabla: 'integration_webhooks'): {
    select(columnas: 'event_id'): {
      eq(c: 'provider', v: string): { eq(c: 'country_code', v: string): { eq(c: 'environment', v: string): PromiseLike<{ data: { event_id: number }[] | null; error: { code?: string } | null }> } };
    };
    upsert(
      fila: { provider: string; country_code: string; environment: string; event_id: number; event_name: string; external_id: number; is_enabled: boolean },
      opciones: { onConflict: string },
    ): PromiseLike<{ error: { code?: string } | null }>;
  };
}

export function almacenWebhooksSupabase(
  ambiente: AmbienteWebhook,
  db: DbWebhooks = clienteDb() as unknown as DbWebhooks,
  pais: PaisWebhook = 'CO',
): AlmacenWebhooks {
  return {
    async registrados() {
      const { data, error } = await db.from('integration_webhooks').select('event_id').eq('provider', 'mastershop').eq('country_code', pais).eq('environment', ambiente);
      if (error) throw new Error(`integration_webhooks: ${error.code ?? 'error'}`);
      return new Set((data ?? []).map((r) => r.event_id));
    },
    async guardar(w) {
      const { error } = await db.from('integration_webhooks').upsert(
        {
          provider: 'mastershop',
          country_code: pais,
          environment: ambiente,
          event_id: w.idWebhook,
          event_name: w.eventName,
          external_id: w.idProductWebhook,
          is_enabled: w.enabled,
        },
        { onConflict: 'provider,country_code,environment,event_id' },
      );
      if (error) throw new Error(`integration_webhooks: ${error.code ?? 'error'}`);
    },
  };
}

export interface ResultadoRegistroWebhooks {
  registrados: { idWebhook: number; eventName: string }[];
}

/**
 * Registra 16 y 17 con la llave activa de MasterShop del país (`opciones.pais`, defecto CO). Misma URL para los dos
 * países: el job reconsulta cada pedido con la llave de su propio país. `SITE_URL` y `MASTERSHOP_WEBHOOK_PATH_SECRET`
 * del entorno.
 */
export async function registrarWebhooksMasterShop(
  apiKey: string,
  ambiente: AmbienteWebhook,
  opciones: { pais?: PaisWebhook; almacen?: AlmacenWebhooks; client?: MasterShopClient; env?: Record<string, string | undefined> } = {},
): Promise<ResultadoRegistroWebhooks> {
  const env = opciones.env ?? process.env;
  if (!env.SITE_URL || !env.MASTERSHOP_WEBHOOK_PATH_SECRET) throw new Error('Faltan SITE_URL o MASTERSHOP_WEBHOOK_PATH_SECRET');
  const url = urlWebhookIzao(env.SITE_URL, env.MASTERSHOP_WEBHOOK_PATH_SECRET);
  const r = await registrarWebhooksIzao(
    opciones.client ?? new MasterShopClient({ apiKey }),
    url,
    opciones.almacen ?? almacenWebhooksSupabase(ambiente, undefined, opciones.pais ?? 'CO'),
  );
  return { registrados: r.map((w) => ({ idWebhook: w.idWebhook, eventName: w.eventName })) };
}
