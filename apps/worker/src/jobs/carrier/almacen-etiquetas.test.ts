import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeClock, MasterShopMock, MOCK_LABEL_HOST, mockLabelPdf } from '@izao/mastershop/mock';
import { crearAlmacenEtiquetas, ErrorEtiqueta, esBloqueoEtiqueta, USER_AGENT_ETIQUETAS } from './almacen-etiquetas.js';

describe('almacén de etiquetas (CDN de MasterShop)', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'izao-almacen-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('envía User-Agent y Accept propios: el CDN real responde 403 sin User-Agent (D-044)', async () => {
    const vistas: Headers[] = [];
    const almacen = crearAlmacenEtiquetas({
      mediaRoot: dir,
      fetchImpl: async (_url, init) => {
        const h = new Headers(init?.headers);
        vistas.push(h);
        if (!h.get('user-agent')) return new Response('<html>403</html>', { status: 403 });
        return new Response(mockLabelPdf('75070781750'), { status: 200, headers: { 'content-type': 'application/octet-stream' } });
      },
    });
    const ruta = await almacen.guardar('https://cdn.bemaster.com/mastershop/files/carriers/coordinadora/guide-pdf/75070781750-standard.pdf', 'IZ-CO-000123');
    expect(ruta).toBe('labels/IZ-CO-000123.pdf');
    expect(vistas[0]!.get('user-agent')).toBe(USER_AGENT_ETIQUETAS);
    expect(vistas[0]!.get('accept')).toContain('application/pdf');
    expect(await readFile(join(dir, 'labels', 'IZ-CO-000123.pdf'))).toEqual(Buffer.from(mockLabelPdf('75070781750')));
  });

  it('contra el mock: descarga con la cabecera y el 403 queda como ErrorEtiqueta (reintentable por poll_label)', async () => {
    const mock = new MasterShopMock({ apiKey: 'k', clock: new FakeClock(new Date('2026-11-04T12:00:00Z')) });
    const pedido = mock.seed({
      externalOrderId: 'IZ-CO-000124',
      createdAt: new Date('2026-11-04T11:00:00Z'),
      guide: 'G75070781750',
      shippingLabel: `https://${MOCK_LABEL_HOST}/G75070781750.pdf`,
    });
    const ok = crearAlmacenEtiquetas({ mediaRoot: dir, fetchImpl: mock.fetch, hostsPermitidos: [MOCK_LABEL_HOST] });
    await expect(ok.guardar(pedido.shippingLabel!, 'IZ-CO-000124')).resolves.toBe('labels/IZ-CO-000124.pdf');

    const sinUa = crearAlmacenEtiquetas({ mediaRoot: dir, fetchImpl: mock.fetch, userAgent: '', hostsPermitidos: [MOCK_LABEL_HOST] });
    await expect(sinUa.guardar(pedido.shippingLabel!, 'IZ-CO-000125')).rejects.toThrow(ErrorEtiqueta);
    await expect(sinUa.guardar(pedido.shippingLabel!, 'IZ-CO-000125')).rejects.toThrow('HTTP 403');
  });

  it('D-051: solo hosts permitidos (sin SSRF) y el 403 se reconoce como bloqueo', async () => {
    let llamadas = 0;
    const almacen = crearAlmacenEtiquetas({
      mediaRoot: dir,
      fetchImpl: async () => {
        llamadas++;
        return new Response('<html>403</html>', { status: 403 });
      },
    });
    for (const url of ['https://169.254.169.254/latest/meta-data', 'http://cdn.bemaster.com/a.pdf', 'https://cdn.bemaster.com.evil.com/a.pdf']) {
      await expect(almacen.guardar(url, 'IZ-CO-000126')).rejects.toThrow('URL no permitida');
    }
    expect(llamadas).toBe(0);
    const e = await almacen.guardar('https://cdn.bemaster.com/x/75070783091-standard.pdf', 'IZ-CO-000126').catch((x: unknown) => x);
    expect(esBloqueoEtiqueta(e)).toBe(true);
    expect(esBloqueoEtiqueta(new ErrorEtiqueta('HTTP 404', 404))).toBe(false);
  });
});
