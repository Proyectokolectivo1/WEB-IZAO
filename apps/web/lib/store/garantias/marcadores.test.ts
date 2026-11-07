import { describe, expect, it } from 'vitest';
import { resolverMarcadoresGarantia } from './marcadores';

const v = { diasPlazo: 15, diasRespuesta: 2, rutaFormulario: '/co/garantias' };

describe('resolverMarcadoresGarantia', () => {
  it('reemplaza [30] y [5] por los días configurados', () => {
    const r = resolverMarcadoresGarantia('<p>Durante los <strong>[30] días</strong> y máximo [5] días hábiles.</p>', v);
    expect(r).toBe('<p>Durante los <strong>15 días</strong> y máximo 2 días hábiles.</p>');
  });
  it('un número que no es de la plantilla pierde solo los corchetes', () => {
    expect(resolverMarcadoresGarantia('en [10] días', v)).toBe('en 10 días');
  });
  it('[URL] apunta al formulario del país', () => {
    expect(resolverMarcadoresGarantia('formulario en [URL]', v)).toBe('formulario en /co/garantias');
  });
  it('quita marcadores en mayúsculas y no deja corchetes', () => {
    const r = resolverMarcadoresGarantia('Escríbenos [COMPLETAR] hoy [CORREO ELECTRÓNICO].', v);
    expect(r).toBe('Escríbenos hoy.');
    expect(r).not.toMatch(/[[\]]/);
  });
  it('no toca el texto sin marcadores', () => {
    expect(resolverMarcadoresGarantia('<p>Hola [nota] mundo</p>', v)).toBe('<p>Hola [nota] mundo</p>');
  });
});
