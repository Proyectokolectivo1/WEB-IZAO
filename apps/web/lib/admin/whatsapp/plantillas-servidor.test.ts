import { beforeEach, describe, expect, it, vi } from 'vitest';

const { auditar } = vi.hoisted(() => ({ auditar: vi.fn(async (_e: unknown) => true) }));
vi.mock('@/lib/admin/auditoria', () => ({ auditarCambio: auditar }));

import { ErrorWhatsApp, PLANTILLAS_META, type CredencialesWhatsApp } from '@izao/whatsapp';
import { clienteFalso } from '../crud/cliente-falso';
import { esquemaPlantilla, type FilaPlantilla } from './plantillas';
import {
  crearDesdeTextoPorDefectoBd,
  crearVersionBd,
  enviarAAprobacionBd,
  guardarBorradorBd,
} from './plantillas-servidor';

const ID = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';
const comun = { actor: 'u1', ip: null };

const MAPA = {
  '1': 'customer_first_name',
  '2': 'order_number',
  '3': 'cod_deposit_amount',
  '4': 'cod_collect_amount',
  '5': 'pay_link_expires_at',
  button_url_1: 'pay_link_token',
};
const fila = (extra: Partial<FilaPlantilla> = {}): FilaPlantilla => ({
  id: ID,
  key: 'cobro_abono',
  country_code: 'CO',
  meta_template_name: 'cobro_abono_v2',
  meta_template_id: null,
  language: 'es',
  body_text: 'Hola, {{1}}. Tu pedido {{2}} espera el abono de {{3}}. Al recibir pagas {{4}}. Disponible hasta el {{5}}.',
  footer_text: 'Izao Perfumería',
  button_text: 'Pagar abono',
  button_url: 'https://izaoperfumeria.com/pagar/{{1}}',
  variables_map: MAPA,
  meta_status: 'draft',
  meta_rejection_reason: null,
  version: 2,
  is_active: false,
  updated_at: '2026-10-20T10:00:00Z',
  ...extra,
});

const creds: CredencialesWhatsApp = {
  phoneNumberId: '1234567890',
  wabaId: '9876543210',
  tokenAcceso: 'TOKEN-SECRETO-NO-DEBE-SALIR',
  appSecret: 'x',
  tokenVerificacion: 'y',
  versionGraph: 'v26.0',
};

beforeEach(() => auditar.mockClear());

describe('guardarBorradorBd', () => {
  const datos = (extra: Record<string, string> = {}) =>
    esquemaPlantilla.parse({
      id: ID,
      language: 'es',
      body_text: 'Hola, {{1}}. Tu pedido {{2}} sigue reservado y esperamos tu abono pronto.',
      footer_text: 'Izao',
      button_text: 'Pagar abono',
      button_url: 'https://izaoperfumeria.com/pagar/{{1}}',
      variables_map: JSON.stringify({ '1': 'customer_first_name', '2': 'order_number', '9': 'order_number' }),
      ...extra,
    });

  it('guarda el borrador, limpia el mapa, audita el cambio y devuelve los problemas pendientes', async () => {
    const { cliente, llamadas } = clienteFalso({
      'whatsapp_templates.select': { data: fila() },
      'whatsapp_templates.update': { data: [{ id: ID }] },
    });
    const r = await guardarBorradorBd({ cliente, datos: datos(), ...comun });
    expect(r.ok).toBe(true);
    const upd = llamadas.find((l) => l.clave === 'whatsapp_templates.update')?.args[0] as { variables_map: Record<string, string> };
    expect(upd.variables_map).toEqual({ '1': 'customer_first_name', '2': 'order_number', button_url_1: 'pay_link_token' });
    expect(auditar).toHaveBeenCalledTimes(1);
    expect(auditar.mock.calls[0]![0]).toMatchObject({ accion: 'whatsapp.plantilla_editada', entidadId: ID });
    // El texto termina en palabra, sin variables en los extremos: sin problemas
    expect(r.problemas).toEqual([]);
  });

  it('no edita una plantilla ya enviada', async () => {
    const { cliente, llamadas } = clienteFalso({ 'whatsapp_templates.select': { data: fila({ meta_status: 'pending' }) } });
    const r = await guardarBorradorBd({ cliente, datos: datos(), ...comun });
    expect(r.ok).toBe(false);
    expect(llamadas.some((l) => l.clave === 'whatsapp_templates.update')).toBe(false);
    expect(auditar).not.toHaveBeenCalled();
  });

  it('si cambió de estado entre la lectura y la escritura, no pisa nada', async () => {
    const { cliente } = clienteFalso({
      'whatsapp_templates.select': { data: fila() },
      'whatsapp_templates.update': { data: [] },
    });
    const r = await guardarBorradorBd({ cliente, datos: datos(), ...comun });
    expect(r).toMatchObject({ ok: false });
    expect(auditar).not.toHaveBeenCalled();
  });

  it('plantilla inexistente', async () => {
    const { cliente } = clienteFalso({ 'whatsapp_templates.select': { data: null } });
    expect(await guardarBorradorBd({ cliente, datos: datos(), ...comun })).toMatchObject({ ok: false });
  });
});

