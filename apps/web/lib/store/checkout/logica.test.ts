import { describe, expect, it } from 'vitest';
import type { LineaCarrito } from '../carrito/logica';
import { combinarPolitica, erroresDelServidor, formatearPct, resumenCheckout, resumenConServidor } from './logica';
import { armarCuerpo, validarFormulario } from './validacion';
import { FORMULARIO_VACIO } from './logica';
import { ErrorCheckout } from './contrato';
import type { ConfigCheckout, ValoresFormulario } from './tipos';

const ahora = new Date('2026-10-20T12:00:00Z');

const linea = (o: Partial<LineaCarrito> = {}): LineaCarrito => ({
  variantId: '11111111-1111-4111-8111-111111111111',
  productId: 'p1',
  slug: 'noche',
  nombre: 'Noche',
  presentacion: '100 ml',
  cantidad: 1,
  precio: '90000',
  tachado: null,
  max: 5,
  imagen: null,
  ...o,
});

const configCo: ConfigCheckout = {
  pais: 'co',
  codHabilitado: true,
  codAbono: '10000',
  codMinimoRecaudo: '20000',
  recargoFinanciacion: { addi: '10', sistecredito: '10' },
  metodos: [
    { method: 'wompi', nombre: 'Wompi', descripcion: null },
    { method: 'addi', nombre: 'Addi', descripcion: null },
    { method: 'sistecredito', nombre: 'Sistecrédito', descripcion: null },
    { method: 'cod', nombre: 'Contra entrega', descripcion: null },
  ],
  regiones: [{ id: 'r1', name: 'Antioquia' }],
  tiposDocumento: ['CC', 'CE', 'NIT', 'PAS', 'TI'],
  terminos: null,
  datos: null,
  versionPoliticaDatos: '3',
};

const configEc: ConfigCheckout = { ...configCo, pais: 'ec', codHabilitado: false, metodos: [], tiposDocumento: ['CEDULA', 'RUC', 'PASAPORTE'] };

const validos: ValoresFormulario = {
  ...FORMULARIO_VACIO,
  nombre: 'María José',
  apellido: 'Gómez',
  celular: '3001234567',
  tipoDocumento: 'CC',
  numeroDocumento: '1.020.304.050',
  regionId: 'r1',
  ciudadId: 'c1',
  direccion: 'Calle 10 # 20-30',
  metodo: 'wompi',
  terminos: true,
};

describe('validarFormulario', () => {
  it('acepta un formulario completo', () => {
    expect(validarFormulario(validos, configCo)).toEqual({});
  });

  it('marca los obligatorios del formulario vacío en lenguaje humano', () => {
    const e = validarFormulario(FORMULARIO_VACIO, configCo);
    expect(Object.keys(e)).toEqual(
      expect.arrayContaining(['nombre', 'apellido', 'celular', 'tipoDocumento', 'regionId', 'ciudadId', 'direccion', 'metodo', 'terminos']),
    );
    expect(e.regionId).toBe('Elige tu departamento.');
  });

  it('usa provincia y cantón en Ecuador', () => {
    const e = validarFormulario(FORMULARIO_VACIO, configEc);
    expect(e.regionId).toBe('Elige tu provincia.');
    expect(e.ciudadId).toBe('Elige tu cantón.');
  });

  it('valida el celular por país', () => {
    expect(validarFormulario({ ...validos, celular: '2001234567' }, configCo).celular).toMatch(/10 dígitos/);
    const ec = { ...validos, tipoDocumento: 'CEDULA', numeroDocumento: '1712345678', celular: '0991234567', metodo: 'manual' as const };
    expect(validarFormulario(ec, configEc)).toEqual({});
    expect(validarFormulario({ ...ec, celular: '3001234567' }, configEc).celular).toMatch(/9 dígitos/);
  });

  it('valida el documento según su tipo', () => {
    expect(validarFormulario({ ...validos, numeroDocumento: 'abc' }, configCo).numeroDocumento).toBeTruthy();
    expect(validarFormulario({ ...validos, tipoDocumento: 'PAS', numeroDocumento: 'AB123456' }, configCo)).toEqual({});
  });

  it('el correo es opcional pero se revisa si se escribe', () => {
    expect(validarFormulario({ ...validos, correo: '' }, configCo).correo).toBeUndefined();
    expect(validarFormulario({ ...validos, correo: 'maria@' }, configCo).correo).toBeTruthy();
  });

  it('contra entrega exige autorizar WhatsApp', () => {
    expect(validarFormulario({ ...validos, metodo: 'cod' }, configCo).whatsapp).toBeTruthy();
    expect(validarFormulario({ ...validos, metodo: 'cod', whatsapp: true }, configCo).whatsapp).toBeUndefined();
  });
});

describe('armarCuerpo', () => {
  it('no envía precios ni totales, normaliza nombres y deja nulos los opcionales', () => {
    const c = armarCuerpo({ ...validos, nombre: "  O'Brien-3 ", correo: '  ' }, configCo, [linea({ cantidad: 2 })], 'HOLA10', 'k1');
    expect(c.country_code).toBe('CO');
    expect(c.items).toEqual([{ variant_id: '11111111-1111-4111-8111-111111111111', quantity: 2 }]);
    expect(c.contact.first_name).toBe('OBrien');
    expect(c.contact.email).toBeNull();
    expect(c.shipping.district).toBeNull();
    expect(c.discount_code).toBe('HOLA10');
    expect(JSON.stringify(c)).not.toMatch(/price|total|subtotal/);
    expect(c.data_policy_version).toBe('3');
  });

  it('traduce las rutas de error del servidor a campos', () => {
    expect(erroresDelServidor([
      { path: 'contact.phone', message: 'Mal' },
      { path: 'shipping.address1', message: 'Falta' },
      { path: 'otra', message: 'x' },
    ])).toEqual({
      celular: 'Mal',
      direccion: 'Falta',
    });
  });
});

