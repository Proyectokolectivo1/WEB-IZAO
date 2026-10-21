import { describe, expect, it } from 'vitest';
import type { EventoWhatsApp } from '@izao/whatsapp';
import type { PayLinkFila, PedidoCod } from '../cod/fuente.js';
import { ErrorReintentableWa, crearProcesadorWhatsApp, procesarEventoWhatsApp, type DepsEventoWa } from './evento.js';
import type { FuenteEventosWa, MensajeWa, PlantillaFila } from './fuente.js';

const ORDER = '00000000-0000-4000-8000-0000000000aa';
const AHORA = new Date('2026-10-20T16:00:00.000Z');
const TS = Math.floor(AHORA.getTime() / 1000) - 30;

function estado(status: 'sent' | 'delivered' | 'read' | 'failed', o: Partial<Extract<EventoWhatsApp, { tipo: 'estado_mensaje' }>> = {}): EventoWhatsApp {
  return { tipo: 'estado_mensaje', event_id: `wamid.A.${status}`, wa_message_id: 'wamid.A', status, timestamp: TS, error: null, ...o };
}

function plantillaEv(event: string, o: Partial<Extract<EventoWhatsApp, { tipo: 'estado_plantilla' }>> = {}): EventoWhatsApp {
  return { tipo: 'estado_plantilla', event_id: `tpl.555.${event}.1`, meta_template_id: '555', meta_template_name: 'cobro_abono_v2', language: 'es', event, reason: null, ...o };
}

function escenario(o: { mensaje?: Partial<MensajeWa> | null; pedido?: Partial<PedidoCod>; pay?: Partial<PayLinkFila> | null; plantillas?: PlantillaFila[]; correo?: boolean } = {}) {
  const eventos = new Map<string, { payload: unknown; procesado: boolean; error?: string }>();
  const mensajes: (MensajeWa & { wamid: string; error_code?: string; error_text?: string })[] =
    o.mensaje === null ? [] : [{ id: 'm1', order_id: ORDER, status: 'sent', template_key: 'cobro_abono', wamid: 'wamid.A', ...o.mensaje }];
  const plantillas: PlantillaFila[] = o.plantillas ?? [];
  const razones = new Map<string, string | null>();
  const alertas: { motivo: string; payload: Record<string, string | null> }[] = [];
  const correos: { order_id: string; email: string; url: string }[] = [];
  const pedido: PedidoCod = {
    id: ORDER,
    number: 'IZ-CO-000123',
    public_token: 'tok',
    status: 'esperando_abono',
    country_code: 'CO',
    currency_code: 'COP',
    payment_method: 'cod',
    stock_state: 'reserved',
    cod_deposit_amount: 30000n,
    cod_collect_amount: 129900n,
    contact_first_name: 'Ana',
    contact_email: 'ana@example.com',
    contact_phone_e164: '+573001234567',
    created_at: new Date('2026-10-20T15:00:00.000Z'),
    stock_reserved_until: new Date('2026-10-21T15:00:00.000Z'),
    ...o.pedido,
  };
  const pay: PayLinkFila | null =
    o.pay === null ? null : { token: 'tkPagar1', payment_id: 'p1', target_url: 'https://checkout.wompi.co/l/abc', expires_at: new Date('2026-10-21T15:00:00.000Z'), ...o.pay };

  const fuente: FuenteEventosWa = {
    async evento(id) {
      const e = eventos.get(id);
      return e ? { payload: e.payload, procesado: e.procesado } : null;
    },
    async marcarEvento(id, r) {
      const e = eventos.get(id)!;
      if (r.ok) Object.assign(e, { procesado: true, error: undefined });
      else e.error = r.error;
    },
    async mensajePorWamid(w) {
      const m = mensajes.find((x) => x.wamid === w);
      return m ? { id: m.id, order_id: m.order_id, status: m.status, template_key: m.template_key } : null;
    },
    async actualizarMensaje(id, desde, c) {
      const m = mensajes.find((x) => x.id === id)!;
      if (!desde.includes(m.status)) return false;
      Object.assign(m, c);
      return true;
    },
    async plantillaPorMeta(metaId, nombre) {
      return plantillas.find((p) => p.meta_template_id === metaId) ?? plantillas.find((p) => `${p.key}_v${p.version}` === nombre) ?? null;
    },
    async plantillaActivaDe(key, pais) {
      return plantillas.find((p) => p.key === key && p.country_code === pais && p.is_active) ?? null;
    },
    async actualizarPlantilla(id, c) {
      const p = plantillas.find((x) => x.id === id)!;
      p.meta_status = c.meta_status;
      if (c.meta_template_id) p.meta_template_id = c.meta_template_id;
      razones.set(id, c.meta_rejection_reason);
    },
    async activarPlantilla(t, metaId) {
      for (const p of plantillas) if (p.key === t.key && p.country_code === t.country_code) p.is_active = false;
      const p = plantillas.find((x) => x.id === t.id)!;
      Object.assign(p, { is_active: true, meta_status: 'approved', meta_template_id: metaId });
      razones.set(t.id, null);
      return 'activada';
    },
    async pedido(id) {
      return id === ORDER ? pedido : null;
    },
    async payLink() {
      return pay;
    },
    async registrarAlerta(_id, motivo, payload) {
      alertas.push({ motivo, payload });
    },
  };
  const deps: DepsEventoWa = {
    fuente,
    urlSitio: 'https://izaoperfumeria.com',
    ahora: () => AHORA,
    ...(o.correo === false ? {} : { correoRespaldo: async (c: { order_id: string; email: string; url: string }) => void correos.push(c) }),
  };
  const guardar = (e: EventoWhatsApp) => {
    eventos.set(e.event_id, { payload: e, procesado: false });
    return e.event_id;
  };
  return { deps, eventos, mensajes, plantillas, razones, alertas, correos, guardar };
}