describe('crearVersionBd', () => {
  it('crea la versión siguiente como borrador inactivo con nombre derivado', async () => {
    const { cliente, llamadas } = clienteFalso({
      'whatsapp_templates.select': [
        { data: fila({ meta_status: 'rejected', version: 2 }) },
        { data: [{ id: ID, version: 2, meta_status: 'rejected' }, { id: 'a', version: 1, meta_status: 'approved' }] },
      ],
      'whatsapp_templates.insert': { data: { id: ID2 } },
    });
    const r = await crearVersionBd({ cliente, desdeId: ID, ...comun });
    expect(r).toMatchObject({ ok: true, id: ID2 });
    const ins = llamadas.find((l) => l.clave === 'whatsapp_templates.insert')?.args[0] as Record<string, unknown>;
    expect(ins).toMatchObject({ version: 3, meta_template_name: 'cobro_abono_v3', meta_status: 'draft', is_active: false, category: 'UTILITY' });
    expect(ins).not.toHaveProperty('meta_template_id');
    expect(auditar.mock.calls[0]![0]).toMatchObject({ accion: 'whatsapp.plantilla_version_creada' });
  });

  it('si ya hay un borrador, lo devuelve en lugar de crear otro', async () => {
    const { cliente, llamadas } = clienteFalso({
      'whatsapp_templates.select': [
        { data: fila({ meta_status: 'approved' }) },
        { data: [{ id: ID2, version: 3, meta_status: 'draft' }, { id: ID, version: 2, meta_status: 'approved' }] },
      ],
    });
    const r = await crearVersionBd({ cliente, desdeId: ID, ...comun });
    expect(r).toMatchObject({ ok: true, id: ID2 });
    expect(llamadas.some((l) => l.clave === 'whatsapp_templates.insert')).toBe(false);
  });

  it('un choque de versión (23505) se explica sin detalles técnicos', async () => {
    const { cliente } = clienteFalso({
      'whatsapp_templates.select': [{ data: fila() }, { data: [{ id: ID, version: 2, meta_status: 'approved' }] }],
      'whatsapp_templates.insert': { error: { code: '23505', message: 'duplicate key value violates unique constraint' } },
    });
    const r = await crearVersionBd({ cliente, desdeId: ID, ...comun });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain('duplicate key');
  });
});

