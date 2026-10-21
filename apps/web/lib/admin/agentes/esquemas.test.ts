import { describe, expect, it } from 'vitest';
import {
  CAMPOS_VACIOS,
  camposDesdeConfig,
  configDesdeFormulario,
  esquemaConfigRemota,
  mezclarConfigRemota,
  type CamposFormularioAgente,
} from './esquemas';

const campos = (extra: Partial<CamposFormularioAgente> = {}): CamposFormularioAgente => ({ ...CAMPOS_VACIOS, ...extra });

const PASOS = JSON.stringify([
  {
    name: 'obtener_guia',
    enabled: true,
    actions: [
      { op: 'goto', url: 'https://panel.mastershop.example/pedidos' },
      { op: 'fill', selector: '#buscar', value: '{order_number}' },
      { op: 'click', selector: 'button.buscar' },
      { op: 'download', selector: 'a.guia', timeout_ms: 15000 },
    ],
  },
]);

describe('configDesdeFormulario', () => {
  it('formulario vacío en modo api da una configuración vacía (valores por defecto del agente)', () => {
    expect(configDesdeFormulario(campos())).toEqual({ ok: true, modo: 'api', config: {} });
  });

  it('arma print e intervals con números', () => {
    const r = configDesdeFormulario(campos({ print_copies: '2', print_settings: 'noscale', heartbeat_seconds: '45', claim_seconds: '8' }));
    expect(r).toEqual({ ok: true, modo: 'api', config: { print: { copies: 2, print_settings: 'noscale' }, intervals: { heartbeat_seconds: 45, claim_seconds: 8 } } });
  });

  it('rechaza valores fuera de los límites del agente, con el error en su campo', () => {
    const r = configDesdeFormulario(campos({ print_copies: '25', print_settings: 'noscale; calc.exe', heartbeat_seconds: '2', claim_seconds: 'abc' }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.errores).sort()).toEqual(['claim_seconds', 'heartbeat_seconds', 'print_copies', 'print_settings']);
    }
  });

  it('modo panel exige la URL y esta debe ser https', () => {
    const sinUrl = configDesdeFormulario(campos({ mode: 'panel' }));
    expect(sinUrl.ok).toBe(false);
    const http = configDesdeFormulario(campos({ mode: 'panel', panel_base_url: 'http://panel.example.com' }));
    expect(http.ok).toBe(false);
    if (!http.ok) expect(http.errores.panel_base_url).toMatch(/https/);
  });

  it('arma el panel con selectores por línea y pasos en JSON', () => {
    const r = configDesdeFormulario(
      campos({
        mode: 'panel',
        panel_base_url: 'https://panel.mastershop.example/',
        panel_logged_in_selector: '#menu-usuario',
        panel_logged_out_selectors: '#login\n  form.ingreso  \n\n',
        panel_challenge_title_patterns: 'Just a moment|Verificando',
        panel_steps: PASOS,
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.modo).toBe('panel');
      expect(r.config.panel).toMatchObject({
        base_url: 'https://panel.mastershop.example/',
        logged_in_selector: '#menu-usuario',
        logged_out_selectors: ['#login', 'form.ingreso'],
        challenge_title_patterns: ['Just a moment|Verificando'],
      });
      expect(r.config.panel?.steps?.[0]?.actions).toHaveLength(4);
    }
  });

  it('un goto a otro sitio, una operación inventada o un selector faltante se rechazan', () => {
    const base = { mode: 'panel', panel_base_url: 'https://panel.mastershop.example/' };
    const otroHost = configDesdeFormulario(
      campos({ ...base, panel_steps: JSON.stringify([{ name: 'x', actions: [{ op: 'goto', url: 'https://malo.example.org/' }] }]) }),
    );
    expect(otroHost.ok).toBe(false);
    if (!otroHost.ok) expect(otroHost.errores.panel_steps).toMatch(/otro sitio/);

    const operacion = configDesdeFormulario(campos({ ...base, panel_steps: JSON.stringify([{ name: 'x', actions: [{ op: 'eval', value: 'alert(1)' }] }]) }));
    expect(operacion.ok).toBe(false);

    const sinSelector = configDesdeFormulario(campos({ ...base, panel_steps: JSON.stringify([{ name: 'x', actions: [{ op: 'click' }] }]) }));
    expect(sinSelector.ok).toBe(false);
    if (!sinSelector.ok) expect(sinSelector.errores.panel_steps).toMatch(/selector/);
  });

  it('JSON roto o que no es lista, y expresiones regulares inválidas', () => {
    const base = { mode: 'panel', panel_base_url: 'https://panel.mastershop.example/' };
    expect(configDesdeFormulario(campos({ ...base, panel_steps: '{ no es json' })).ok).toBe(false);
    expect(configDesdeFormulario(campos({ ...base, panel_steps: '{"a":1}' })).ok).toBe(false);
    const regex = configDesdeFormulario(campos({ ...base, panel_challenge_title_patterns: '([' }));
    expect(regex.ok).toBe(false);
    if (!regex.ok) expect(regex.errores.panel_challenge_title_patterns).toBeDefined();
  });

  it('rechaza un modo desconocido', () => {
    expect(configDesdeFormulario(campos({ mode: 'turbo' })).ok).toBe(false);
  });
});

describe('camposDesdeConfig / mezclarConfigRemota', () => {
  it('ida y vuelta sin pérdidas', () => {
    const r = configDesdeFormulario(
      campos({ mode: 'panel', print_copies: '1', panel_base_url: 'https://panel.mastershop.example/', panel_logged_out_selectors: '#a\n#b', panel_steps: PASOS }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const vuelta = camposDesdeConfig('panel', r.config);
    expect(vuelta.panel_logged_out_selectors).toBe('#a\n#b');
    expect(vuelta.print_copies).toBe('1');
    const otra = configDesdeFormulario(vuelta);
    expect(otra).toEqual(r);
  });

  it('tolera datos guardados raros sin lanzar', () => {
    expect(camposDesdeConfig('x', null)).toEqual(CAMPOS_VACIOS);
    expect(camposDesdeConfig('api', { print: 'no', intervals: [], panel: 5 })).toEqual(CAMPOS_VACIOS);
  });

  it('conserva claves ajenas al formulario y reemplaza las editadas', () => {
    const nueva = mezclarConfigRemota({ print: { copies: 5 }, intervals: { claim_seconds: 30 }, futuro: { a: 1 } }, { print: { copies: 2 } });
    expect(nueva).toEqual({ futuro: { a: 1 }, print: { copies: 2 } });
  });

  it('el esquema es estricto con claves desconocidas', () => {
    expect(esquemaConfigRemota.safeParse({ print: { copies: 1, tinta: 'roja' } }).success).toBe(false);
  });
});