const v = (id: string, version: number, extra: Partial<PlantillaFila> = {}): PlantillaFila => ({
  id,
  key: 'cobro_abono',
  country_code: 'CO',
  version,
  meta_status: 'approved',
  is_active: false,
  meta_template_id: null,
  ...extra,
});

describe('whatsapp.evento: estados de mensajes (§13.2)', () => {
  it('delivered y read avanzan el estado y marcan el evento procesado', async () => {
    const s = escenario();
    expect(await procesarEventoWhatsApp(s.guardar(estado('delivered')), s.deps)).toEqual({ accion: 'actualizado' });
    expect(s.mensajes[0]!.status).toBe('delivered');
    expect(await procesarEventoWhatsApp(s.guardar(estado('read')), s.deps)).toEqual({ accion: 'actualizado' });
    expect(s.mensajes[0]!.status).toBe('read');
    expect(s.eventos.get('wamid.A.read')!.procesado).toBe(true);
  });

  it('un estado que llega tarde no retrocede (sent después de read)', async () => {
    const s = escenario({ mensaje: { status: 'read' } });
    expect(await procesarEventoWhatsApp(s.guardar(estado('sent')), s.deps)).toEqual({ accion: 'sin_cambio' });
    expect(s.mensajes[0]!.status).toBe('read');
  });

  it('evento ya procesado o inexistente: no hace nada', async () => {
    const s = escenario();
    const id = s.guardar(estado('delivered'));
    s.eventos.get(id)!.procesado = true;
    expect(await procesarEventoWhatsApp(id, s.deps)).toEqual({ accion: 'ya_procesado' });
    expect(s.mensajes[0]!.status).toBe('sent');
    expect(await procesarEventoWhatsApp('nada', s.deps)).toEqual({ accion: 'evento_no_encontrado' });
  });

  it('payload inválido: se marca con error y no se reintenta', async () => {
    const s = escenario();
    s.eventos.set('x', { payload: { tipo: 'otro' }, procesado: false });
    expect(await procesarEventoWhatsApp('x', s.deps)).toEqual({ accion: 'invalido' });
    expect(s.eventos.get('x')!.error).toBe('payload_invalido');
  });

  it('mensaje aún no registrado (el webhook llegó antes que el wamid): reintentable; viejo → se descarta', async () => {
    const s = escenario({ mensaje: null });
    const id = s.guardar(estado('sent'));
    await expect(procesarEventoWhatsApp(id, s.deps)).rejects.toBeInstanceOf(ErrorReintentableWa);
    expect(s.eventos.get(id)!).toMatchObject({ procesado: false, error: 'mensaje_no_registrado' });
    const viejo = s.guardar(estado('delivered', { timestamp: TS - 3600 }));
    expect(await procesarEventoWhatsApp(viejo, s.deps)).toEqual({ accion: 'mensaje_desconocido' });
  });

  it('failed asíncrono: guarda el error, alerta en el pedido y envía el correo de respaldo con /pagar/{token}', async () => {
    const s = escenario();
    const r = await procesarEventoWhatsApp(s.guardar(estado('failed', { error: { code: '131026', text: 'Message undeliverable' } })), s.deps);
    expect(r).toEqual({ accion: 'fallido', correo: 'enviado' });
    expect(s.mensajes[0]).toMatchObject({ status: 'failed', error_code: '131026', error_text: 'Message undeliverable' });
    expect(s.correos).toEqual([{ order_id: ORDER, email: 'ana@example.com', url: 'https://izaoperfumeria.com/pagar/tkPagar1' }]);
    expect(s.alertas).toEqual([{ motivo: 'whatsapp_fallido', payload: { plantilla: 'cobro_abono', codigo: '131026', correo: 'enviado' } }]);
  });

  it('failed sin proveedor de correo, sin correo, pedido ya pagado o link vencido: solo alerta', async () => {
    const casos: [Parameters<typeof escenario>[0], string][] = [
      [{ correo: false }, 'sin_proveedor'],
      [{ pedido: { contact_email: null } }, 'sin_correo'],
      [{ pedido: { status: 'abono_pagado' } }, 'no_aplica'],
      [{ pay: { expires_at: new Date(AHORA.getTime() - 1) } }, 'no_aplica'],
      [{ pay: null }, 'no_aplica'],
    ];
    for (const [o, correo] of casos) {
      const s = escenario(o);
      expect(await procesarEventoWhatsApp(s.guardar(estado('failed')), s.deps)).toEqual({ accion: 'fallido', correo });
      expect(s.correos).toHaveLength(0);
      expect(s.alertas).toEqual([{ motivo: 'whatsapp_fallido', payload: { plantilla: 'cobro_abono', codigo: 'desconocido', correo } }]);
    }
  });

  it('failed después de delivered no cambia nada ni alerta', async () => {
    const s = escenario({ mensaje: { status: 'delivered' } });
    expect(await procesarEventoWhatsApp(s.guardar(estado('failed')), s.deps)).toEqual({ accion: 'sin_cambio' });
    expect(s.alertas).toHaveLength(0);
  });

  it('reintento tras caer entre el cambio y la alerta: repite el respaldo (el evento no quedó procesado)', async () => {
    const s = escenario();
    const id = s.guardar(estado('failed'));
    const alertaOriginal = s.deps.fuente.registrarAlerta;
    s.deps.fuente.registrarAlerta = async () => {
      throw new Error('red');
    };
    await expect(procesarEventoWhatsApp(id, s.deps)).rejects.toThrow('red');
    expect(s.eventos.get(id)!.procesado).toBe(false);
    s.deps.fuente.registrarAlerta = alertaOriginal;
    expect(await procesarEventoWhatsApp(id, s.deps)).toEqual({ accion: 'fallido', correo: 'enviado' });
    expect(s.alertas).toHaveLength(1);
  });
});

