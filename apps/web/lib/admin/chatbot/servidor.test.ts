import { beforeEach, describe, expect, it, vi } from 'vitest';

const { auditar, invalidar } = vi.hoisted(() => ({ auditar: vi.fn(async (_e: unknown) => true), invalidar: vi.fn() }));
vi.mock('@/lib/admin/auditoria', () => ({ auditarCambio: auditar }));
vi.mock('next/cache', () => ({ revalidateTag: invalidar }));

import { clienteFalso } from '../crud/cliente-falso';
import { esquemaAjustesChat, leerFiltrosConversacion } from './chatbot';
import {
  conversionDelChat,
  consumoReciente,
  guardarAjustesChatBd,
  hayCredencialOpenRouter,
  herramientasDe,
  leerAjustesChat,
  listarSesiones,
  obtenerConversacion,
} from './servidor';

const comun = { actor: 'u1', ip: null };
const SID = '77777777-7777-4777-8777-777777777777';
const form = {
  is_enabled: 'on',
  model_primary: 'google/gemini-2.5-flash',
  model_fallback: '',
  presupuesto: '12.5',
  degrade_at_pct: '80',
  extra_instructions: '',
  welcome_CO: 'Hola',
  welcome_EC: '',
  max_output_tokens: '450',
  history_turns: '12',
  max_input_chars: '500',
  max_messages_per_session: '30',
};
const previo = { is_enabled: false, model_primary: null, monthly_budget_usd_micros: 10000000, welcome_message: { CO: 'viejo', EC: 'quedo' } };

beforeEach(() => {
  auditar.mockClear();
  invalidar.mockClear();
});

describe('ajustes', () => {
  it('lee el presupuesto como bigint', async () => {
    const { cliente } = clienteFalso({
      'chat_settings.select': { data: { ...previo, monthly_budget_usd_micros: '10000000', degrade_at_pct: 80, welcome_message: null } },
    });
    const a = await leerAjustesChat(cliente);
    expect(a?.monthly_budget_usd_micros).toBe(10_000_000n);
    expect(a?.welcome_message).toEqual({});
  });

  it('guarda con upsert de la fila única, conserva otros países de la bienvenida, audita la activación e invalida', async () => {
    const { cliente, llamadas } = clienteFalso({ 'chat_settings.select': { data: previo }, 'chat_settings.upsert': {} });
    const r = await guardarAjustesChatBd({ cliente, datos: esquemaAjustesChat.parse(form), ...comun });
    expect(r).toEqual({ ok: true, id: 'global' });
    const up = llamadas.find((l) => l.clave === 'chat_settings.upsert')!;
    expect(up.args[0]).toMatchObject({
      id: true,
      is_enabled: true,
      model_primary: 'google/gemini-2.5-flash',
      monthly_budget_usd_micros: '12500000',
      welcome_message: { CO: 'Hola' }, // EC vacío = sin mensaje propio
    });
    expect(up.args[1]).toEqual({ onConflict: 'id' });
    expect(auditar).toHaveBeenCalledWith(expect.objectContaining({ accion: 'chatbot.activado', entidad: 'chat_settings' }));
    expect(invalidar).toHaveBeenCalled();
  });

  it('desactivar y guardar sin cambiar el estado se auditan distinto', async () => {
    const act = clienteFalso({ 'chat_settings.select': { data: { ...previo, is_enabled: true } }, 'chat_settings.upsert': {} });
    await guardarAjustesChatBd({ cliente: act.cliente, datos: esquemaAjustesChat.parse({ ...form, is_enabled: '' }), ...comun });
    expect(auditar).toHaveBeenLastCalledWith(expect.objectContaining({ accion: 'chatbot.desactivado' }));
    const igual = clienteFalso({ 'chat_settings.select': { data: { ...previo, is_enabled: true } }, 'chat_settings.upsert': {} });
    await guardarAjustesChatBd({ cliente: igual.cliente, datos: esquemaAjustesChat.parse(form), ...comun });
    expect(auditar).toHaveBeenLastCalledWith(expect.objectContaining({ accion: 'chatbot.ajustes_guardados' }));
  });

  it('un error de la base no audita', async () => {
    const { cliente } = clienteFalso({ 'chat_settings.select': { data: previo }, 'chat_settings.upsert': { error: { code: '23514', message: 'check' } } });
    expect((await guardarAjustesChatBd({ cliente, datos: esquemaAjustesChat.parse(form), ...comun })).ok).toBe(false);
    expect(auditar).not.toHaveBeenCalled();
  });

  it('detecta si hay credencial activa de OpenRouter', async () => {
    const si = clienteFalso({ 'integration_credentials.select': { count: 1 } });
    const no = clienteFalso({ 'integration_credentials.select': { count: 0 } });
    expect(await hayCredencialOpenRouter(si.cliente)).toBe(true);
    expect(await hayCredencialOpenRouter(no.cliente)).toBe(false);
    expect(si.filtros.map((f) => [f.metodo, ...f.args])).toEqual(expect.arrayContaining([['eq', 'provider', 'openrouter'], ['eq', 'is_active', true]]));
  });
});

