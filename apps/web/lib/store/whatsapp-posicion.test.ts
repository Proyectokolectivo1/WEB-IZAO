import { describe, expect, it } from 'vitest';
import { botonWhatsappSobreBarra, botonWhatsappVisible } from './whatsapp-posicion';

describe('botón de WhatsApp: dónde se ve', () => {
  it('se ve en la tienda', () => {
    for (const r of ['/co', '/ec/catalogo', '/co/perfume/casa-alba-1', '/ec/carrito', '/co/pagina/envios', '/ec/garantias']) {
      expect(botonWhatsappVisible(r), r).toBe(true);
    }
  });
  it('se oculta en el pago y la confirmación', () => {
    for (const r of ['/co/checkout', '/ec/checkout/', '/co/pagar/abc123', '/ec/pedido/xyz']) {
      expect(botonWhatsappVisible(r), r).toBe(false);
    }
  });
  it('en la ficha sube sobre la barra fija', () => {
    expect(botonWhatsappSobreBarra('/co/perfume/casa-alba-1')).toBe(true);
    expect(botonWhatsappSobreBarra('/co/catalogo')).toBe(false);
    expect(botonWhatsappSobreBarra(null)).toBe(false);
  });
});
