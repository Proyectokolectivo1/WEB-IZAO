import { describe, expect, it } from 'vitest';
import { esquemaWhatsappAsesor, normalizarWhatsapp } from './whatsapp-asesor';

const ok = (valor: string) => ({ ok: true, valor });

describe('normalizarWhatsapp', () => {
  it('Colombia: deja solo dígitos con el 57', () => {
    expect(normalizarWhatsapp('+57 300 123 4567', '+57')).toEqual(ok('573001234567'));
    expect(normalizarWhatsapp('573001234567', '+57')).toEqual(ok('573001234567'));
    expect(normalizarWhatsapp('(57) 300-123-4567', '+57')).toEqual(ok('573001234567'));
    expect(normalizarWhatsapp('0057 300 123 4567', '+57')).toEqual(ok('573001234567'));
  });

  it('antepone el código del país a un número nacional', () => {
    expect(normalizarWhatsapp('300 123 4567', '+57')).toEqual(ok('573001234567'));
    expect(normalizarWhatsapp('3001234567', '+57')).toEqual(ok('573001234567'));
  });

  it('Ecuador: 593, quita el cero de marcación nacional', () => {
    expect(normalizarWhatsapp('+593 99 123 4567', '+593')).toEqual(ok('593991234567'));
    expect(normalizarWhatsapp('0991234567', '+593')).toEqual(ok('593991234567'));
    expect(normalizarWhatsapp('991234567', '+593')).toEqual(ok('593991234567'));
    expect(normalizarWhatsapp('593 99 123 4567', '+593')).toEqual(ok('593991234567'));
  });

  it('el prefijo sale del país (no está quemado)', () => {
    expect(normalizarWhatsapp('+1 555 123 4567', '+1')).toEqual(ok('15551234567'));
  });

  it('rechaza letras, números cortos, largos y país sin código', () => {
    expect(normalizarWhatsapp('llámame', '+57').ok).toBe(false);
    expect(normalizarWhatsapp('300 abc 4567', '+57').ok).toBe(false);
    expect(normalizarWhatsapp('12345', '+57').ok).toBe(false);
    expect(normalizarWhatsapp('+57 300 123 4567 89', '+57').ok).toBe(false);
    expect(normalizarWhatsapp('+57', '+57').ok).toBe(false);
    expect(normalizarWhatsapp('3001234567', '').ok).toBe(false);
    expect(normalizarWhatsapp('', '+57').ok).toBe(false);
  });

  it('un número de otro país no se acepta como si fuera de este', () => {
    expect(normalizarWhatsapp('+593 99 123 4567', '+57').ok).toBe(false);
  });
});

describe('esquemaWhatsappAsesor', () => {
  it('lee número, mensaje e interruptor', () => {
    const r = esquemaWhatsappAsesor.parse({
      advisor_whatsapp: ' +57 300 123 4567 ',
      advisor_whatsapp_message: ' Hola, quiero ayuda ',
      advisor_whatsapp_button_enabled: 'on',
    });
    expect(r).toEqual({ numero: '+57 300 123 4567', mensaje: 'Hola, quiero ayuda', activo: true });
  });

  it('vacío = sin número, mensaje por defecto y botón apagado', () => {
    expect(esquemaWhatsappAsesor.parse({})).toEqual({ numero: '', mensaje: null, activo: false });
  });

  it('rechaza mensajes largos o que afirman originalidad', () => {
    expect(esquemaWhatsappAsesor.safeParse({ advisor_whatsapp_message: 'x'.repeat(301) }).success).toBe(false);
    expect(esquemaWhatsappAsesor.safeParse({ advisor_whatsapp_message: 'Perfumes originales a un click' }).success).toBe(false);
    expect(esquemaWhatsappAsesor.safeParse({ advisor_whatsapp_message: 'Hola\u0007' }).success).toBe(false);
    expect(esquemaWhatsappAsesor.safeParse({ advisor_whatsapp_message: 'Hola\nquiero ayuda' }).success).toBe(true);
  });
});
