/**
 * Fechas de reportes (§21.1): zona America/Bogota, que coincide con Ecuador continental. Colombia no usa
 * horario de verano, así que el día en Bogotá es [D 05:00 UTC, D+1 05:00 UTC). Las fechas viajan como
 * texto `YYYY-MM-DD` (igual que la columna `date` de `daily_sales_stats`).
 */

export type FechaIso = string;

export interface RangoFechas {
  /** Primer día incluido (`YYYY-MM-DD`, Bogotá). */
  readonly desde: FechaIso;
  /** Último día incluido. */
  readonly hasta: FechaIso;
}

export type PresetFecha = 'hoy' | 'ayer' | 'ultimos_7_dias' | 'esta_semana' | 'este_mes' | 'mes_anterior';

export const PRESETS_FECHA: readonly PresetFecha[] = Object.freeze([
  'hoy',
  'ayer',
  'ultimos_7_dias',
  'esta_semana',
  'este_mes',
  'mes_anterior',
]);

/** Desfase fijo de Bogotá (UTC−5). */
const DESFASE_MS = 5 * 60 * 60 * 1000;
const DIA_MS = 24 * 60 * 60 * 1000;
const FECHA_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function aIso(d: Date): FechaIso {
  return d.toISOString().slice(0, 10);
}

/** Valida `YYYY-MM-DD` real (rechaza 2026-02-30) y devuelve medianoche UTC de ese día calendario. */
function parsear(fecha: FechaIso): Date {
  const m = FECHA_RE.exec(fecha);
  if (!m) throw new RangeError(`Fecha inválida: ${fecha}`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (aIso(d) !== fecha) throw new RangeError(`Fecha inválida: ${fecha}`);
  return d;
}

export function esFechaIso(valor: unknown): valor is FechaIso {
  if (typeof valor !== 'string') return false;
  try {
    parsear(valor);
    return true;
  } catch {
    return false;
  }
}

/** Día calendario en Bogotá de un instante. */
export function fechaBogota(instante: Date): FechaIso {
  if (Number.isNaN(instante.getTime())) throw new RangeError('Instante inválido.');
  return aIso(new Date(instante.getTime() - DESFASE_MS));
}

/** Instante UTC en que empieza el día `fecha` en Bogotá. */
export function inicioDiaBogotaUtc(fecha: FechaIso): Date {
  return new Date(parsear(fecha).getTime() + DESFASE_MS);
}

export function sumarDias(fecha: FechaIso, dias: number): FechaIso {
  if (!Number.isSafeInteger(dias)) throw new RangeError('Días inválidos.');
  return aIso(new Date(parsear(fecha).getTime() + dias * DIA_MS));
}

function validarRango(r: RangoFechas): { desde: Date; hasta: Date } {
  const desde = parsear(r.desde);
  const hasta = parsear(r.hasta);
  if (hasta < desde) throw new RangeError('El rango termina antes de empezar.');
  return { desde, hasta };
}

/** Días del rango, ambos extremos incluidos. */
export function diasEntre(r: RangoFechas): FechaIso[] {
  const { desde, hasta } = validarRango(r);
  const dias: FechaIso[] = [];
  for (let t = desde.getTime(); t <= hasta.getTime(); t += DIA_MS) dias.push(aIso(new Date(t)));
  return dias;
}

function ultimoDiaMes(anio: number, mes0: number): number {
  return new Date(Date.UTC(anio, mes0 + 1, 0)).getUTCDate();
}

/** Rango de un preset del filtro, relativo a `ahora` en Bogotá. */
export function rangoPreset(preset: PresetFecha, ahora: Date): RangoFechas {
  const hoy = fechaBogota(ahora);
  const d = parsear(hoy);
  switch (preset) {
    case 'hoy':
      return { desde: hoy, hasta: hoy };
    case 'ayer': {
      const ayer = sumarDias(hoy, -1);
      return { desde: ayer, hasta: ayer };
    }
    case 'ultimos_7_dias':
      return { desde: sumarDias(hoy, -6), hasta: hoy };
    case 'esta_semana': {
      const desdeLunes = (d.getUTCDay() + 6) % 7; // lunes = 0
      return { desde: sumarDias(hoy, -desdeLunes), hasta: hoy };
    }
    case 'este_mes':
      return { desde: aIso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))), hasta: hoy };
    case 'mes_anterior': {
      const anio = d.getUTCFullYear();
      const mes0 = d.getUTCMonth() - 1;
      const inicio = new Date(Date.UTC(anio, mes0, 1));
      return {
        desde: aIso(inicio),
        hasta: aIso(new Date(Date.UTC(inicio.getUTCFullYear(), inicio.getUTCMonth(), ultimoDiaMes(anio, mes0)))),
      };
    }
  }
}

/**
 * Periodo anterior equivalente para la comparación (variación %). Con los presets de mes se alinea al
 * calendario (este mes del 1 al 21 → mes anterior del 1 al 21, recortado al último día; mes anterior →
 * el mes completo previo). En los demás casos, la misma cantidad de días inmediatamente antes.
 */
export function periodoAnterior(r: RangoFechas, preset?: PresetFecha): RangoFechas {
  const { desde, hasta } = validarRango(r);
  if (preset === 'este_mes' || preset === 'mes_anterior') {
    const anio = desde.getUTCFullYear();
    const mes0 = desde.getUTCMonth() - 1;
    const inicio = new Date(Date.UTC(anio, mes0, 1));
    const tope = ultimoDiaMes(anio, mes0);
    const dia = preset === 'mes_anterior' ? tope : Math.min(hasta.getUTCDate(), tope);
    return {
      desde: aIso(inicio),
      hasta: aIso(new Date(Date.UTC(inicio.getUTCFullYear(), inicio.getUTCMonth(), dia))),
    };
  }
  const dias = Math.round((hasta.getTime() - desde.getTime()) / DIA_MS) + 1;
  return { desde: sumarDias(r.desde, -dias), hasta: sumarDias(r.desde, -1) };
}
