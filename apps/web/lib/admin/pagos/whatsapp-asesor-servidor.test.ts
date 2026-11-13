import { beforeEach, describe, expect, it, vi } from 'vitest';

const { auditar } = vi.hoisted(() => ({ auditar: vi.fn(async (_e: unknown) => true) }));
vi.mock('@/lib/admin/auditoria', () => ({ auditarCambio: auditar }));

import { clienteFalso } from '../crud/cliente-falso';
import { esquemaWhatsappAsesor } from './whatsapp-asesor';
import { guardarWhatsappAsesorBd, leerWhatsappAsesor } from './whatsapp-asesor-servidor';

const comun = { actor: 'admin-1', ip: null };
const FILA = {
  advisor_whatsapp: '573001112233',
  advisor_whatsapp_message: null,
  advisor_whatsapp_button_enabled: true,
  updated_at: '2026-11-13T10:00:00Z',
};
const datos = (f: Record<string, string>) => esquemaWhatsappAsesor.parse(f);

beforeEach(() => auditar.mockClear());

describe('leerWhatsappAsesor', () => {
  it('devuelve número, mensaje, interruptor y prefijo del país', async () => {
    const { cliente } = clienteFalso({ 'country_settings.select': { data: FILA }, 'countries.select': { data: { phone_prefix: '+57' } } });
    expect(await leerWhatsappAsesor(cliente, 'CO')).toEqual({
      advisor_whatsapp: '573001112233',
      advisor_whatsapp_message: '',
      advisor_whatsapp_button_enabled: true,
      prefijo: '+57',
      updated_at: '2026-11-13T10:00:00Z',
    });
  });

  it('sin fila de ajustes devuelve null', async () => {
    const { cliente } = clienteFalso({ 'country_settings.select': { data: null }, 'countries.select': { data: { phone_prefix: '+57' } } });
    expect(await leerWhatsappAsesor(cliente, 'CO')).toBeNull();
  });
});

describe('guardarWhatsappAsesorBd', () => {
  it('normaliza con el prefijo del país, guarda y audita solo lo que cambió', async () => {
    const { cliente, llamadas } = clienteFalso({
      'country_settings.select': { data: FILA },
      'countries.select': { data: { phone_prefix: '+593' } },
      'country_settings.update': { data: null },
    });
    const r = await guardarWhatsappAsesorBd({
      cliente,
      ...comun,
      pais: 'EC',
      datos: datos({ advisor_whatsapp: '099 123 4567', advisor_whatsapp_message: 'Hola, necesito ayuda', advisor_whatsapp_button_enabled: 'on' }),
    });
    expect(r.ok).toBe(true);
    const upd = llamadas.find((l) => l.clave === 'country_settings.update')!.args[0];
    expect(upd).toEqual({ advisor_whatsapp: '593991234567', advisor_whatsapp_message: 'Hola, necesito ayuda', advisor_whatsapp_button_enabled: true });
    const ev = auditar.mock.calls[0]![0] as { accion: string; entidadId: string; diff: { antes: Record<string, unknown>; despues: Record<string, unknown> } };
    expect(ev.accion).toBe('pagos.whatsapp_asesor_actualizado');
    expect(ev.entidadId).toBe('EC');
    expect(ev.diff.despues).toEqual({ advisor_whatsapp: '593991234567', advisor_whatsapp_message: 'Hola, necesito ayuda' });
    expect(ev.diff.antes).toEqual({ advisor_whatsapp: '573001112233', advisor_whatsapp_message: null });
  });

  it('número inválido: no escribe y marca el campo', async () => {
    const { cliente, llamadas } = clienteFalso({
      'country_settings.select': { data: FILA },
      'countries.select': { data: { phone_prefix: '+57' } },
    });
    const r = await guardarWhatsappAsesorBd({ cliente, ...comun, pais: 'CO', datos: datos({ advisor_whatsapp: '12 34' }) });
    expect(r.ok).toBe(false);
    expect(r.ok ? null : r.errores?.advisor_whatsapp).toBeTruthy();
    expect(llamadas.some((l) => l.clave === 'country_settings.update')).toBe(false);
    expect(auditar).not.toHaveBeenCalled();
  });

  it('número vacío guarda null (el botón deja de verse)', async () => {
    const { cliente, llamadas } = clienteFalso({
      'country_settings.select': { data: FILA },
      'countries.select': { data: { phone_prefix: '+57' } },
      'country_settings.update': { data: null },
    });
    const r = await guardarWhatsappAsesorBd({ cliente, ...comun, pais: 'CO', datos: datos({ advisor_whatsapp: '', advisor_whatsapp_button_enabled: 'on' }) });
    expect(r.ok).toBe(true);
    expect((llamadas.find((l) => l.clave === 'country_settings.update')!.args[0] as Record<string, unknown>).advisor_whatsapp).toBeNull();
  });

  it('país sin ajustes y error de base', async () => {
    const sin = clienteFalso({ 'country_settings.select': { data: null }, 'countries.select': { data: { phone_prefix: '+57' } } });
    expect((await guardarWhatsappAsesorBd({ cliente: sin.cliente, ...comun, pais: 'CO', datos: datos({}) })).ok).toBe(false);
    const falla = clienteFalso({
      'country_settings.select': { data: FILA },
      'countries.select': { data: { phone_prefix: '+57' } },
      'country_settings.update': { error: { code: '23514', message: 'check violation' } },
    });
    const r = await guardarWhatsappAsesorBd({ cliente: falla.cliente, ...comun, pais: 'CO', datos: datos({ advisor_whatsapp: '3001234567' }) });
    expect(r.ok).toBe(false);
    expect(auditar).not.toHaveBeenCalled();
  });
});
