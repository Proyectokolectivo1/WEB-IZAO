import 'server-only';
/**
 * Leads (§9.3, §24.1) con el cliente de servicio: lista con filtros y lectura completa para la exportación. Solo lectura
 * (los leads los crea el pop-up y se borran por habeas data desde Clientes). La exportación se audita desde la ruta.
 */
import { inicioDiaBogotaUtc, sumarDias } from '@izao/core/metrics';
import type { Cliente } from '../catalogo/taxonomias-servidor';
import { escaparBusqueda, rangoPagina } from '../crud/comun';
import { interpretarBusquedaLead, type FiltrosLead } from './leads';

export type FilaLead = {
  id: string;
  country_code: 'CO' | 'EC';
  email: string | null;
  phone_e164: string | null;
  popup_id: string | null;
  consent_at: string;
  consent_text_version: string;
  marketing_opt_in: boolean;
  utm: unknown;
  converted_order_id: string | null;
  created_at: string;
  popups: { name: string } | null;
  discount_codes: { code: string } | null;
};

const COLUMNAS =
  'id, country_code, email, phone_e164, popup_id, consent_at, consent_text_version, marketing_opt_in, utm, converted_order_id, created_at, popups(name), discount_codes(code)';
const unico = <T>(v: T[] | T | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
const normal = (f: FilaLead): FilaLead => ({
  ...f,
  popups: unico(f.popups as FilaLead['popups'] | FilaLead['popups'][]),
  discount_codes: unico(f.discount_codes as FilaLead['discount_codes'] | FilaLead['discount_codes'][]),
});

function aplicarFiltros<
  Q extends {
    eq: (c: string, v: unknown) => Q;
    is: (c: string, v: null) => Q;
    not: (c: string, op: string, v: null) => Q;
    gte: (c: string, v: unknown) => Q;
    lt: (c: string, v: unknown) => Q;
    ilike: (c: string, v: string) => Q;
  },
>(q: Q, f: FiltrosLead): Q {
  let r = q;
  if (f.pais) r = r.eq('country_code', f.pais);
  if (f.popup) r = r.eq('popup_id', f.popup);
  if (f.convertido === 'si') r = r.not('converted_order_id', 'is', null);
  if (f.convertido === 'no') r = r.is('converted_order_id', null);
  if (f.optin) r = r.eq('marketing_opt_in', f.optin === 'si');
  if (f.desde) r = r.gte('created_at', inicioDiaBogotaUtc(f.desde).toISOString());
  if (f.hasta) r = r.lt('created_at', inicioDiaBogotaUtc(sumarDias(f.hasta, 1)).toISOString());
  const b = interpretarBusquedaLead(f.q);
  if (b) r = r.ilike(b.campo, `%${escaparBusqueda(b.patron)}%`);
  return r;
}

export async function listarLeads(cliente: Cliente, f: FiltrosLead): Promise<{ filas: FilaLead[]; total: number }> {
  const [desde, hasta] = rangoPagina(f.pagina);
  const base = cliente.from('leads').select(COLUMNAS, { count: 'exact' });
  const { data, error, count } = await aplicarFiltros(base, f).order('created_at', { ascending: false }).range(desde, hasta);
  if (error) throw new Error(`No se pudieron listar los leads: ${error.message}`);
  return { filas: ((data ?? []) as unknown as FilaLead[]).map(normal), total: count ?? 0 };
}

const LOTE = 1000;
const MAX_LOTES = 30;

/** Todos los leads del filtro (para el Excel), de a 1 000 con tope de 30 000; `truncado` si hay más. */
export async function todosLosLeads(cliente: Cliente, f: FiltrosLead): Promise<{ filas: FilaLead[]; truncado: boolean }> {
  const filas: FilaLead[] = [];
  for (let n = 0; n < MAX_LOTES; n += 1) {
    const base = cliente.from('leads').select(COLUMNAS);
    const { data, error } = await aplicarFiltros(base, f)
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(n * LOTE, n * LOTE + LOTE - 1);
    if (error) throw new Error(`No se pudieron leer los leads: ${error.message}`);
    const lote = ((data ?? []) as unknown as FilaLead[]).map(normal);
    filas.push(...lote);
    if (lote.length < LOTE) return { filas, truncado: false };
  }
  return { filas, truncado: true };
}

/** Pop-ups de un país o de todos, para el filtro de origen. */
export async function popupsParaFiltro(cliente: Cliente): Promise<{ id: string; name: string; country_code: string }[]> {
  const { data, error } = await cliente.from('popups').select('id, name, country_code').order('name', { ascending: true }).limit(200);
  if (error) throw new Error(`No se pudieron leer los pop-ups: ${error.message}`);
  return (data ?? []) as { id: string; name: string; country_code: string }[];
}