describe('resumenCheckout (caso 1, 2, 4, 5 y 6 de §11.3)', () => {
  it('contra entrega: total 90.000, abono 10.000, recaudo 80.000', () => {
    const r = resumenCheckout([linea()], configCo, 'cod', null, ahora);
    expect([r.total, r.abono, r.recaudo]).toEqual([90000n, 10000n, 80000n]);
  });

  it('contra entrega con descuento 9.000: total 81.000, recaudo 71.000', () => {
    const r = resumenCheckout([linea()], configCo, 'cod', { codigo: 'DIEZ', monto: '9000' }, ahora);
    expect([r.descuento, r.total, r.abono, r.recaudo]).toEqual([9000n, 81000n, 10000n, 71000n]);
  });

  it('Addi retira el código y suma el recargo del país', () => {
    const r = resumenCheckout([linea()], configCo, 'addi', { codigo: 'DIEZ', monto: '9000' }, ahora);
    expect(r.codigoRetirado).toBe(true);
    expect([r.descuento, r.recargo, r.total]).toEqual([0n, 9000n, 99000n]);
    expect(r.recargoPct).toBe('10');
  });

  it('Sistecrédito: 90.000 + 120.000 con recargo 21.000 = 231.000', () => {
    const r = resumenCheckout([linea(), linea({ variantId: 'v2', precio: '120000' })], configCo, 'sistecredito', null, ahora);
    expect([r.subtotal, r.recargo, r.total]).toEqual([210000n, 21000n, 231000n]);
  });

  it('contra entrega queda no disponible si el recaudo baja del mínimo', () => {
    const r = resumenCheckout([linea({ precio: '25000' })], configCo, 'wompi', { codigo: 'D', monto: '10000' }, ahora);
    expect(r.disponibilidad.cod).toEqual({ disponible: false, motivo: 'COD_BELOW_MINIMUM' });
    expect(r.disponibilidad.wompi?.disponible).toBe(true);
  });

  it('Ecuador sin métodos activos permite el pedido manual y el USD no pierde centavos', () => {
    const r = resumenCheckout([linea({ precio: '4990', cantidad: 2 })], configEc, 'manual', null, ahora);
    expect(r.metodoDisponible).toBe(true);
    expect(r.total).toBe(9980n);
  });

  it('formatea el porcentaje del recargo', () => {
    expect(formatearPct(1000n)).toBe('10');
    expect(formatearPct(1050n)).toBe('10,5');
    expect(formatearPct(1005n)).toBe('10,05');
  });
});

describe('resumenConServidor', () => {
  it('los montos del servidor mandan sobre el cálculo local', () => {
    const local = resumenCheckout([linea()], configCo, 'addi', null, ahora);
    const r = resumenConServidor(
      local,
      {
        payment_method: 'addi',
        payment_method_available: true,
        surcharge: '9500',
        total_customer: '99500',
        cod_deposit: '0',
        cod_collect: '0',
        available_methods: [
          { method: 'wompi', available: true, reason: null },
          { method: 'cod', available: false, reason: 'COD_BELOW_MINIMUM' },
        ],
        manual_allowed: false,
      },
      90000n,
      0n,
      'addi',
    );
    expect([r.recargo, r.total]).toEqual([9500n, 99500n]);
    expect(r.recargoPct).toBe('10');
    expect(r.disponibilidad.cod).toEqual({ disponible: false, motivo: 'COD_BELOW_MINIMUM' });
  });
});

describe('combinarPolitica (DATA_POLICY_OUTDATED)', () => {
  const actual = { terminos: { slug: 'terminos', title: 'Términos' }, datos: { slug: 'datos', title: 'Datos' }, version: '2' };

  it('la versión del servidor manda y el pedido se manda con ella', () => {
    const r = combinarPolitica(actual, '3', null);
    expect(r.version).toBe('3');
    expect(r.datos).toEqual(actual.datos);
  });

  it('los enlaces leídos reemplazan a los viejos, pero no la versión del servidor', () => {
    const r = combinarPolitica(actual, '3', { datos: { slug: 'datos-2026', title: 'Datos' }, version: '4' });
    expect(r.datos?.slug).toBe('datos-2026');
    expect(r.version).toBe('3');
  });

  it('si el servidor no dio versión, sirve la leída; si tampoco, queda la actual', () => {
    expect(combinarPolitica(actual, null, { version: '5' }).version).toBe('5');
    expect(combinarPolitica(actual, null, { version: '' }).version).toBe('2');
    expect(combinarPolitica(actual, null, null)).toEqual(actual);
  });

  it('el cuerpo del reintento lleva la versión nueva y conserva el bolso', () => {
    const lineas = [linea()];
    const nueva = combinarPolitica(actual, '3', null);
    const cuerpo = armarCuerpo(
      { ...FORMULARIO_VACIO, metodo: 'wompi', terminos: true },
      { ...configCo, versionPoliticaDatos: nueva.version },
      lineas,
      null,
      'clave-nueva',
    );
    expect(cuerpo.data_policy_version).toBe('3');
    expect(cuerpo.items).toEqual([{ variant_id: lineas[0]!.variantId, quantity: 1 }]);
  });
});

describe('ErrorCheckout con DATA_POLICY_OUTDATED', () => {
  it('lee current_version', () => {
    const e = ErrorCheckout.parse({ error: 'DATA_POLICY_OUTDATED', current_version: '7' });
    expect(e.current_version).toBe('7');
  });
});
