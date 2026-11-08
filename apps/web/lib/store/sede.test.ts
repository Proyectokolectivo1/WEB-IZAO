import { describe, expect, it } from 'vitest';
import { debeMostrarSede, leerCookie, type OpcionSede } from './sede';
import { opcionesSede } from './sede-opciones';
import { TP } from './textos-pais';

const CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';

describe('debeMostrarSede', () => {
  const base = { ruta: '/co', cookiePais: null, guardado: null, agente: CHROME };
  it('sale en la primera visita sin país elegido', () => {
    expect(debeMostrarSede(base)).toBe(true);
    expect(debeMostrarSede({ ...base, ruta: '/ec/catalogo' })).toBe(true);
  });
  it('no sale si ya hay cookie o copia local', () => {
    expect(debeMostrarSede({ ...base, cookiePais: 'ec' })).toBe(false);
    expect(debeMostrarSede({ ...base, guardado: 'CO' })).toBe(false);
  });
  it('una cookie con un valor raro no cuenta como elección', () => {
    expect(debeMostrarSede({ ...base, cookiePais: 'xx' })).toBe(true);
  });
  it('no sale en el pago, el seguimiento ni el checkout', () => {
    for (const ruta of ['/co/pagar/abc', '/ec/pedido/abc', '/co/checkout', '/co/checkout/politica']) {
      expect(debeMostrarSede({ ...base, ruta }), ruta).toBe(false);
    }
    expect(debeMostrarSede({ ...base, ruta: '/co/pagina/pagar' })).toBe(true);
  });
  it('no sale para robots ni Lighthouse', () => {
    for (const agente of ['Mozilla/5.0 (compatible; Googlebot/2.1)', 'Mozilla/5.0 Chrome-Lighthouse', 'Bingbot/2.0']) {
      expect(debeMostrarSede({ ...base, agente }), agente).toBe(false);
    }
  });
});

describe('opcionesSede', () => {
  it('usa los textos del seed sin espacios', () => {
    const [co, ec] = opcionesSede({ co: [], ec: [] }) as [OpcionSede, OpcionSede];
    expect(co).toMatchObject({ pais: 'co', nombre: 'Colombia', envio: TP.sede.paises.co.envio, pago: TP.sede.paises.co.pago });
    expect(ec).toMatchObject({ pais: 'ec', moneda: TP.sede.paises.ec.moneda });
  });
  it('toma del panel las líneas de cada país y respalda los campos vacíos', () => {
    const [co, ec] = opcionesSede({
      co: [{ key: 'sede_envio', body: '  Llegamos en 2 a 4 días  ' }, { key: 'sede_pago', body: '   ' }],
      ec: [{ key: 'sede_pago', body: 'Pagas por transferencia' }],
    }) as [OpcionSede, OpcionSede];
    expect(co.envio).toBe('Llegamos en 2 a 4 días');
    expect(co.pago).toBe(TP.sede.paises.co.pago);
    expect(ec.pago).toBe('Pagas por transferencia');
    expect(ec.envio).toBe(TP.sede.paises.ec.envio);
  });
});

describe('leerCookie', () => {
  it('encuentra una cookie entre varias', () => {
    expect(leerCookie({ cookie: 'a=1; country=ec; b=2' }, 'country')).toBe('ec');
    expect(leerCookie({ cookie: 'a=1' }, 'country')).toBeNull();
    expect(leerCookie({ cookie: '' }, 'country')).toBeNull();
  });
});
