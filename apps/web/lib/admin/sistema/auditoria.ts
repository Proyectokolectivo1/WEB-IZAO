/**
 * Auditoría del panel (§24.1 Sistema, §26.1): filtros de la lista y resumen legible del diff. Código puro.
 * Los eventos de acceso (`sesion_admin`) son muy frecuentes, así que no se muestran salvo que se pidan.
 */
import { esFechaIso } from '@izao/core/metrics';

export const ENTIDAD_ACCESOS = 'sesion_admin';

export type FiltrosAuditoria = {
  pagina: number;
  /** Prefijo de la acción, p. ej. `usuarios.` o `gastos.creado`. */
  accion: string;
  entidad: string;
  actor: string;
  desde: string;
  hasta: string;
  accesos: boolean;
};

type Buscables = Record<string, string | string[] | undefined>;
const primero = (v: string | string[] | undefined): string => ((Array.isArray(v) ? v[0] : v) ?? '').trim();

/** Solo letras, números y los separadores de nombres de acción/entidad: nada de comodines ni de sintaxis de filtros. */
const segura = (v: string, max: number): string => v.replace(/[^a-zA-Z0-9_.:@-]/g, '').slice(0, max);

export function leerFiltrosAuditoria(sp: Buscables): FiltrosAuditoria {
  let desde = primero(sp.desde);
  let hasta = primero(sp.hasta);
  if (!esFechaIso(desde)) desde = '';
  if (!esFechaIso(hasta)) hasta = '';
  if (desde && hasta && desde > hasta) [desde, hasta] = [hasta, desde];
  const n = Number.parseInt(primero(sp.page), 10);
  return {
    pagina: Number.isFinite(n) && n >= 1 && n <= 10000 ? n : 1,
    accion: segura(primero(sp.accion), 60),
    entidad: segura(primero(sp.entidad), 60),
    actor: segura(primero(sp.actor), 80),
    desde,
    hasta,
    accesos: primero(sp.accesos) === '1',
  };
}

export function parametrosDeFiltrosAuditoria(f: FiltrosAuditoria): Record<string, string> {
  const salida: Record<string, string> = {};
  for (const k of ['accion', 'entidad', 'actor', 'desde', 'hasta'] as const) if (f[k]) salida[k] = f[k];
  if (f.accesos) salida.accesos = '1';
  return salida;
}

/** Diff en una línea para la tabla; recorta lo largo. */
export function resumenDiff(diff: unknown, max = 240): string {
  if (diff === null || diff === undefined) return '—';
  let texto: string;
  try {
    texto = JSON.stringify(diff);
  } catch {
    return '—';
  }
  if (!texto || texto === '{}' || texto === 'null') return '—';
  return texto.length > max ? `${texto.slice(0, max)}…` : texto;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const esUuid = (v: string): boolean => UUID.test(v);
