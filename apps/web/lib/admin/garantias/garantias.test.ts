import { describe, expect, it } from 'vitest';
import {
  ESTADOS_GARANTIA,
  esquemaAjustesGarantia,
  esquemaGestion,
  estaVencida,
  interpretarBusquedaGarantia,
  leerFiltrosGarantia,
  leerHistorial,
  parametrosDeFiltrosGarantia,
  transicionPermitida,
  transicionesDe,
} from './garantias';

const ID = '11111111-1111-4111-8111-111111111111';

describe('flujo de estados', () => {
  it('permite quedarse en el mismo estado y las transiciones del flujo', () => {
    for (const e of ESTADOS_GARANTIA) expect(transicionPermitida(e, e)).toBe(true);
    expect(transicionPermitida('recibida', 'en_revision')).toBe(true);
    expect(transicionPermitida('en_revision', 'aprobada')).toBe(true);
    expect(transicionPermitida('aprobada', 'resuelta')).toBe(true);
    expect(transicionPermitida('resuelta', 'en_revision')).toBe(true); // reabrir
  });

  it('no salta pasos ni resuelve lo rechazado', () => {
    expect(transicionPermitida('recibida', 'resuelta')).toBe(false);
    expect(transicionPermitida('en_revision', 'resuelta')).toBe(false);
    expect(transicionPermitida('rechazada', 'resuelta')).toBe(false);
    expect(transicionPermitida('rechazada', 'aprobada')).toBe(false);
    expect(transicionesDe('rechazada')).toEqual(['en_revision']);
  });
});

describe('bandeja', () => {
  it('lee filtros válidos y descarta los desconocidos', () => {
    const f = leerFiltrosGarantia({ estado: 'aprobada', pais: 'ec', desde: '2026-10-01', hasta: '2026-10-20', vencidas: '1', page: '2' });
    expect(f).toMatchObject({ estado: 'aprobada', pais: 'EC', desde: '2026-10-01', hasta: '2026-10-20', vencidas: true, pagina: 2 });
    const malo = leerFiltrosGarantia({ estado: 'inventado', pais: 'MX', desde: '2026-02-30', hasta: 'ayer', vencidas: 'si', page: '-1' });
    expect(malo).toMatchObject({ estado: '', pais: '', desde: '', hasta: '', vencidas: false, pagina: 1 });
    expect(leerFiltrosGarantia({ desde: '2026-10-20', hasta: '2026-10-01' })).toMatchObject({ desde: '2026-10-01', hasta: '2026-10-20' });
  });

  it('conserva solo parámetros con valor', () => {
    expect(parametrosDeFiltrosGarantia(leerFiltrosGarantia({ q: 'ana', estado: 'recibida', vencidas: '1' }))).toEqual({
      q: 'ana',
      estado: 'recibida',
      vencidas: '1',
    });
  });

  it('interpreta la búsqueda: celular, número de caso o nombre', () => {
    expect(interpretarBusquedaGarantia('+57 300 123 4567')).toEqual({ campo: 'phone', patron: '573001234567' });
    expect(interpretarBusquedaGarantia('gar-co-0012')).toEqual({ campo: 'number', patron: 'GAR-CO-0012' });
    expect(interpretarBusquedaGarantia('Ana Pérez')).toEqual({ campo: 'customer_name', patron: 'Ana Pérez' });
    expect(interpretarBusquedaGarantia('  ')).toBeNull();
  });

  it('el plazo de respuesta solo vence en casos abiertos', () => {
    const creada = '2026-10-01T12:00:00.000Z';
    const ahora = new Date('2026-10-10T12:00:00.000Z');
    expect(estaVencida('recibida', creada, 5, ahora)).toBe(true);
    expect(estaVencida('en_revision', creada, 10, ahora)).toBe(false);
    expect(estaVencida('resuelta', creada, 5, ahora)).toBe(false);
    expect(estaVencida('rechazada', creada, 5, ahora)).toBe(false);
  });
});

