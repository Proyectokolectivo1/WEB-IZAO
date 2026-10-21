import { describe, expect, it } from 'vitest';
import type { OrderStatusEvent } from '@izao/core/order-state';
import { ErrorWhatsApp, PLANTILLAS_SEMILLA, type CredencialesWhatsApp } from '@izao/whatsapp';
import { crearWhatsAppMock } from '@izao/whatsapp/mock';
import { ErrorWompi, type EntradaLinkAbono, type WompiCredentials } from '@izao/wompi';
import type { AbonoFila, FuenteCod, MensajeFila, PayLinkFila, PedidoCod } from './fuente.js';
import { ErrorReintentableCod, abandonarCod, iniciarCod, recordatorioCod, reenviarCod, type JobProgramado } from './flujo.js';

const ORDER = '00000000-0000-4000-8000-0000000000aa';
const CREADO = new Date('2026-10-20T15:00:00.000Z'); // 10:00 en Bogotá
const VENCE = new Date('2026-10-21T15:00:00.000Z');
const WOMPI: WompiCredentials = {
  ambiente: 'sandbox',
  llavePublica: 'pub_test_x',
  llavePrivada: 'prv_test_x',
  secretoEventos: 'test_events_x',
  secretoIntegridad: 'test_integrity_x',
};
const WA: CredencialesWhatsApp = {
  phoneNumberId: '1234567890',
  wabaId: '9876543210',
  tokenAcceso: 'EAAG_x',
  appSecret: 's',
  tokenVerificacion: 'v',
  versionGraph: 'v26.0',
};