describe('whatsapp.evento: estados de plantillas (§13.3)', () => {
  it('APPROVED de la versión nueva: la activa y desactiva la anterior', async () => {
    const s = escenario({ plantillas: [v('t1', 1, { is_active: true, meta_template_id: '444' }), v('t2', 2, { meta_status: 'pending', meta_template_id: '555' })] });
    expect(await procesarEventoWhatsApp(s.guardar(plantillaEv('APPROVED')), s.deps)).toEqual({ accion: 'activada' });
    expect(s.plantillas.map((p) => [p.id, p.is_active, p.meta_status])).toEqual([
      ['t1', false, 'approved'],
      ['t2', true, 'approved'],
    ]);
  });

  it('APPROVED de una versión más vieja que la activa: queda aprobada sin activarse', async () => {
    const s = escenario({ plantillas: [v('t1', 1, { meta_status: 'pending', meta_template_id: '555' }), v('t2', 2, { is_active: true, meta_template_id: '666' })] });
    expect(await procesarEventoWhatsApp(s.guardar(plantillaEv('APPROVED')), s.deps)).toEqual({ accion: 'aprobada_sin_activar' });
    expect(s.plantillas.find((p) => p.id === 't2')!.is_active).toBe(true);
    expect(s.plantillas.find((p) => p.id === 't1')!).toMatchObject({ is_active: false, meta_status: 'approved' });
  });

  it('se encuentra por nombre si aún no tenía meta_template_id, y lo guarda', async () => {
    const s = escenario({ plantillas: [v('t2', 2, { meta_status: 'pending' })] });
    expect(await procesarEventoWhatsApp(s.guardar(plantillaEv('APPROVED')), s.deps)).toEqual({ accion: 'activada' });
    expect(s.plantillas[0]).toMatchObject({ is_active: true, meta_template_id: '555' });
  });

  it('REJECTED guarda meta_rejection_reason y no toca la activa', async () => {
    const s = escenario({ plantillas: [v('t1', 1, { is_active: true, meta_template_id: '444' }), v('t2', 2, { meta_status: 'pending', meta_template_id: '555' })] });
    const r = await procesarEventoWhatsApp(s.guardar(plantillaEv('REJECTED', { reason: 'INVALID_FORMAT: variable al inicio' })), s.deps);
    expect(r).toEqual({ accion: 'rechazada' });
    expect(s.plantillas[1]).toMatchObject({ meta_status: 'rejected', is_active: false });
    expect(s.razones.get('t2')).toBe('INVALID_FORMAT: variable al inicio');
    expect(s.plantillas[0]!.is_active).toBe(true);
  });

  it('PAUSED/DISABLED → paused con el motivo; PENDING → pending; desconocida o evento raro → ignorado', async () => {
    const s = escenario({ plantillas: [v('t2', 2, { is_active: true, meta_template_id: '555' })] });
    expect(await procesarEventoWhatsApp(s.guardar(plantillaEv('DISABLED', { event_id: 'tpl.d', reason: 'LOW_QUALITY' })), s.deps)).toEqual({ accion: 'pausada' });
    expect(s.plantillas[0]!.meta_status).toBe('paused');
    expect(s.razones.get('t2')).toBe('DISABLED: LOW_QUALITY');
    expect(await procesarEventoWhatsApp(s.guardar(plantillaEv('PENDING', { event_id: 'tpl.p' })), s.deps)).toEqual({ accion: 'pendiente' });
    expect(await procesarEventoWhatsApp(s.guardar(plantillaEv('FLAGGED', { event_id: 'tpl.f' })), s.deps)).toEqual({ accion: 'ignorado' });
    expect(await procesarEventoWhatsApp(s.guardar(plantillaEv('APPROVED', { event_id: 'tpl.x', meta_template_id: '999', meta_template_name: 'otra_v1' })), s.deps)).toEqual({
      accion: 'plantilla_desconocida',
    });
  });
});

describe('procesador de la cola whatsapp', () => {
  it('valida el nombre y los datos del job', async () => {
    const s = escenario();
    const p = crearProcesadorWhatsApp(s.deps);
    const id = s.guardar(estado('delivered'));
    expect(await p({ name: 'whatsapp.evento', data: { event_id: id } } as never)).toEqual({ accion: 'actualizado' });
    expect(await p({ name: 'whatsapp.evento', data: {} } as never)).toEqual({ ok: false, motivo: 'datos_invalidos' });
    expect(await p({ name: 'otro', data: {} } as never)).toEqual({ ok: true, ignorado: 'otro' });
  });
});
