import { describe, expect, it } from 'vitest';
import { ErrorWompi, crearClienteWompi, estadoProveedor } from './cliente';
import { LLAVE_PRIVADA_PRUEBA, fetchWompiFalso } from './mock';

const TX = { id: '1234-1610641025-49201', status: 'APPROVED' as const, amount_in_cents: 24_990_000, reference: 'IZ-CO-000123-P1' };

function cliente(f = fetchWompiFalso([TX]), llave = LLAVE_PRIVADA_PRUEBA) {
  return { f, c: crearClienteWompi({ ambiente: 'sandbox', llavePrivada: llave, fetchImpl: f.fetch }) };
}

describe('cliente de la API de Wompi', () => {
  it('GET /v1/transactions/{id} contra sandbox con la llave privada como Bearer', async () => {
    const { f, c } = cliente();
    const t = await c.obtenerTransaccion(TX.id);
    expect(f.llamadas[0]!.url).toBe('https://sandbox.wompi.co/v1/transactions/1234-1610641025-49201');
    expect(f.llamadas[0]!.autorizacion).toBe(`Bearer ${LLAVE_PRIVADA_PRUEBA}`);
    expect(t).toMatchObject({ id: TX.id, status: 'APPROVED', amount_in_cents: 24_990_000n, reference: TX.reference, currency: 'COP' });
  });

  it('estado del proveedor: centavos → unidad menor COP en bigint', async () => {
    const { c } = cliente();
    const s = estadoProveedor(await c.obtenerTransaccion(TX.id));
    expect(s).toMatchObject({ status: 'approved', provider_transaction_id: TX.id, amount: 249_900n, currency_code: 'COP' });
  });

  it('centavos que no cierran a pesos enteros → monto null (el job no aprueba)', () => {
    const s = estadoProveedor({ ...TX, amount_in_cents: 24_990_050n, currency: 'COP', payment_link_id: null, status_message: null });
    expect(s.amount).toBeNull();
    const usd = estadoProveedor({ ...TX, amount_in_cents: 100n, currency: 'USD', payment_link_id: null, status_message: null });
    expect(usd.currency_code).toBeNull();
    expect(usd.amount).toBeNull();
  });

  it('404, 401 y 5xx se distinguen; los errores no contienen la llave', async () => {
    const { f, c } = cliente();
    await expect(c.obtenerTransaccion('no-existe')).rejects.toMatchObject({ codigo: 'NO_ENCONTRADA', reintentable: false });
    f.fallarCon = 503;
    const e = await c.obtenerTransaccion(TX.id).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErrorWompi);
    expect((e as ErrorWompi).reintentable).toBe(true);
    const mala = cliente(fetchWompiFalso([TX]), 'prv_test_otra_llave_secreta');
    const e2 = await mala.c.obtenerTransaccion(TX.id).catch((x: unknown) => x);
    expect((e2 as ErrorWompi).codigo).toBe('CREDENCIALES');
    expect(JSON.stringify(e2) + String((e2 as Error).message)).not.toContain('otra_llave_secreta');
  });

  it('id con caracteres de ruta se rechaza sin llamar a la red', async () => {
    const { f, c } = cliente();
    await expect(c.obtenerTransaccion('../merchants/x')).rejects.toMatchObject({ codigo: 'ID_INVALIDO' });
    expect(f.llamadas).toHaveLength(0);
  });

  it('respuesta con forma inesperada → RESPUESTA_INVALIDA', async () => {
    const fetchRaro = (async () => new Response(JSON.stringify({ data: { id: 1 } }), { status: 200 })) as typeof fetch;
    const c = crearClienteWompi({ ambiente: 'sandbox', llavePrivada: LLAVE_PRIVADA_PRUEBA, fetchImpl: fetchRaro });
    await expect(c.obtenerTransaccion(TX.id)).rejects.toMatchObject({ codigo: 'RESPUESTA_INVALIDA' });
  });

  it('error de red es reintentable', async () => {
    const fetchCaido = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    const c = crearClienteWompi({ ambiente: 'sandbox', llavePrivada: LLAVE_PRIVADA_PRUEBA, fetchImpl: fetchCaido });
    await expect(c.obtenerTransaccion(TX.id)).rejects.toMatchObject({ codigo: 'RED', reintentable: true });
  });
});