function escenario(o: { pedido?: Partial<PedidoCod>; sinPlantillas?: boolean; sinWa?: boolean; ahora?: Date; tope?: number | null } = {}) {
  const pedido: PedidoCod = {
    id: ORDER,
    number: 'IZ-CO-000123',
    public_token: 'tok_publico_abcdef',
    status: 'esperando_abono',
    country_code: 'CO',
    currency_code: 'COP',
    payment_method: 'cod',
    stock_state: 'reserved',
    cod_deposit_amount: 30_000n,
    cod_collect_amount: 219_900n,
    contact_first_name: 'Laura',
    contact_email: 'laura@example.com',
    contact_phone_e164: '+573001234567',
    created_at: CREADO,
    stock_reserved_until: VENCE,
    ...o.pedido,
  };
  const abonos: AbonoFila[] = [];
  const mensajes: (MensajeFila & { to: string; error?: string })[] = [];
  let payLink: PayLinkFila | null = null;
  const r = {
    links: [] as EntradaLinkAbono[],
    programados: [] as JobProgramado[],
    eventos: [] as OrderStatusEvent[],
    alertas: [] as string[],
    correos: [] as string[],
    liberados: { stock: 0, canje: 0 },
    falloLink: null as ErrorWompi | null,
  };
  const wa = crearWhatsAppMock();
  const fuente: FuenteCod = {
    pedido: async (id) => (id === ORDER ? { ...pedido } : null),
    config: async () => ({ offsetsMinutos: [180, 720, 1260], silencio: { inicio: '21:00', fin: '07:00' }, zona: 'America/Bogota' }),
    credencialesWompi: async () => WOMPI,
    credencialesWhatsApp: async () => (o.sinWa ? null : WA),
    abonos: async () => abonos.map((a) => ({ ...a })),
    reservarAbono: async (n) => {
      if (abonos.some((a) => a.provider_reference === n.provider_reference)) return { ok: false, motivo: 'duplicado' };
      const id = `abono-${abonos.length + 1}`;
      abonos.push({ id, status: 'created', amount: n.amount, provider_reference: n.provider_reference, payment_link_id: null, checkout_url: null, expires_at: n.expires_at });
      return { ok: true, id };
    },
    guardarLink: async (id, l) => {
      Object.assign(abonos.find((a) => a.id === id)!, l);
    },
    payLink: async () => payLink,
    crearPayLink: async (p) => {
      if (payLink) return { ok: false, motivo: 'duplicado' };
      payLink = { token: p.token, payment_id: p.payment_id, target_url: p.target_url, expires_at: p.expires_at };
      return { ok: true };
    },
    plantillaActiva: async (_p, key) => {
      if (o.sinPlantillas) return null;
      const s = PLANTILLAS_SEMILLA.find((x) => x.key === key)!;
      return { ...s, id: `tpl-${key}`, meta_template_name: `${key}_v1` };
    },
    mensajes: async () => mensajes.map((m) => ({ ...m })),
    prepararMensaje: async (m) => {
      const key = m.template_id.replace(/^tpl-/, '');
      const previo = mensajes.find((x) => x.template_key === key && x.scheduled_for?.getTime() === m.scheduled_for.getTime());
      if (previo) return previo.id;
      const id = `msg-${mensajes.length + 1}`;
      mensajes.push({ id, template_key: key, scheduled_for: m.scheduled_for, status: 'queued', wa_message_id: null, to: m.to_e164 });
      return id;
    },
    marcarMensaje: async (id, x) => {
      const m = mensajes.find((y) => y.id === id)!;
      m.status = x.status;
      if (x.status === 'sent') m.wa_message_id = x.wa_message_id;
      else m.error = x.error_code;
    },
    aplicarTransicion: async (_id, ev) => {
      if (pedido.status !== ev.from_status) return false;
      pedido.status = ev.to_status;
      r.eventos.push(ev);
      return true;
    },
    liberarStock: async () => {
      r.liberados.stock += 1;
      pedido.stock_state = 'released';
      return { ok: true, estado: 'released' };
    },
    liberarCanje: async () => {
      r.liberados.canje += 1;
      return { ok: true };
    },
    registrarAlerta: async (_id, motivo) => {
      r.alertas.push(motivo);
    },
    topeReenvios: async () => (o.tope === undefined ? 2 : o.tope),
  };
  let ahora = o.ahora ?? new Date(CREADO.getTime() + 5_000);
  const deps = {
    fuente,
    wompi: () => ({
      crearLink: async (e: EntradaLinkAbono) => {
        if (r.falloLink) throw r.falloLink;
        r.links.push(e);
        return { id: `test_L${r.links.length}`, url: `https://checkout.wompi.co/l/test_L${r.links.length}` };
      },
    }),
    whatsapp: () => wa,
    programar: async (j: JobProgramado) => {
      r.programados.push(j);
    },
    correoRespaldo: async (c: { email: string; url: string }) => {
      r.correos.push(`${c.email} ${c.url}`);
    },
    urlSitio: 'https://izaoperfumeria.com',
    ahora: () => ahora,
    generarToken: () => 'TokCorto123',
  };
  return {
    pedido,
    abonos,
    mensajes,
    r,
    wa,
    deps,
    payLink: () => payLink,
    avanzar: (d: Date) => {
      ahora = d;
    },
  };
}

