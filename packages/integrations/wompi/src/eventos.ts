/**
 * Verificación de eventos de Wompi (docs.wompi.co "Eventos", D-024).
 * - Checksum = SHA256(valores de `signature.properties` leídos de `data`, en orden + `timestamp` + secreto).
 *   La lista de propiedades puede cambiar: se lee del evento, nunca se fija en el código.
 * - `X-Event-Checksum`, si llega, debe coincidir con `signature.checksum`.
 * - `environment` (`test`/`prod`) debe corresponder al ambiente de las credenciales.
 * - Idempotencia: `event_id = {transaction.id}.{transaction.status}` (Wompi no manda id de evento y
 *   reintenta el mismo evento hasta 3 veces en 24 h).
 * Solo se firman las propiedades listadas: el resto del cuerpo no es confiable y el job reconsulta la API.
 */
import type { Environment, VerifiedEvent } from '@izao/core/contracts';
import { checksumEvento, iguales } from './firmas';

export type MotivoRechazo = 'json_invalido' | 'estructura' | 'firma_invalida' | 'ambiente' | 'sin_secreto';

export type ResultadoVerificacion = { ok: true; evento: VerifiedEvent } | { ok: false; motivo: MotivoRechazo };

export interface OpcionesVerificacion {
  secretoEventos: string;
  ambiente: Environment;
}

const AMBIENTE_EVENTO: Record<Environment, string> = { sandbox: 'test', production: 'prod' };
const RUTA = /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/;
const PROHIBIDAS = new Set(['__proto__', 'prototype', 'constructor']);

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Valor de una ruta `a.b.c` dentro de `data`, solo propiedades propias y valores escalares. */
function valorEn(data: Record<string, unknown>, ruta: string): string | null {
  if (!RUTA.test(ruta)) return null;
  let actual: unknown = data;
  for (const parte of ruta.split('.')) {
    if (PROHIBIDAS.has(parte) || !esObjeto(actual) || !Object.hasOwn(actual, parte)) return null;
    actual = actual[parte];
  }
  if (typeof actual === 'string') return actual;
  if (typeof actual === 'number' && Number.isFinite(actual)) return String(actual);
  if (typeof actual === 'boolean') return String(actual);
  return null;
}

function textoONull(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

export function verificarEvento(
  cuerpoCrudo: Uint8Array,
  cabeceras: Readonly<Record<string, string>>,
  o: OpcionesVerificacion,
): ResultadoVerificacion {
  if (!o.secretoEventos) return { ok: false, motivo: 'sin_secreto' };
  let evento: unknown;
  try {
    evento = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(cuerpoCrudo));
  } catch {
    return { ok: false, motivo: 'json_invalido' };
  }
  if (!esObjeto(evento) || !esObjeto(evento.data) || !esObjeto(evento.signature)) return { ok: false, motivo: 'estructura' };
  const { data, signature } = evento;
  const props = signature.properties;
  const checksum = signature.checksum;
  const timestamp = evento.timestamp;
  if (
    typeof evento.event !== 'string' ||
    !Array.isArray(props) ||
    props.length === 0 ||
    props.length > 20 ||
    typeof checksum !== 'string' ||
    !/^[0-9a-fA-F]{64}$/.test(checksum) ||
    typeof timestamp !== 'number' ||
    !Number.isSafeInteger(timestamp)
  ) {
    return { ok: false, motivo: 'estructura' };
  }
  const valores: string[] = [];
  for (const p of props) {
    const v = typeof p === 'string' ? valorEn(data, p) : null;
    if (v === null) return { ok: false, motivo: 'estructura' };
    valores.push(v);
  }
  const esperado = checksumEvento(valores, timestamp, o.secretoEventos);
  if (!iguales(esperado, checksum)) return { ok: false, motivo: 'firma_invalida' };
  const cabecera = cabeceras['x-event-checksum'];
  if (cabecera !== undefined && !iguales(cabecera.trim(), checksum)) return { ok: false, motivo: 'firma_invalida' };
  if (evento.environment !== AMBIENTE_EVENTO[o.ambiente]) return { ok: false, motivo: 'ambiente' };

  const tx = esObjeto(data.transaction) ? data.transaction : null;
  const txId = tx ? textoONull(tx.id) : null;
  const txEstado = tx ? textoONull(tx.status) : null;
  const esTransaccion = evento.event === 'transaction.updated';
  if (esTransaccion && (!txId || !txEstado)) return { ok: false, motivo: 'estructura' };
  return {
    ok: true,
    evento: {
      provider: 'wompi',
      event_id: esTransaccion ? `${txId}.${txEstado}` : `${evento.event}.${checksum.toLowerCase()}`,
      event_type: evento.event,
      occurred_at: textoONull(evento.sent_at),
      refs: {
        provider_transaction_id: esTransaccion ? txId : null,
        provider_reference: esTransaccion && tx ? textoONull(tx.reference) : null,
        payment_link_id: esTransaccion && tx ? textoONull(tx.payment_link_id) : null,
      },
      payload: evento,
    },
  };
}
