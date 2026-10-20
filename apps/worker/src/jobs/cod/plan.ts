/**
 * Plan de recordatorios del abono (§13.1). Todo viene de `country_settings`: `cod_reminder_offsets_minutes`,
 * `cod_quiet_hours_start/end` y la zona del país (`countries.timezone`). Puro y con reloj inyectado.
 *
 * - Cada recordatorio sale en `creado + offset`. Si cae en el horario silencioso se mueve al fin del silencio, y
 *   solo se envía si al pedido le queda al menos `minVigenciaMs` (defecto 1 h); si no, se omite.
 * - Un recordatorio en o después del vencimiento nunca se programa.
 * - Si dos quedan a la misma hora (p. ej. ambos movidos a las 07:00), se envía solo el más avanzado.
 */
import type { ClavePlantillaCod } from '@izao/whatsapp';

export interface HorarioSilencio {
  /** `HH:MM` o `HH:MM:SS` (tipo `time` de Postgres), hora local del país. */
  inicio: string;
  fin: string;
}

export interface EntradaPlan {
  creado: Date;
  venceEn: Date;
  offsetsMinutos: readonly number[];
  silencio: HorarioSilencio;
  zona: string;
  minVigenciaMs?: number;
}

export interface RecordatorioPlaneado {
  /** 1-based, en el orden de los offsets configurados. */
  n: number;
  enviarEn: Date;
}

function minutosDe(hora: string): number {
  const m = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(hora);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new RangeError(`Hora inválida: ${hora}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Minutos desde la medianoche local en `zona` y segundos sueltos. */
function relojLocal(d: Date, zona: string): { minutos: number; segundos: number } {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: zona,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(d);
  const v = (t: string) => Number(partes.find((p) => p.type === t)?.value ?? '0');
  return { minutos: v('hour') * 60 + v('minute'), segundos: v('second') };
}

export function enSilencio(d: Date, s: HorarioSilencio, zona: string): boolean {
  const ini = minutosDe(s.inicio);
  const fin = minutosDe(s.fin);
  if (ini === fin) return false;
  const { minutos } = relojLocal(d, zona);
  return ini < fin ? minutos >= ini && minutos < fin : minutos >= ini || minutos < fin;
}

/** Siguiente fin del silencio a partir de `d` (CO y EC no tienen horario de verano). */
function finDelSilencio(d: Date, s: HorarioSilencio, zona: string): Date {
  const { minutos, segundos } = relojLocal(d, zona);
  const delta = (minutosDe(s.fin) - minutos + 1440) % 1440;
  return new Date(d.getTime() + delta * 60_000 - segundos * 1000 - d.getMilliseconds());
}

export function planRecordatorios(e: EntradaPlan): RecordatorioPlaneado[] {
  const minVigencia = e.minVigenciaMs ?? 3_600_000;
  const vence = e.venceEn.getTime();
  const vistos = new Set<number>();
  const planeados: RecordatorioPlaneado[] = [];
  e.offsetsMinutos.forEach((offset, i) => {
    if (!Number.isInteger(offset) || offset <= 0 || vistos.has(offset)) return;
    vistos.add(offset);
    let en = new Date(e.creado.getTime() + offset * 60_000);
    if (en.getTime() >= vence) return;
    if (enSilencio(en, e.silencio, e.zona)) {
      en = finDelSilencio(en, e.silencio, e.zona);
      if (vence - en.getTime() < minVigencia) return;
    }
    planeados.push({ n: i + 1, enviarEn: en });
  });
  // Misma hora → queda el de mayor n.
  const porHora = new Map<number, RecordatorioPlaneado>();
  for (const r of planeados) {
    const previo = porHora.get(r.enviarEn.getTime());
    if (!previo || r.n > previo.n) porHora.set(r.enviarEn.getTime(), r);
  }
  return [...porHora.values()].sort((a, b) => a.enviarEn.getTime() - b.enviarEn.getTime() || a.n - b.n);
}

/** Plantilla del recordatorio `n` de `total` configurados. */
export function plantillaRecordatorio(n: number, total: number): ClavePlantillaCod {
  if (n >= total) return 'recordatorio_abono_final';
  return n === 1 ? 'recordatorio_abono_1' : 'recordatorio_abono_2';
}
