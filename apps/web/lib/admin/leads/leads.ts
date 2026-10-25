/**
 * Leads (§9.3, §24.1): filtros de la lista y de la exportación. Código puro. Son datos personales captados por los
 * pop-ups con consentimiento: solo el administrador los ve y cada exportación queda en la auditoría.
 */
import { esFechaIso } from '@izao/core/metrics';

export type FiltrosLead = {
  q: string;
  pagina: number;
  pais: 'CO' | 'EC' | '';
  /** Id del pop-up de origen. */
  popup: string;
  convertido: 'si' | 'no' | '';
  optin: 'si' | 'no' | '';
  desde: string;
  hasta: string;
};

type Buscables = Record<string, string | string[] | undefined>;
const primero = (v: string | string[] | undefined): string => ((Array.isArray(v) ? v[0] : v) ?? '').trim();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sino = (v: string): 'si' | 'no' | '' => (v === 'si' || v === 'no' ? v : '');

export function leerFiltrosLead(sp: Buscables): FiltrosLead {
  const pais = primero(sp.pais).toUpperCase();
  let desde = primero(sp.desde);
  let hasta = primero(sp.hasta);
  if (!esFechaIso(desde)) desde = '';
  if (!esFechaIso(hasta)) hasta = '';
  if (desde && hasta && desde > hasta) [desde, hasta] = [hasta, desde];
  const popup = primero(sp.popup);
  const n = Number.parseInt(primero(sp.page), 10);
  return {
    q: primero(sp.q).slice(0, 100),
    pagina: Number.isFinite(n) && n >= 1 && n <= 10000 ? n : 1,
    pais: pais === 'CO' || pais === 'EC' ? pais : '',
    popup: UUID.test(popup) ? popup : '',
    convertido: sino(primero(sp.convertido)),
    optin: sino(primero(sp.optin)),
    desde,
    hasta,
  };
}

export function parametrosDeFiltrosLead(f: FiltrosLead): Record<string, string> {
  const salida: Record<string, string> = {};
  for (const k of ['q', 'pais', 'popup', 'convertido', 'optin', 'desde', 'hasta'] as const) if (f[k]) salida[k] = f[k];
  return salida;
}

export type BusquedaLead = { campo: 'email' | 'phone_e164'; patron: string };

/** Con `@` busca por correo; con 4 o más dígitos, por celular. Otro texto no coincide con nada. */
export function interpretarBusquedaLead(q: string): BusquedaLead | null {
  const t = q.trim();
  if (!t) return null;
  if (t.includes('@')) return { campo: 'email', patron: t.toLowerCase() };
  const digitos = t.replace(/\D/g, '');
  if (/^\+?[\d\s-]+$/.test(t) && digitos.length >= 4) return { campo: 'phone_e164', patron: digitos };
  return { campo: 'email', patron: t.toLowerCase() };
}

/** Fuente de la captación a partir de las UTM guardadas (`utm_source`/`source` y `utm_campaign`/`campaign`). */
export function fuenteDeLead(utm: unknown): string {
  if (!utm || typeof utm !== 'object') return '';
  const u = utm as Record<string, unknown>;
  const t = (...ks: string[]) => {
    for (const k of ks) if (typeof u[k] === 'string' && (u[k] as string).trim() !== '') return (u[k] as string).trim().slice(0, 60);
    return '';
  };
  const origen = t('utm_source', 'source');
  const campana = t('utm_campaign', 'campaign');
  return [origen, campana].filter(Boolean).join(' / ');
}
