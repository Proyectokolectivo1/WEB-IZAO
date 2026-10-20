/**
 * Adaptador simulado de WhatsApp para pruebas y desarrollo sin credenciales: no hace red. Nunca usar en producción.
 */
import type { ClienteWhatsApp, ErrorWhatsApp } from '../cliente';
import type { MensajePlantillaMeta, SolicitudPlantillaMeta } from '../plantillas';

export const TOKEN_PRUEBA = 'EAAG_token_ficticio_para_pruebas';

export interface WhatsAppMock extends ClienteWhatsApp {
  enviados: MensajePlantillaMeta[];
  plantillas: SolicitudPlantillaMeta[];
  /** Si se define, el siguiente envío (y los demás) fallan con este error. */
  fallarCon: ErrorWhatsApp | null;
}

export function crearWhatsAppMock(): WhatsAppMock {
  let n = 0;
  const m: WhatsAppMock = {
    enviados: [],
    plantillas: [],
    fallarCon: null,
    async enviarPlantilla(msg) {
      if (m.fallarCon) throw m.fallarCon;
      m.enviados.push(structuredClone(msg));
      n += 1;
      return { wa_message_id: `wamid.mock.${n}` };
    },
    async crearPlantilla(s) {
      if (m.fallarCon) throw m.fallarCon;
      m.plantillas.push(structuredClone(s));
      return { meta_template_id: String(900_000 + m.plantillas.length), status: 'PENDING' };
    },
  };
  return m;
}
