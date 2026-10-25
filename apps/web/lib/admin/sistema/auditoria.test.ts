import { describe, expect, it } from 'vitest';
import { leerFiltrosAuditoria, parametrosDeFiltrosAuditoria, resumenDiff } from './auditoria';

describe('filtros de auditoría', () => {
  it('lee filtros válidos', () => {
    const f = leerFiltrosAuditoria({ accion: 'usuarios.', entidad: 'admin_users', actor: 'script:crear-admin', desde: '2026-10-01', hasta: '2026-10-20', accesos: '1', page: '2' });
    expect(f).toEqual({ pagina: 2, accion: 'usuarios.', entidad: 'admin_users', actor: 'script:crear-admin', desde: '2026-10-01', hasta: '2026-10-20', accesos: true });
  });

  it('descarta comodines y sintaxis de filtros, fechas falsas y páginas absurdas', () => {
    const f = leerFiltrosAuditoria({ accion: 'x%,or(a.eq.1)', entidad: 'a b;c', desde: '2026-02-30', hasta: 'ayer', page: '-3', accesos: 'si' });
    expect(f.accion).toBe('xora.eq.1');
    expect(f.entidad).toBe('abc');
    expect(f).toMatchObject({ desde: '', hasta: '', pagina: 1, accesos: false });
    expect(/[%,()\s]/.test(f.accion + f.entidad)).toBe(false);
  });

  it('intercambia un rango invertido y conserva solo parámetros con valor', () => {
    const f = leerFiltrosAuditoria({ desde: '2026-10-20', hasta: '2026-10-01', accion: 'gastos.' });
    expect([f.desde, f.hasta]).toEqual(['2026-10-01', '2026-10-20']);
    expect(parametrosDeFiltrosAuditoria(leerFiltrosAuditoria({ accion: 'gastos.', accesos: '1' }))).toEqual({ accion: 'gastos.', accesos: '1' });
  });
});

describe('resumenDiff', () => {
  it('muestra el diff en una línea y recorta lo largo', () => {
    expect(resumenDiff({ a: 1 })).toBe('{"a":1}');
    expect(resumenDiff('x'.repeat(500), 20)).toHaveLength(21);
    for (const vacio of [null, undefined, {}]) expect(resumenDiff(vacio)).toBe('—');
  });
});