describe('crearDesdeTextoPorDefectoBd', () => {
  it('crea la versión 1 desde el texto por defecto', async () => {
    const { cliente, llamadas } = clienteFalso({
      'whatsapp_templates.select': { data: [] },
      'whatsapp_templates.insert': { data: { id: ID } },
    });
    const r = await crearDesdeTextoPorDefectoBd({ cliente, pais: 'EC', clave: 'recordatorio_abono_final', ...comun });
    expect(r).toMatchObject({ ok: true, id: ID });
    const ins = llamadas.find((l) => l.clave === 'whatsapp_templates.insert')?.args[0] as Record<string, unknown>;
    expect(ins).toMatchObject({ country_code: 'EC', key: 'recordatorio_abono_final', meta_template_name: 'recordatorio_abono_final_v1', version: 1, meta_status: 'draft' });
  });

  it.each(Object.entries(PLANTILLAS_META))(
    '%s se crea con el idioma y las variables de Meta (D-048/D-049), sin botón',
    async (clave, meta) => {
      const { cliente, llamadas } = clienteFalso({
        'whatsapp_templates.select': { data: [] },
        'whatsapp_templates.insert': { data: { id: ID } },
      });
      const r = await crearDesdeTextoPorDefectoBd({ cliente, pais: 'CO', clave, ...comun });
      expect(r.ok).toBe(true);
      const ins = llamadas.find((l) => l.clave === 'whatsapp_templates.insert')?.args[0] as Record<string, unknown>;
      expect(ins.language).toBe(meta?.language);
      expect(ins.language).toBe('es_CO');
      expect(ins.button_text).toBeNull();
      expect(ins.button_url).toBeNull();
      expect(ins.footer_text).toBeNull();
      const esperado =
        clave === 'pedido_cancelado_24h'
          ? { '1': 'customer_first_name', '2': 'order_number' }
          : { '1': 'customer_first_name', '2': 'order_number', '3': 'cod_deposit_amount', '4': 'pay_link_url' };
      expect(ins.variables_map).toEqual(esperado);
    },
  );

  it('rechaza claves desconocidas y claves que ya existen', async () => {
    const a = clienteFalso({});
    expect(await crearDesdeTextoPorDefectoBd({ cliente: a.cliente, pais: 'CO', clave: 'otra', ...comun })).toMatchObject({ ok: false });
    const b = clienteFalso({ 'whatsapp_templates.select': { data: [{ id: ID }] } });
    expect(await crearDesdeTextoPorDefectoBd({ cliente: b.cliente, pais: 'CO', clave: 'cobro_abono', ...comun })).toMatchObject({ ok: false });
  });
});

