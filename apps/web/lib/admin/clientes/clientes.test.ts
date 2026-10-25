import { describe, expect, it } from 'vitest';
import {
  bloqueosAnonimizacion,
  esquemaAnonimizar,
  interpretarBusquedaCliente,
  leerFiltrosCliente,
  nombreDeCliente,
  parametrosDeFiltrosCliente,
  pedidoEnCurso,
} from './clientes';

const ID = '11111111-1111-4111-8111-111111111111';

describe('filtros y búsqueda', () => {
  it('lee filtros válidos y descarta los desconocidos', () => {
    expect(leerFiltrosCliente({ q: ' ana ', pais: 'ec', estado: 'anonimizados', page: '3' })).toEqual({ q: 'ana', pais: 'EC', estado: 'anonimizados', pagina: 3 });
    expect(leerFiltrosCliente({ pais: 'MX', estado: 'x', page: '0' })).toEqual({ q: '', pais: '', estado: '', pagina: 1 });
    expect(parametrosDeFiltrosCliente(leerFiltrosCliente({ pais: 'CO' }))).toEqual({ pais: 'CO' });
  });

  it('interpreta la búsqueda: correo, celular, documento o nombre', () => {
    expect(interpretarBusquedaCliente('Ana@Izao.co')).toEqual({ campo: 'email', patron: 'ana@izao.co' });
    expect(interpretarBusquedaCliente('+57 300 123 4567')).toEqual({ campo: 'phone_e164', patron: '573001234567' });
    expect(interpretarBusquedaCliente('1020304')).toEqual({ campo: 'phone_e164', patron: '1020304' });
    expect(interpretarBusquedaCliente('10203')).toEqual({ campo: 'document_number', patron: '10203' });
    expect(interpretarBusquedaCliente('Ana Pérez')).toEqual({ campo: 'nombre', patron: 'Ana Pérez' });
    expect(interpretarBusquedaCliente(' ')).toBeNull();
  });

  it('el nombre del cliente anonimizado no muestra nada personal', () => {
    expect(nombreDeCliente({ first_name: 'Ana', last_name: 'Pérez' })).toBe('Ana Pérez');
    expect(nombreDeCliente({ first_name: null, last_name: null })).toBe('Sin nombre');
    expect(nombreDeCliente({ first_name: 'Ana', last_name: 'P', anonymized_at: '2026-10-01T00:00:00Z' })).toBe('Cliente anonimizado');
  });
});

describe('anonimización', () => {
  it('solo los estados cerrados dejan anonimizar', () => {
    for (const e of ['entregado', 'devuelto', 'cancelado', 'expirado', 'abandonado', 'pago_rechazado']) expect(pedidoEnCurso(e), e).toBe(false);
    for (const e of ['pendiente_pago', 'esperando_abono', 'pagado', 'en_preparacion', 'en_transito', 'reclamacion', 'requiere_reembolso', 'raro']) {
      expect(pedidoEnCurso(e), e).toBe(true);
    }
  });

  it('explica cada bloqueo y no bloquea cuando todo está cerrado', () => {
    expect(bloqueosAnonimizacion({ yaAnonimizado: false, pedidosEnCurso: 0, garantiasAbiertas: 0, esCuentaDelPanel: false })).toEqual([]);
    const b = bloqueosAnonimizacion({ yaAnonimizado: true, pedidosEnCurso: 2, garantiasAbiertas: 1, esCuentaDelPanel: true });
    expect(b).toHaveLength(4);
    expect(b.join(' ')).toMatch(/2 pedido/);
  });

  it('exige la palabra de confirmación y la solicitud', () => {
    expect(esquemaAnonimizar.parse({ id: ID, confirmacion: 'ANONIMIZAR', motivo: ' Radicado 123 del 20/10 ' })).toEqual({ id: ID, motivo: 'Radicado 123 del 20/10' });
    expect(esquemaAnonimizar.safeParse({ id: ID, confirmacion: 'anonimizar', motivo: 'Radicado 123' }).success).toBe(false);
    expect(esquemaAnonimizar.safeParse({ id: ID, confirmacion: 'ANONIMIZAR', motivo: 'ok' }).success).toBe(false);
    expect(esquemaAnonimizar.safeParse({ id: 'x', confirmacion: 'ANONIMIZAR', motivo: 'Radicado 123' }).success).toBe(false);
  });
});
