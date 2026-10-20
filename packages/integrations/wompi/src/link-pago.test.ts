import { describe, expect, it } from 'vitest';
import { ErrorWompi } from './cliente';
import { crearLinkPago, cuerpoLinkAbono, fechaWompiUtc, urlLinkPago } from './link-pago';
import { LLAVE_PRIVADA_PRUEBA } from './mock';

const ENTRADA = {
  numeroPedido: 'IZ-CO-000123',
  montoAbono: 30_000n,
  moneda: 'COP' as const,
  expiraEn: new Date('2026-10-21T15:04:05.678Z'),
  urlRetorno: 'https://izaoperfumeria.com/co/pedido/tok_publico_123',
};

interface Llamada {
  url: string;
  metodo: string;
  autorizacion: string | null;
  cuerpo: unknown;
}

function fetchFalso(respuesta: { status: number; cuerpo?: unknown } = { status: 201, cuerpo: { data: { id: 'test_AbC123' } } }) {
  const llamadas: Llamada[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    const h = new Headers(init?.headers);
    llamadas.push({
      url: String(url),
      metodo: init?.method ?? 'GET',
      autorizacion: h.get('authorization'),
      cuerpo: init?.body ? JSON.parse(String(init.body)) : null,
    });
    return new Response(respuesta.cuerpo === undefined ? '' : JSON.stringify(respuesta.cuerpo), { status: respuesta.status });
  }) as typeof fetch;
  return { f, llamadas };
}

describe('link de pago del abono (POST /v1/payment_links, D-025)', () => {
  it('cuerpo: nombre con el número, uso único, sin envío, COP, centavos, vencimiento UTC sin milisegundos, sku', () => {
    expect(cuerpoLinkAbono(ENTRADA)).toEqual({
      name: 'Abono pedido IZ-CO-000123',
      description: 'Abono del pedido IZ-CO-000123 con pago contra entrega',
      single_use: true,
      collect_shipping: false,
      currency: 'COP',
      amount_in_cents: 3_000_000,
      expires_at: '2026-10-21T15:04:05',
      redirect_url: ENTRADA.urlRetorno,
      sku: 'IZ-CO-000123',
    });
  });

  it('fecha en UTC con el formato del ejemplo oficial', () => {
    expect(fechaWompiUtc(new Date('2026-01-02T03:04:05.999Z'))).toBe('2026-01-02T03:04:05');
  });

  it('rechaza monto no positivo, moneda distinta de COP, sku largo y redirección sin https', () => {
    expect(() => cuerpoLinkAbono({ ...ENTRADA, montoAbono: 0n })).toThrow(RangeError);
    expect(() => cuerpoLinkAbono({ ...ENTRADA, moneda: 'USD' as never })).toThrow(RangeError);
    expect(() => cuerpoLinkAbono({ ...ENTRADA, numeroPedido: 'X'.repeat(37) })).toThrow(RangeError);
    expect(() => cuerpoLinkAbono({ ...ENTRADA, urlRetorno: 'http://izaoperfumeria.com/x' })).toThrow(RangeError);
  });

  it('POST a sandbox con la llave privada y devuelve id y URL del checkout', async () => {
    const { f, llamadas } = fetchFalso();
    const r = await crearLinkPago({ ambiente: 'sandbox', llavePrivada: LLAVE_PRIVADA_PRUEBA, fetchImpl: f }, ENTRADA);
    expect(llamadas[0]).toMatchObject({
      url: 'https://sandbox.wompi.co/v1/payment_links',
      metodo: 'POST',
      autorizacion: `Bearer ${LLAVE_PRIVADA_PRUEBA}`,
    });
    expect((llamadas[0]!.cuerpo as { amount_in_cents: number }).amount_in_cents).toBe(3_000_000);
    expect(r).toEqual({ id: 'test_AbC123', url: 'https://checkout.wompi.co/l/test_AbC123' });
  });

  it('urlLinkPago escapa el id', () => {
    expect(urlLinkPago('a/b')).toBe('https://checkout.wompi.co/l/a%2Fb');
  });

  it('errores: 401 credenciales sin reintento, 5xx reintentable, respuesta sin id inválida; nunca la llave', async () => {
    const op = (status: number, cuerpo?: unknown) => ({
      ambiente: 'sandbox' as const,
      llavePrivada: LLAVE_PRIVADA_PRUEBA,
      fetchImpl: fetchFalso({ status, cuerpo }).f,
    });
    const e401 = await crearLinkPago(op(401, {}), ENTRADA).catch((x: unknown) => x);
    expect(e401).toMatchObject({ codigo: 'CREDENCIALES', reintentable: false });
    const e503 = await crearLinkPago(op(503, {}), ENTRADA).catch((x: unknown) => x);
    expect(e503).toMatchObject({ codigo: 'HTTP', reintentable: true });
    const e422 = await crearLinkPago(op(422, { error: {} }), ENTRADA).catch((x: unknown) => x);
    expect(e422).toMatchObject({ codigo: 'HTTP', reintentable: false });
    const sinId = await crearLinkPago(op(201, { data: {} }), ENTRADA).catch((x: unknown) => x);
    expect(sinId).toMatchObject({ codigo: 'RESPUESTA_INVALIDA' });
    for (const e of [e401, e503, e422, sinId]) {
      expect(e).toBeInstanceOf(ErrorWompi);
      expect(String((e as Error).message)).not.toContain(LLAVE_PRIVADA_PRUEBA);
    }
  });

  it('falla de red → RED reintentable', async () => {
    const f = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    await expect(
      crearLinkPago({ ambiente: 'sandbox', llavePrivada: LLAVE_PRIVADA_PRUEBA, fetchImpl: f }, ENTRADA),
    ).rejects.toMatchObject({ codigo: 'RED', reintentable: true });
  });
});
