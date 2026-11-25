import { afterEach, describe, expect, it, vi } from 'vitest';
import { ORIGEN_FBEVENTS, guionPixel } from './guion-pixel';

interface FbqFalso {
  (...a: unknown[]): void;
  queue: unknown[][];
}

function ejecutar(codigo: string, estadoDoc: 'loading' | 'complete') {
  const hijos: { src?: string }[] = [];
  const w: Record<string, unknown> = {};
  const escuchas: Record<string, () => void> = {};
  w.addEventListener = (n: string, f: () => void) => {
    escuchas[n] = f;
  };
  const d = {
    readyState: estadoDoc,
    createElement: () => ({}) as { src?: string },
    getElementsByTagName: () => [{ parentNode: { insertBefore: (s: { src?: string }) => hijos.push(s) } }],
  };
  vi.useFakeTimers();
  new Function('window', 'document', codigo)(w, d);
  return { w, hijos, escuchas, correrTimers: () => vi.runAllTimers() };
}

afterEach(() => vi.useRealTimers());

describe('guion del Meta Pixel', () => {
  it('inicia el Pixel del país y encola PageView con trackSingle', () => {
    const { w } = ejecutar(guionPixel('111111111111111'), 'loading');
    const fbq = w.fbq as FbqFalso;
    expect(w.__izaoPixelId).toBe('111111111111111');
    expect(fbq.queue.map((a) => Array.from(a as unknown as ArrayLike<unknown>))).toEqual([
      ['init', '111111111111111'],
      ['trackSingle', '111111111111111', 'PageView'],
    ]);
  });

  it('no descarga fbevents.js hasta el evento load', () => {
    const r = ejecutar(guionPixel('111111111111111'), 'loading');
    r.correrTimers();
    expect(r.hijos).toHaveLength(0);
    r.escuchas.load!();
    r.correrTimers();
    expect(r.hijos[0]!.src).toBe(ORIGEN_FBEVENTS);
  });

  it('si la página ya cargó, descarga enseguida (una vez)', () => {
    const r = ejecutar(guionPixel('222222222222222'), 'complete');
    r.correrTimers();
    expect(r.hijos).toHaveLength(1);
  });

  it('rechaza ids que no son dígitos (sin inyección de código)', () => {
    expect(() => guionPixel('1";alert(1);"')).toThrow();
    expect(() => guionPixel('')).toThrow();
  });

  it('el guion no contiene tokens ni referencias a la API de Conversiones', () => {
    expect(guionPixel('111111111111111')).not.toMatch(/access_token|capi|EAA/i);
  });
});