describe('cod.iniciar: link, /pagar/{token}, cobro inmediato y programación (§13.1)', () => {
  it('crea el link con el abono y la reserva, el pay_link, envía cobro_abono y programa recordatorios y abandono', async () => {
    const s = escenario();
    const res = await iniciarCod(ORDER, s.deps);
    expect(res.accion).toBe('iniciado');
    expect(s.r.links).toEqual([
      {
        numeroPedido: 'IZ-CO-000123',
        montoAbono: 30_000n,
        moneda: 'COP',
        expiraEn: VENCE,
        urlRetorno: 'https://izaoperfumeria.com/co/pedido/tok_publico_abcdef',
      },
    ]);
    expect(s.abonos[0]).toMatchObject({ provider_reference: 'IZ-CO-000123-A1', payment_link_id: 'test_L1', checkout_url: 'https://checkout.wompi.co/l/test_L1' });
    expect(s.payLink()).toEqual({ token: 'TokCorto123', payment_id: 'abono-1', target_url: 'https://checkout.wompi.co/l/test_L1', expires_at: VENCE });
    expect(s.wa.enviados).toHaveLength(1);
    const m = s.wa.enviados[0]!;
    expect(m.to).toBe('573001234567');
    expect(m.template.name).toBe('cobro_abono_v1');
    const textos = m.template.components[0]!.parameters.map((p) => p.text);
    expect(textos[0]).toBe('Laura');
    expect(textos[1]).toBe('IZ-CO-000123');
    expect(textos[2]).toMatch(/30\.000/);
    expect(textos[3]).toMatch(/219\.900/);
    expect(textos[4]).toMatch(/21 de octubre/);
    expect(m.template.components[1]).toEqual({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: 'TokCorto123' }] });
    expect(s.mensajes[0]).toMatchObject({ status: 'sent', wa_message_id: 'wamid.mock.1' });
    expect(s.r.programados).toEqual([
      { tipo: 'abandono', order_id: ORDER, en: VENCE },
      { tipo: 'recordatorio', order_id: ORDER, n: 1, en: new Date('2026-10-20T18:00:00.000Z') },
      { tipo: 'recordatorio', order_id: ORDER, n: 3, en: new Date('2026-10-21T12:00:00.000Z') },
    ]);
  });

  it('repetir el job no crea otro link, otro token ni reenvía el cobro', async () => {
    const s = escenario();
    await iniciarCod(ORDER, s.deps);
    await iniciarCod(ORDER, s.deps);
    expect(s.r.links).toHaveLength(1);
    expect(s.abonos).toHaveLength(1);
    expect(s.wa.enviados).toHaveLength(1);
  });

  it('Wompi caído: lanza reintentable; al reintentar reutiliza la fila reservada (sin A2)', async () => {
    const s = escenario();
    s.r.falloLink = new ErrorWompi('HTTP', true, 503);
    await expect(iniciarCod(ORDER, s.deps)).rejects.toBeInstanceOf(ErrorReintentableCod);
    s.r.falloLink = null;
    await iniciarCod(ORDER, s.deps);
    expect(s.abonos.map((a) => a.provider_reference)).toEqual(['IZ-CO-000123-A1']);
    expect(s.wa.enviados).toHaveLength(1);
  });

  it('WhatsApp falla (número sin WhatsApp): mensaje failed, alerta y link por correo; no se reintenta', async () => {
    const s = escenario();
    s.wa.fallarCon = new ErrorWhatsApp('DESTINO', false, 400, '131026');
    const res = await iniciarCod(ORDER, s.deps);
    expect(res.accion).toBe('iniciado');
    expect(s.mensajes[0]).toMatchObject({ status: 'failed', error: '131026' });
    expect(s.r.alertas).toContain('whatsapp_fallido');
    expect(s.r.correos).toEqual(['laura@example.com https://izaoperfumeria.com/pagar/TokCorto123']);
  });

  it('WhatsApp con límite de tasa: lanza reintentable sin marcar fallido', async () => {
    const s = escenario();
    s.wa.fallarCon = new ErrorWhatsApp('LIMITE', true, 429, '130429');
    await expect(iniciarCod(ORDER, s.deps)).rejects.toBeInstanceOf(ErrorReintentableCod);
    expect(s.mensajes[0]!.status).toBe('queued');
    s.wa.fallarCon = null;
    await iniciarCod(ORDER, s.deps);
    expect(s.wa.enviados).toHaveLength(1);
    expect(s.mensajes).toHaveLength(1);
  });

  it('sin credenciales de WhatsApp o sin plantilla aprobada: alerta y correo, el link igual queda listo', async () => {
    for (const o of [{ sinWa: true }, { sinPlantillas: true }]) {
      const s = escenario(o);
      await iniciarCod(ORDER, s.deps);
      expect(s.payLink()).not.toBeNull();
      expect(s.r.alertas.some((a) => a === 'whatsapp_sin_credenciales' || a === 'plantilla_no_activa')).toBe(true);
      expect(s.r.correos).toHaveLength(1);
    }
  });

  it('pedido que ya no espera abono o no es contra entrega: no hace nada', async () => {
    for (const p of [{ status: 'abono_pagado' as const }, { payment_method: 'wompi' }]) {
      const s = escenario({ pedido: p });
      expect((await iniciarCod(ORDER, s.deps)).accion).toBe('omitido');
      expect(s.r.links).toEqual([]);
      expect(s.wa.enviados).toEqual([]);
    }
  });
});

