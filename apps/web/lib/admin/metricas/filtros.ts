/**
 * Filtros de fecha y país de los reportes (§21.1), leídos de la URL con valores seguros. Código puro.
 */
import {
  PRESETS_FECHA,
  esFechaIso,
  fechaBogota,
  rangoPreset,
  type PresetFecha,
  type RangoFechas,
} from '@izao/core/metrics';

export const ETIQUETA_PRESET: Record<PresetFecha, string> = {
  hoy: 'Hoy',
  ayer: 'Ayer',
  ultimos_7_dias: 'Últimos 7 días',
  esta_semana: 'Esta semana',
  este_mes: 'Este mes',
  mes_anterior: 'Mes anterior',
};

/** Rango más largo que se consulta de una vez (12 meses, §21.4). */
export const MAX_DIAS_RANGO = 366;

export type FiltroFechas = {
  /** `null` = rango personalizado. */
  preset: PresetFecha | null;
  rango: RangoFechas;
  /** El rango pedido era inválido o demasiado largo y se usó el de por defecto. */
  corregido: boolean;
};

type Buscables = Record<string, string | string[] | undefined>;
const primero = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] : v) ?? '';

function diasEntreFechas(r: RangoFechas): number {
  const a = Date.parse(`${r.desde}T00:00:00Z`);
  const b = Date.parse(`${r.hasta}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000) + 1;
}

/** `?rango=hoy|ayer|…` o `?desde=…&hasta=…`; por defecto, `este_mes`. */
export function leerFiltroFechas(sp: Buscables, ahora: Date, porDefecto: PresetFecha = 'este_mes'): FiltroFechas {
  const preset = primero(sp.rango);
  if ((PRESETS_FECHA as readonly string[]).includes(preset)) {
    return { preset: preset as PresetFecha, rango: rangoPreset(preset as PresetFecha, ahora), corregido: false };
  }
  const desde = primero(sp.desde);
  const hasta = primero(sp.hasta);
  if (desde !== '' || hasta !== '') {
    if (esFechaIso(desde) && esFechaIso(hasta) && desde <= hasta && diasEntreFechas({ desde, hasta }) <= MAX_DIAS_RANGO) {
      return { preset: null, rango: { desde, hasta }, corregido: false };
    }
    return { preset: porDefecto, rango: rangoPreset(porDefecto, ahora), corregido: true };
  }
  return { preset: porDefecto, rango: rangoPreset(porDefecto, ahora), corregido: false };
}

/** Parámetros de URL que describen el filtro (para enlaces de paginación o descarga). */
export function parametrosFechas(f: FiltroFechas): Record<string, string> {
  return f.preset ? { rango: f.preset } : { desde: f.rango.desde, hasta: f.rango.hasta };
}

/** Hoy en Bogotá, útil para el `max` del selector de fecha. */
export function hoyBogota(ahora: Date): string {
  return fechaBogota(ahora);
}

