/**
 * Datos del job `whatsapp.evento` (dueño: izao-pagos). `evento.ts` solo habla con esta interfaz; la implementación
 * PostgREST va aparte y las pruebas usan una en memoria.
 */
import type { CountryCode } from '@izao/core/money';
import type { FuenteCod, MensajeFila } from '../cod/fuente.js';

export type EstadoMensajeFila = MensajeFila['status'];

export interface MensajeWa {
  id: string;
  order_id: string | null;
  status: EstadoMensajeFila;
  /** `whatsapp_templates.key` (vacío si la plantilla se borró). */
  template_key: string;
}

export type EstadoMetaPlantilla = 'draft' | 'pending' | 'approved' | 'rejected' | 'paused';

export interface PlantillaFila {
  id: string;
  key: string;
  country_code: CountryCode;
  version: number;
  meta_status: EstadoMetaPlantilla;
  is_active: boolean;
  meta_template_id: string | null;
}

export interface FuenteEventosWa extends Pick<FuenteCod, 'pedido' | 'payLink' | 'registrarAlerta'> {
  /** `webhook_events` (provider `whatsapp`): el payload es el `EventoWhatsApp` que guardó el webhook. */
  evento(eventId: string): Promise<{ payload: unknown; procesado: boolean } | null>;
  marcarEvento(eventId: string, r: { ok: true } | { ok: false; error: string }): Promise<void>;
  mensajePorWamid(wamid: string): Promise<MensajeWa | null>;
  /** Cambia el estado solo si el actual está en `desde` (update condicional); devuelve si cambió. */
  actualizarMensaje(
    id: string,
    desde: readonly EstadoMensajeFila[],
    cambio: { status: EstadoMensajeFila; error_code?: string; error_text?: string },
  ): Promise<boolean>;
  /** Por `meta_template_id`; si no, por nombre e idioma cuando hay exactamente una fila. */
  plantillaPorMeta(metaId: string, nombre: string, idioma: string): Promise<PlantillaFila | null>;
  plantillaActivaDe(key: string, pais: CountryCode): Promise<PlantillaFila | null>;
  actualizarPlantilla(
    id: string,
    c: { meta_status: EstadoMetaPlantilla; meta_rejection_reason: string | null; meta_template_id?: string },
  ): Promise<void>;
  /** Desactiva la versión activa de (key, país) y activa esta como `approved`. */
  activarPlantilla(p: PlantillaFila, metaId: string): Promise<void>;
}
