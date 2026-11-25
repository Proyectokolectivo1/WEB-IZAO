import { describe, expect, it } from 'vitest';
import { rastrear } from './pixel-cliente';
import { ORIGEN_FBEVENTS, cargarFbevents, detenerPixel, iniciarPixel, sincronizarPixel, type VentanaFb } from './guion-pixel';

const CO = '111111111111111';
const EC = '222222222222222';

const llamadas = (w: VentanaFb): unknown[][] => (w.fbq?.queue ?? []).map((a) => Array.from(a as unknown as ArrayLike<unknown>));

function documentoFalso() {
  const insertados: { src?: string; async?: boolean }[] = [];
  const d = {
    createElement: () => ({}) as { src?: string; async?: boolean },
    getElementsByTagName: () => [{ parentNode: { insertBefore: (s: { src?: string }) => insertados.push(s) } }],
  } as unknown as Document;
  return { d, insertados };
}

describe('Meta Pixel: opt-in estricto', () => {
  it('sin consentimiento no existe fbq, no hay script y rastrear no envía nada', () => {
    const w: VentanaFb = {};
    expect(sincronizarPixel(false, CO, w)).toBe('nada');
    expect(w.fbq).toBeUndefined();
    expect(w.__izaoPixelId).toBeUndefined();
    expect(rastrear('ViewContent', {}, undefined, w)).toBe(false);
  });

  it('al aceptar inicia el Pixel del país y encola el PageView de la página actual (sin recargar)', () => {
    const w: VentanaFb = {};
    expect(sincronizarPixel(true, CO, w)).toBe('iniciado');
    expect(w.__izaoPixelId).toBe(CO);
    expect(llamadas(w)).toEqual([
      ['consent', 'grant'],
      ['init', CO],
      ['trackSingle', CO, 'PageView'],
    ]);
    expect(rastrear('AddToCart', { value: 1 }, undefined, w)).toBe(true);
    expect(llamadas(w).at(-1)).toEqual(['trackSingle', CO, 'AddToCart', { value: 1 }]);
  });

  it('es idempotente: aceptar dos veces (efectos repetidos) no duplica el PageView', () => {
    const w: VentanaFb = {};
    sincronizarPixel(true, CO, w);
    expect(sincronizarPixel(true, CO, w)).toBe('nada');
    expect(llamadas(w).filter((l) => l[2] === 'PageView')).toHaveLength(1);
  });

  it('fbevents.js se descarga una sola vez y solo al pedirlo', () => {
    const w: VentanaFb = {};
    const { d, insertados } = documentoFalso();
    sincronizarPixel(true, CO, w);
    expect(insertados).toHaveLength(0);
    expect(cargarFbevents(w, d)).toBe(true);
    expect(cargarFbevents(w, d)).toBe(false);
    expect(insertados).toHaveLength(1);
    expect(insertados[0]!.src).toBe(ORIGEN_FBEVENTS);
  });

  it('al retirar el consentimiento deja de enviar y avisa a Meta (revoke)', () => {
    const w: VentanaFb = {};
    sincronizarPixel(true, CO, w);
    expect(sincronizarPixel(false, CO, w)).toBe('detenido');
    expect(w.__izaoPixelId).toBeUndefined();
    expect(llamadas(w).at(-1)).toEqual(['consent', 'revoke']);
    const antes = llamadas(w).length;
    expect(rastrear('Purchase', {}, 'purchase_1', w)).toBe(false);
    expect(llamadas(w)).toHaveLength(antes);
  });

  it('si vuelve a aceptar sin recargar, reanuda sin repetir init y envía el PageView', () => {
    const w: VentanaFb = {};
    sincronizarPixel(true, CO, w);
    sincronizarPixel(false, CO, w);
    expect(sincronizarPixel(true, CO, w)).toBe('iniciado');
    const l = llamadas(w);
    expect(l.filter((x) => x[0] === 'init')).toHaveLength(1);
    expect(l.filter((x) => x[2] === 'PageView')).toHaveLength(2);
    expect(l.at(-2)).toEqual(['consent', 'grant']);
  });

  it('cada país usa su Pixel (trackSingle con su id) y nunca el del otro', () => {
    const co: VentanaFb = {};
    const ec: VentanaFb = {};
    iniciarPixel(CO, co);
    iniciarPixel(EC, ec);
    expect(JSON.stringify(llamadas(co))).not.toContain(EC);
    expect(JSON.stringify(llamadas(ec))).not.toContain(CO);
    expect(ec.__izaoPixelId).toBe(EC);
  });

  it('rechaza ids que no son dígitos (sin inyección)', () => {
    expect(() => iniciarPixel('1";alert(1);"', {})).toThrow();
    expect(() => iniciarPixel('', {})).toThrow();
  });

  it('detenerPixel sin Pixel iniciado no lanza', () => {
    expect(() => detenerPixel({})).not.toThrow();
  });
});
