import { describe, expect, it } from 'vitest';
import { enlaceBotonAsesor, enlaceWhatsapp, numeroWhatsapp } from './contacto';

const DEFECTO = 'Hola, quiero ayuda.';
const aj = (o: Partial<{ whatsappAsesor: string | null; whatsappMensaje: string | null; whatsappBoton: boolean }> = {}) => ({
  whatsappAsesor: '573001112233',
  whatsappMensaje: null,
  whatsappBoton: true,
  ...o,
});

describe('numeroWhatsapp / enlaceWhatsapp', () => {
  it('deja solo dígitos y descarta largos irrazonables', () => {
    expect(numeroWhatsapp('+57 300 111 2233')).toBe('573001112233');
    expect(numeroWhatsapp('123')).toBeNull();
    expect(numeroWhatsapp(null)).toBeNull();
  });
  it('arma wa.me con el mensaje codificado', () => {
    expect(enlaceWhatsapp('573001112233', 'Hola, ¿qué tal?')).toBe('https://wa.me/573001112233?text=Hola%2C%20%C2%BFqu%C3%A9%20tal%3F');
  });
});

describe('enlaceBotonAsesor', () => {
  it('usa el número y el mensaje del país', () => {
    expect(enlaceBotonAsesor(aj({ whatsappMensaje: 'Quiero un aroma floral' }), DEFECTO)).toBe(
      'https://wa.me/573001112233?text=Quiero%20un%20aroma%20floral',
    );
  });
  it('sin mensaje usa el de por defecto', () => {
    expect(enlaceBotonAsesor(aj(), DEFECTO)).toBe(`https://wa.me/573001112233?text=${encodeURIComponent(DEFECTO)}`);
    expect(enlaceBotonAsesor(aj({ whatsappMensaje: '   ' }), DEFECTO)).toBe(`https://wa.me/573001112233?text=${encodeURIComponent(DEFECTO)}`);
  });
  it('sin número, con número inválido o apagado: no hay botón', () => {
    expect(enlaceBotonAsesor(aj({ whatsappAsesor: null }), DEFECTO)).toBeNull();
    expect(enlaceBotonAsesor(aj({ whatsappAsesor: 'abc' }), DEFECTO)).toBeNull();
    expect(enlaceBotonAsesor(aj({ whatsappBoton: false }), DEFECTO)).toBeNull();
  });
});
