/** Hoja de Excel de leads (§24.1). Pura: recibe las filas ya leídas. Correos y celulares salen como texto. */
import type { Hoja } from '../excel/libro';
import { fuenteDeLead } from './leads';
import type { FilaLead } from './servidor';

export function hojaLeads(filas: readonly FilaLead[]): Hoja {
  return {
    nombre: 'Leads',
    columnas: [
      { titulo: 'Fecha', ancho: 20 },
      { titulo: 'País' },
      { titulo: 'Correo', ancho: 32 },
      { titulo: 'Celular', ancho: 18 },
      { titulo: 'Pop-up', ancho: 26 },
      { titulo: 'Código entregado', ancho: 20 },
      { titulo: 'Acepta mercadeo' },
      { titulo: 'Consentimiento', ancho: 20 },
      { titulo: 'Versión del texto', ancho: 18 },
      { titulo: 'Fuente', ancho: 28 },
      { titulo: 'Compró' },
    ],
    filas: filas.map((l) => [
      l.created_at.slice(0, 19).replace('T', ' '),
      l.country_code,
      l.email ?? '',
      l.phone_e164 ?? '',
      l.popups?.name ?? '',
      l.discount_codes?.code ?? '',
      l.marketing_opt_in ? 'Sí' : 'No',
      l.consent_at.slice(0, 19).replace('T', ' '),
      l.consent_text_version,
      fuenteDeLead(l.utm),
      l.converted_order_id ? 'Sí' : 'No',
    ]),
  };
}