describe('cod.recordatorio y cod.abandono (reloj inyectado)', () => {
  it('recordatorio 1 a las 13:00 con la plantilla _1 y el mismo token; repetido no reenvía', async () => {
    const s = escenario();
    await iniciarCod(ORDER, s.deps);
    s.avanzar(new Date('2026-10-20T18:00:00.000Z'));
    expect((await recordatorioCod(ORDER, 1, s.deps)).accion).toBe('enviado');
    expect((await recordatorioCod(ORDER, 1, s.deps)).accion).toBe('ya_enviado');
    expect(s.wa.enviados.map((m) => m.template.name)).toEqual(['cobro_abono_v1', 'recordatorio_abono_1_v1']);
    expect(s.wa.enviados[1]!.template.components[1]).toMatchObject({ parameters: [{ text: 'TokCorto123' }] });
  });

  it('recordatorio final usa su propio orden de variables', async () => {
    const s = escenario();
    await iniciarCod(ORDER, s.deps);
    s.avanzar(new Date('2026-10-21T12:00:00.000Z'));
    await recordatorioCod(ORDER, 3, s.deps);
    const final = s.wa.enviados.at(-1)!;
    expect(final.template.name).toBe('recordatorio_abono_final_v1');
    const p = final.template.components[0]!.parameters.map((x) => x.text);
    expect(p[2]).toMatch(/21 de octubre/);
    expect(p[3]).toMatch(/30\.000/);
  });

  it('pagado antes del recordatorio o ya vencido: se omite', async () => {
    const s = escenario();
    await iniciarCod(ORDER, s.deps);
    s.pedido.status = 'abono_pagado';
    expect((await recordatorioCod(ORDER, 1, s.deps)).accion).toBe('omitido');
    const t = escenario();
    await iniciarCod(ORDER, t.deps);
    t.avanzar(VENCE);
    expect((await recordatorioCod(ORDER, 2, t.deps)).accion).toBe('omitido');
    expect(t.wa.enviados).toHaveLength(1);
  });

  it('abandono a las 24 h: abandonado con abandoned_at, libera stock y código; no va a la transportadora', async () => {
    const s = escenario();
    s.avanzar(VENCE);
    const res = await abandonarCod(ORDER, s.deps);
    expect(res.accion).toBe('abandonado');
    expect(s.r.eventos).toHaveLength(1);
    expect(s.r.eventos[0]).toMatchObject({ from_status: 'esperando_abono', to_status: 'abandonado', actor: 'system' });
    expect(s.r.liberados).toEqual({ stock: 1, canje: 1 });
  });

  it('abandono temprano se reprograma; pagado antes se omite; reintento tras falla libera sin otra transición', async () => {
    const s = escenario();
    s.avanzar(new Date(VENCE.getTime() - 60_000));
    expect((await abandonarCod(ORDER, s.deps)).accion).toBe('reprogramado');
    expect(s.r.programados.at(-1)).toEqual({ tipo: 'abandono', order_id: ORDER, en: VENCE });
    s.pedido.status = 'abono_pagado';
    s.avanzar(VENCE);
    expect((await abandonarCod(ORDER, s.deps)).accion).toBe('omitido');

    const t = escenario({ pedido: { status: 'abandonado', stock_state: 'reserved' }, ahora: VENCE });
    expect((await abandonarCod(ORDER, t.deps)).accion).toBe('abandonado');
    expect(t.r.eventos).toEqual([]);
    expect(t.r.liberados).toEqual({ stock: 1, canje: 1 });
  });
});

