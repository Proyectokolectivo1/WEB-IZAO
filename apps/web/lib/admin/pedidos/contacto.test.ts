import { describe, expect, it } from 'vitest';
import { enlacesContacto, textoDocumento } from './contacto';

describe('enlacesContacto', () => {
  it('arma wa.me y tel: desde el E.164', () => {
    expect(enlacesContacto('+573001234567')).toEqual({ whatsapp: 'https://wa.me/573001234567', tel: 'tel:+573001234567' });
  });
  it('sin teléfono válido no hay enlaces', () => {
    expect(enlacesContacto(null)).toBeNull();
    expect(enlacesContacto('abc')).toBeNull();
    expect(enlacesContacto('123')).toBeNull();
  });
});

describe('textoDocumento', () => {
  it('tipo + número; sin número no hay texto', () => {
    expect(textoDocumento('CC', '1020304050')).toBe('CC 1020304050');
    expect(textoDocumento('PP', 'A123')).toBe('Pasaporte A123');
    expect(textoDocumento(null, '999')).toBe('999');
    expect(textoDocumento('CC', ' ')).toBeNull();
    expect(textoDocumento('CC', null)).toBeNull();
  });
});