describe('consumo y conversión', () => {
  it('lee el consumo mensual como bigint', async () => {
    const { cliente } = clienteFalso({ 'chat_usage_monthly.select': { data: [{ month: '2026-10-01', cost_usd_micros: '3450000', messages: 120 }] } });
    expect(await consumoReciente(cliente)).toEqual([{ month: '2026-10-01', costo: 3_450_000n, mensajes: 120 }]);
  });

  it('la conversión cuenta sesiones con mensajes y las que terminaron en pedido', async () => {
    const { cliente, filtros } = clienteFalso({ 'chat_sessions.select': [{ count: 40 }, { count: 3 }] });
    const c = await conversionDelChat(cliente, { desde: '2026-10-01', hasta: '2026-10-20' });
    expect(c).toEqual({ sesiones: 40, convertidas: 3, bp: 750n });
    expect(filtros.map((f) => [f.metodo, ...f.args])).toEqual(
      expect.arrayContaining([['gt', 'messages_count', 0], ['gte', 'started_at', '2026-10-01T05:00:00.000Z'], ['not', 'converted_order_id', 'is', null]]),
    );
  });
});

describe('conversaciones', () => {
  it('con búsqueda de texto filtra por las sesiones que coinciden; sin coincidencias no consulta más', async () => {
    const con = clienteFalso({
      'chat_messages.select': { data: [{ session_id: SID }, { session_id: SID }] },
      'chat_sessions.select': { data: [{ id: SID, country_code: 'CO' }], count: 1 },
    });
    const r = await listarSesiones(con.cliente, leerFiltrosConversacion({ q: 'envío', pais: 'CO', convertida: 'si' }));
    expect(r.total).toBe(1);
    expect(con.filtros.find((f) => f.tabla === 'chat_messages' && f.metodo === 'ilike')?.args).toEqual(['content', '%envío%']);
    expect(con.filtros.find((f) => f.tabla === 'chat_sessions' && f.metodo === 'in')?.args).toEqual(['id', [SID]]);
    const sin = clienteFalso({ 'chat_messages.select': { data: [] } });
    expect(await listarSesiones(sin.cliente, leerFiltrosConversacion({ q: 'nada' }))).toEqual({ filas: [], total: 0 });
    expect(sin.llamadas.some((l) => l.clave === 'chat_sessions.select')).toBe(false);
  });

  it('lee la conversación con sus mensajes y suma el costo', async () => {
    const { cliente } = clienteFalso({
      'chat_sessions.select': { data: { id: SID, country_code: 'CO' } },
      'chat_messages.select': {
        data: [
          { id: 'a', role: 'user', content: 'hola', tool_calls: null, model: null, cost_usd_micros: 0, created_at: 'x' },
          { id: 'b', role: 'assistant', content: 'hola', tool_calls: [{ function: { name: 'buscar_productos', arguments: '{"q":"datos"}' } }], model: 'm', cost_usd_micros: '1500', created_at: 'y' },
        ],
      },
    });
    const c = await obtenerConversacion(cliente, SID);
    expect(c?.mensajes).toHaveLength(2);
    expect(c?.costoTotal).toBe(1500n);
    expect(await obtenerConversacion(clienteFalso({ 'chat_sessions.select': { data: null } }).cliente, SID)).toBeNull();
  });

  it('de las herramientas solo se muestran los nombres, nunca los argumentos', () => {
    expect(herramientasDe([{ function: { name: 'buscar_productos', arguments: '{"celular":"300"}' } }, { name: 'estado_pedido' }, { function: { name: 'DROP TABLE' } }])).toEqual([
      'buscar_productos',
      'estado_pedido',
    ]);
    expect(herramientasDe(null)).toEqual([]);
  });
});