describe('cod.reenviar: "Reenviar cobro" del panel (§13.4)', () => {
  const SOLICITUD = new Date('2026-10-20T18:00:00.000Z'); // 13:00 en Bogotá
  async function iniciado(o: Parameters<typeof escenario>[0] = {}) {
    const s = escenario(o);
    await iniciarCod(ORDER, s.deps);
    s.avanzar(SOLICITUD);
    return s;
  }

  it('reenvía cobro_abono con scheduled_for = hora de la solicitud (fila nueva, no choca con la restricción única)', async () => {
    const s = await iniciado();
    expect(await reenviarCod(ORDER, SOLICITUD, s.deps)).toEqual({ accion: 'enviado' });
    expect(s.wa.enviados).toHaveLength(2);
    expect(s.wa.enviados[1]!.template.name).toBe('cobro_abono_v1');
    const cobros = s.mensajes.filter((m) => m.template_key === 'cobro_abono');
    expect(cobros.map((m) => m.scheduled_for!.toISOString())).toEqual([CREADO.toISOString(), SOLICITUD.toISOString()]);
  });

  it('repetir el mismo job (reintento) no reenvía dos veces', async () => {
    const s = await iniciado();
    await reenviarCod(ORDER, SOLICITUD, s.deps);
    expect(await reenviarCod(ORDER, SOLICITUD, s.deps)).toEqual({ accion: 'ya_enviado' });
    expect(s.wa.enviados).toHaveLength(2);
  });

  it('respeta el tope de country_settings; sin tope configurado no envía y alerta', async () => {
    const s = await iniciado({ tope: 1 });
    expect(await reenviarCod(ORDER, SOLICITUD, s.deps)).toEqual({ accion: 'enviado' });
    const otra = new Date(SOLICITUD.getTime() + 60_000);
    expect(await reenviarCod(ORDER, otra, s.deps)).toEqual({ accion: 'tope_alcanzado' });
    expect(s.r.alertas).toContain('reenvio_tope_alcanzado');
    const t = await iniciado({ tope: null });
    expect(await reenviarCod(ORDER, SOLICITUD, t.deps)).toEqual({ accion: 'no_enviado' });
    expect(t.r.alertas).toContain('reenvio_sin_tope');
    expect(t.wa.enviados).toHaveLength(1);
  });

  it('horario silencioso: se reprograma al fin del silencio (07:00 local)', async () => {
    const s = await iniciado();
    const noche = new Date('2026-10-21T03:00:00.000Z'); // 22:00 en Bogotá
    s.avanzar(noche);
    expect(await reenviarCod(ORDER, noche, s.deps)).toEqual({ accion: 'reprogramado', en: new Date('2026-10-21T12:00:00.000Z') });
    expect(s.wa.enviados).toHaveLength(1);
  });

  it('silencio que termina con menos de 1 h de vigencia del link: no se envía', async () => {
    const s = await iniciado({ pedido: { stock_reserved_until: new Date('2026-10-21T12:30:00.000Z') } });
    const noche = new Date('2026-10-21T03:00:00.000Z');
    s.avanzar(noche);
    expect(await reenviarCod(ORDER, noche, s.deps)).toEqual({ accion: 'link_vencido' });
  });

  it('pedido ya pagado, que no es contra entrega o con el link vencido: no envía', async () => {
    const s = await iniciado();
    s.pedido.status = 'abono_pagado';
    expect(await reenviarCod(ORDER, SOLICITUD, s.deps)).toEqual({ accion: 'omitido' });
    const v = await iniciado();
    v.avanzar(new Date(VENCE.getTime() + 1));
    expect(await reenviarCod(ORDER, new Date(VENCE.getTime() + 1), v.deps)).toEqual({ accion: 'link_vencido' });
    const sinLink = escenario();
    expect(await reenviarCod(ORDER, SOLICITUD, sinLink.deps)).toEqual({ accion: 'link_vencido' });
    expect(v.wa.enviados).toHaveLength(1);
  });

  it('fallo definitivo de WhatsApp: alerta y correo de respaldo', async () => {
    const s = await iniciado();
    s.wa.fallarCon = new ErrorWhatsApp('DESTINO', false, 400, '131026');
    expect(await reenviarCod(ORDER, SOLICITUD, s.deps)).toEqual({ accion: 'no_enviado' });
    expect(s.r.alertas).toContain('whatsapp_fallido');
    expect(s.r.correos.at(-1)).toBe('laura@example.com https://izaoperfumeria.com/pagar/TokCorto123');
  });
});