describe('enviarAAprobacionBd', () => {
  const metaOk = (status = 'PENDING') => ({
    crearPlantilla: vi.fn(async (_s: unknown) => ({ meta_template_id: '555', status })),
    enviarPlantilla: vi.fn(),
  });

  it('envía a Meta con ejemplos, guarda el id y deja la plantilla en revisión', async () => {
    const { cliente, llamadas } = clienteFalso({
      'whatsapp_templates.select': { data: fila() },
      'whatsapp_templates.update': { data: [{ id: ID }] },
    });
    const meta = metaOk();
    const r = await enviarAAprobacionBd({ cliente, id: ID, ...comun, credenciales: async () => creds, crearClienteMeta: () => meta });
    expect(r.ok).toBe(true);
    const solicitud = meta.crearPlantilla.mock.calls[0]![0] as { name: string; category: string; components: { type: string }[] };
    expect(solicitud).toMatchObject({ name: 'cobro_abono_v2', category: 'UTILITY' });
    expect(solicitud.components.map((c) => c.type)).toEqual(['BODY', 'FOOTER', 'BUTTONS']);
    const updates = llamadas.filter((l) => l.clave === 'whatsapp_templates.update').map((l) => l.args[0] as Record<string, unknown>);
    expect(updates[0]).toMatchObject({ meta_status: 'pending' });
    expect(updates[1]).toMatchObject({ meta_template_id: '555' });
    expect(updates[1]).not.toHaveProperty('meta_status');
    expect(auditar.mock.calls[0]![0]).toMatchObject({ accion: 'whatsapp.plantilla_enviada_a_aprobacion' });
    expect(JSON.stringify(auditar.mock.calls)).not.toContain('TOKEN-SECRETO');
  });

  it('si Meta la rechaza al crearla queda rechazada', async () => {
    const { cliente, llamadas } = clienteFalso({
      'whatsapp_templates.select': { data: fila() },
      'whatsapp_templates.update': { data: [{ id: ID }] },
    });
    const r = await enviarAAprobacionBd({ cliente, id: ID, ...comun, credenciales: async () => creds, crearClienteMeta: () => metaOk('REJECTED') });
    expect(r.ok).toBe(true);
    const ultimo = llamadas.filter((l) => l.clave === 'whatsapp_templates.update').at(-1)!.args[0] as Record<string, unknown>;
    expect(ultimo).toMatchObject({ meta_status: 'rejected' });
  });

  it('con problemas de texto no llama a Meta y los devuelve', async () => {
    const { cliente } = clienteFalso({ 'whatsapp_templates.select': { data: fila({ body_text: '{{1}} hola', variables_map: {} }) } });
    const meta = metaOk();
    const r = await enviarAAprobacionBd({ cliente, id: ID, ...comun, credenciales: async () => creds, crearClienteMeta: () => meta });
    expect(r.ok).toBe(false);
    expect((r.problemas ?? []).length).toBeGreaterThan(0);
    expect(meta.crearPlantilla).not.toHaveBeenCalled();
  });

  it('sin credenciales no reserva ni llama a Meta', async () => {
    const { cliente, llamadas } = clienteFalso({ 'whatsapp_templates.select': { data: fila() } });
    const r = await enviarAAprobacionBd({ cliente, id: ID, ...comun, credenciales: async () => null, crearClienteMeta: () => metaOk() });
    expect(r).toMatchObject({ ok: false });
    expect(llamadas.some((l) => l.clave === 'whatsapp_templates.update')).toBe(false);
  });

  it('solo se envía un borrador', async () => {
    const { cliente } = clienteFalso({ 'whatsapp_templates.select': { data: fila({ meta_status: 'rejected' }) } });
    const meta = metaOk();
    const r = await enviarAAprobacionBd({ cliente, id: ID, ...comun, credenciales: async () => creds, crearClienteMeta: () => meta });
    expect(r.ok).toBe(false);
    expect(meta.crearPlantilla).not.toHaveBeenCalled();
  });

  it('un doble clic: si la reserva no cambia filas, no llama a Meta', async () => {
    const { cliente } = clienteFalso({
      'whatsapp_templates.select': { data: fila() },
      'whatsapp_templates.update': { data: [] },
    });
    const meta = metaOk();
    const r = await enviarAAprobacionBd({ cliente, id: ID, ...comun, credenciales: async () => creds, crearClienteMeta: () => meta });
    expect(r.ok).toBe(false);
    expect(meta.crearPlantilla).not.toHaveBeenCalled();
  });

  it('si Meta falla vuelve a borrador y el mensaje no filtra secretos', async () => {
    const { cliente, llamadas } = clienteFalso({
      'whatsapp_templates.select': { data: fila() },
      'whatsapp_templates.update': { data: [{ id: ID }] },
    });
    const meta = {
      crearPlantilla: vi.fn(async () => {
        throw new ErrorWhatsApp('CREDENCIALES', false, 401, '190');
      }),
      enviarPlantilla: vi.fn(),
    };
    const r = await enviarAAprobacionBd({ cliente, id: ID, ...comun, credenciales: async () => creds, crearClienteMeta: () => meta });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain('TOKEN-SECRETO');
    const ultimo = llamadas.filter((l) => l.clave === 'whatsapp_templates.update').at(-1)!.args[0] as Record<string, unknown>;
    expect(ultimo).toMatchObject({ meta_status: 'draft' });
    expect(auditar).not.toHaveBeenCalled();
  });
});