describe('esquemaGestion', () => {
  const entrada = (o: Record<string, string> = {}) => ({ id: ID, status: 'aprobada', resolution: '', cost_amount: '', admin_notes: '', nota_historial: '', ...o });

  it('el costo se guarda como entero en unidad menor de la moneda del país', () => {
    expect(esquemaGestion('CO').parse(entrada({ cost_amount: '45000' })).cost_amount).toBe(45000n);
    expect(esquemaGestion('EC').parse(entrada({ cost_amount: '12,50' })).cost_amount).toBe(1250n);
    expect(esquemaGestion('CO').parse(entrada()).cost_amount).toBe(0n);
  });

  it('rechaza decimales en pesos, costos negativos y estados inventados', () => {
    expect(esquemaGestion('CO').safeParse(entrada({ cost_amount: '10.5' })).success).toBe(false);
    expect(esquemaGestion('CO').safeParse(entrada({ cost_amount: '-3' })).success).toBe(false);
    expect(esquemaGestion('CO').safeParse(entrada({ status: 'perdida' })).success).toBe(false);
    expect(esquemaGestion('CO').safeParse(entrada({ id: 'x' })).success).toBe(false);
  });

  it('resolver exige indicar la solución', () => {
    const r = esquemaGestion('CO').safeParse(entrada({ status: 'resuelta' }));
    expect(r.success).toBe(false);
    expect(esquemaGestion('CO').safeParse(entrada({ status: 'resuelta', resolution: 'reembolso' })).success).toBe(true);
    expect(esquemaGestion('CO').safeParse(entrada({ resolution: 'regalo' })).success).toBe(false);
  });

  it('textos vacíos quedan como null', () => {
    const d = esquemaGestion('CO').parse(entrada({ admin_notes: '  ' }));
    expect(d.admin_notes).toBeNull();
    expect(d.nota_historial).toBeNull();
  });
});

describe('esquemaAjustesGarantia', () => {
  const base = { country_code: 'CO', period_days: '30', response_days: '5', reasons: 'Producto dañado\nEmpaque abierto\n  Producto dañado  \n', instructions_html: '<p>Hola</p>', conditions_html: '' };

  it('normaliza motivos (sin repetidos ni vacíos) y números', () => {
    const d = esquemaAjustesGarantia.parse(base);
    expect(d).toMatchObject({ country_code: 'CO', period_days: 30, response_days: 5, reasons: ['Producto dañado', 'Empaque abierto'] });
  });

  it('valida rangos y exige al menos un motivo', () => {
    expect(esquemaAjustesGarantia.safeParse({ ...base, period_days: '0' }).success).toBe(false);
    expect(esquemaAjustesGarantia.safeParse({ ...base, period_days: '3.5' }).success).toBe(false);
    expect(esquemaAjustesGarantia.safeParse({ ...base, response_days: '90' }).success).toBe(false);
    expect(esquemaAjustesGarantia.safeParse({ ...base, reasons: '' }).success).toBe(false);
    expect(esquemaAjustesGarantia.safeParse({ ...base, country_code: 'MX' }).success).toBe(false);
  });

  it('regla 7: ni los motivos ni los textos afirman originalidad', () => {
    expect(esquemaAjustesGarantia.safeParse({ ...base, reasons: 'No es original' }).success).toBe(false);
    expect(esquemaAjustesGarantia.safeParse({ ...base, conditions_html: '<p>Productos 100% auténticos</p>' }).success).toBe(false);
  });

  it('depura el HTML de los textos públicos', () => {
    const d = esquemaAjustesGarantia.parse({ ...base, instructions_html: '<p onclick="x()">Hola</p><script>alert(1)</script>' });
    expect(d.instructions_html).not.toContain('script');
    expect(d.instructions_html).not.toContain('onclick');
    expect(d.instructions_html).toContain('Hola');
  });
});

describe('leerHistorial', () => {
  it('descarta entradas mal formadas en vez de fallar', () => {
    const h = leerHistorial([
      { at: '2026-10-01T00:00:00Z', actor: 'u1', from: 'recibida', to: 'en_revision', nota: 'Se pidió foto' },
      { at: 'x', to: 'desconocido' },
      null,
      'texto',
    ]);
    expect(h).toEqual([{ at: '2026-10-01T00:00:00Z', actor: 'u1', from: 'recibida', to: 'en_revision', nota: 'Se pidió foto' }]);
    expect(leerHistorial(null)).toEqual([]);
  });
});
