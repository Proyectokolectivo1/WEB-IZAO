import { describe, expect, it } from 'vitest';
import { clienteFalso } from '../crud/cliente-falso';
import { hojaLeads } from './excel';
import { fuenteDeLead, interpretarBusquedaLead, leerFiltrosLead, parametrosDeFiltrosLead } from './leads';
import { listarLeads, todosLosLeads, type FilaLead } from './servidor';

const POPUP = '66666666-6666-4666-8666-666666666666';
const lead = (o: Partial<FilaLead> = {}): FilaLead => ({
  id: 'l1',
  country_code: 'CO',
  email: 'ana@correo.co',
  phone_e164: '+573001234567',
  popup_id: POPUP,
  consent_at: '2026-10-20T10:00:00.000Z',
  consent_text_version: 'v2',
  marketing_opt_in: true,
  utm: { utm_source: 'instagram', utm_campaign: 'verano' },
  converted_order_id: null,
  created_at: '2026-10-20T10:00:00.000Z',
  popups: { name: 'Bienvenida' },
  discount_codes: { code: 'BIENVENIDA10' },
  ...o,
});

describe('filtros', () => {
  it('lee filtros válidos y descarta los desconocidos', () => {
    const f = leerFiltrosLead({ q: ' ana ', pais: 'ec', popup: POPUP, convertido: 'si', optin: 'no', desde: '2026-10-20', hasta: '2026-10-01', page: '2' });
    expect(f).toEqual({ q: 'ana', pagina: 2, pais: 'EC', popup: POPUP, convertido: 'si', optin: 'no', desde: '2026-10-01', hasta: '2026-10-20' });
    expect(leerFiltrosLead({ pais: 'MX', popup: 'x', convertido: 'tal vez', desde: '2026-02-30' })).toMatchObject({ pais: '', popup: '', convertido: '', desde: '' });
    expect(parametrosDeFiltrosLead(leerFiltrosLead({ pais: 'CO', optin: 'si' }))).toEqual({ pais: 'CO', optin: 'si' });
  });

  it('interpreta la búsqueda y resume la fuente', () => {
    expect(interpretarBusquedaLead('Ana@Correo.co')).toEqual({ campo: 'email', patron: 'ana@correo.co' });
    expect(interpretarBusquedaLead('+57 300 123')).toEqual({ campo: 'phone_e164', patron: '57300123' });
    expect(interpretarBusquedaLead('')).toBeNull();
    expect(fuenteDeLead({ utm_source: 'instagram', utm_campaign: 'verano' })).toBe('instagram / verano');
    expect(fuenteDeLead({ source: 'tiktok' })).toBe('tiktok');
    expect(fuenteDeLead(null)).toBe('');
  });
});

describe('listarLeads y todosLosLeads', () => {
  it('aplica todos los filtros y normaliza las relaciones embebidas', async () => {
    const { cliente, filtros } = clienteFalso({ 'leads.select': { data: [lead({ popups: [{ name: 'Bienvenida' }] as never })], count: 1 } });
    const r = await listarLeads(cliente, leerFiltrosLead({ pais: 'CO', popup: POPUP, convertido: 'no', optin: 'si', desde: '2026-10-01', hasta: '2026-10-20', q: 'ana@correo.co' }));
    expect(r.total).toBe(1);
    expect(r.filas[0]!.popups).toEqual({ name: 'Bienvenida' });
    expect(filtros.map((f) => [f.metodo, ...f.args])).toEqual(
      expect.arrayContaining([
        ['eq', 'country_code', 'CO'],
        ['eq', 'popup_id', POPUP],
        ['is', 'converted_order_id', null],
        ['eq', 'marketing_opt_in', true],
        ['gte', 'created_at', '2026-10-01T05:00:00.000Z'],
        ['lt', 'created_at', '2026-10-21T05:00:00.000Z'],
        ['ilike', 'email', '%ana@correo.co%'],
      ]),
    );
  });

  it('"compró = sí" filtra los que tienen pedido', async () => {
    const { cliente, filtros } = clienteFalso({ 'leads.select': { data: [], count: 0 } });
    await listarLeads(cliente, leerFiltrosLead({ convertido: 'si' }));
    expect(filtros.find((f) => f.metodo === 'not')?.args).toEqual(['converted_order_id', 'is', null]);
  });

  it('la exportación recorre los lotes y avisa si hay más del tope', async () => {
    const pocos = clienteFalso({ 'leads.select': { data: [lead(), lead({ id: 'l2' })] } });
    expect(await todosLosLeads(pocos.cliente, leerFiltrosLead({}))).toMatchObject({ truncado: false });
    const mil = Array.from({ length: 1000 }, (_, i) => lead({ id: `l${i}` }));
    const muchos = clienteFalso({ 'leads.select': { data: mil } });
    expect((await todosLosLeads(muchos.cliente, leerFiltrosLead({}))).truncado).toBe(true);
  });

  it('propaga el error de la base', async () => {
    const { cliente } = clienteFalso({ 'leads.select': { error: { message: 'boom' } } });
    await expect(listarLeads(cliente, leerFiltrosLead({}))).rejects.toThrow(/leads/);
  });
});

describe('hojaLeads', () => {
  it('una fila por lead con tantas celdas como columnas', () => {
    const h = hojaLeads([lead(), lead({ id: 'l2', email: null, converted_order_id: 'o1', marketing_opt_in: false, popups: null, discount_codes: null })]);
    expect(h.nombre).toBe('Leads');
    for (const f of h.filas) expect(f).toHaveLength(h.columnas.length);
    expect(h.filas[0]).toEqual(['2026-10-20 10:00:00', 'CO', 'ana@correo.co', '+573001234567', 'Bienvenida', 'BIENVENIDA10', 'Sí', '2026-10-20 10:00:00', 'v2', 'instagram / verano', 'No']);
    expect(h.filas[1]).toEqual(expect.arrayContaining(['', 'No', 'Sí']));
  });
});
