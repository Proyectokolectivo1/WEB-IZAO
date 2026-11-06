import { describe, expect, it } from 'vitest';
import {
  PLANTILLAS_META,
  PLANTILLAS_SEMILLA,
  mensajePlantilla,
  nombreVersion,
  solicitudCreacion,
  validarPlantilla,
  type PlantillaWhatsApp,
  type ValoresCobro,
  urlPagoAbono,
  validarEnvio,
} from './plantillas';

const COBRO: PlantillaWhatsApp = {
  key: 'cobro_abono',
  meta_template_name: 'cobro_abono_v1',
  language: 'es',
  body_text:
    'Hola, {{1}}. Recibimos tu pedido {{2}} en Izao Perfumería.\nRealiza el abono de {{3}}. Al recibir pagas {{4}}.\nDisponible hasta el {{5}}.',
  footer_text: 'Izao Perfumería',
  button_text: 'Pagar abono',
  button_url: 'https://izaoperfumeria.com/pagar/{{1}}',
  variables_map: { '1': 'customer_first_name', '2': 'order_number', '3': 'cod_deposit_amount', '4': 'cod_collect_amount', '5': 'pay_link_expires_at' },
};

const VALORES: ValoresCobro = {
  customer_first_name: 'Laura',
  order_number: 'IZ-CO-000123',
  cod_deposit_amount: '$30.000',
  cod_collect_amount: '$219.900',
  pay_link_expires_at: '21 de octubre, 3:04 p. m.',
  pay_link_url: 'https://izaoperfumeria.com/co/pagar/Ab12Cd34Ef',
};

describe('validación de plantillas (reglas de revisión de Meta, D-025)', () => {
  it('la plantilla de cobro y las semillas son válidas', () => {
    expect(validarPlantilla(COBRO)).toEqual([]);
    for (const p of PLANTILLAS_SEMILLA) expect(validarPlantilla({ ...p, meta_template_name: nombreVersion(p.key, 1) })).toEqual([]);
  });

  it('variables no secuenciales o fuera de orden de aparición', () => {
    const p = { ...COBRO, body_text: 'Hola {{1}}, pedido {{3}} listo.', variables_map: { '1': 'customer_first_name', '3': 'order_number' } };
    expect(validarPlantilla(p).map((i) => i.codigo)).toContain('VARIABLES_NO_SECUENCIALES');
    const q = { ...COBRO, body_text: 'Hola {{2}}, pedido {{1}} listo.', variables_map: { '1': 'customer_first_name', '2': 'order_number' } };
    expect(validarPlantilla(q).map((i) => i.codigo)).toContain('VARIABLES_NO_SECUENCIALES');
  });

  it('variable al inicio o al final del texto', () => {
    expect(validarPlantilla({ ...COBRO, body_text: '{{1}}, tu pedido {{2}} va en camino.', variables_map: { '1': 'customer_first_name', '2': 'order_number' } }).map((i) => i.codigo)).toContain('VARIABLE_EN_EXTREMO');
    expect(validarPlantilla({ ...COBRO, body_text: 'Hola, tu pedido es {{1}}', variables_map: { '1': 'order_number' } }).map((i) => i.codigo)).toContain('VARIABLE_EN_EXTREMO');
  });

  it('llaves mal formadas, variable sin mapa o mapa a variable desconocida', () => {
    expect(validarPlantilla({ ...COBRO, body_text: 'Hola {{nombre}} y {1}} listo.' }).map((i) => i.codigo)).toContain('LLAVES_INVALIDAS');
    expect(validarPlantilla({ ...COBRO, variables_map: { '1': 'customer_first_name' } }).map((i) => i.codigo)).toContain('VARIABLE_SIN_MAPA');
    expect(validarPlantilla({ ...COBRO, variables_map: { ...COBRO.variables_map, '5': 'document_number' } }).map((i) => i.codigo)).toContain('VARIABLE_DESCONOCIDA');
  });

  it('límites de longitud, nombre, idioma y URL del botón con base fija', () => {
    const codigos = (p: Partial<PlantillaWhatsApp>) => validarPlantilla({ ...COBRO, ...p }).map((i) => i.codigo);
    expect(codigos({ body_text: `Hola {{1}} ${'a'.repeat(1030)} fin` , variables_map: { '1': 'customer_first_name' } })).toContain('CUERPO_LARGO');
    expect(codigos({ footer_text: 'x'.repeat(61) })).toContain('PIE_LARGO');
    expect(codigos({ button_text: 'x'.repeat(26) })).toContain('BOTON_LARGO');
    expect(codigos({ meta_template_name: 'Cobro Abono' })).toContain('NOMBRE_INVALIDO');
    expect(codigos({ language: 'español' })).toContain('IDIOMA_INVALIDO');
    expect(codigos({ button_url: 'https://izaoperfumeria.com/{{1}}/pagar' })).toContain('URL_BOTON_INVALIDA');
    expect(codigos({ button_url: 'http://izaoperfumeria.com/pagar/{{1}}' })).toContain('URL_BOTON_INVALIDA');
  });

  it('texto que afirma originalidad o es promocional se rechaza (regla 7 y categoría UTILITY)', () => {
    const c = validarPlantilla({ ...COBRO, body_text: `${COBRO.body_text} Producto 100% original.` }).map((i) => i.codigo);
    expect(c).toContain('TEXTO_NO_PERMITIDO');
  });
});

describe('mensaje de plantilla (POST /{phone_number_id}/messages)', () => {
  it('parámetros del cuerpo en orden de posición y botón URL con el token', () => {
    expect(mensajePlantilla(COBRO, { to: '+573001234567', valores: VALORES, tokenBoton: 'Ab12Cd34Ef' })).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '573001234567',
      type: 'template',
      template: {
        name: 'cobro_abono_v1',
        language: { code: 'es' },
        components: [
          {
            type: 'body',
            parameters: ['Laura', 'IZ-CO-000123', '$30.000', '$219.900', '21 de octubre, 3:04 p. m.'].map((text) => ({ type: 'text', text })),
          },
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: 'Ab12Cd34Ef' }] },
        ],
      },
    });
  });

  it('el mapa decide qué valor va en cada posición (recordatorio final renumerado)', () => {
    const final = PLANTILLAS_SEMILLA.find((p) => p.key === 'recordatorio_abono_final')!;
    const m = mensajePlantilla({ ...final, meta_template_name: 'recordatorio_abono_final_v1' }, { to: '573001234567', valores: VALORES, tokenBoton: 'Ab12Cd34Ef' });
    const cuerpo = m.template.components[0]!;
    expect(cuerpo.parameters.map((p) => p.text)).toEqual(['Laura', 'IZ-CO-000123', '21 de octubre, 3:04 p. m.', '$30.000']);
  });

  it('rechaza número no E.164, token inválido y valores vacíos o con saltos de línea', () => {
    expect(() => mensajePlantilla(COBRO, { to: '3001234567', valores: VALORES, tokenBoton: 'Ab12Cd34Ef' })).toThrow(RangeError);
    expect(() => mensajePlantilla(COBRO, { to: '573001234567', valores: VALORES, tokenBoton: 'a b' })).toThrow(RangeError);
    expect(() => mensajePlantilla(COBRO, { to: '573001234567', valores: { ...VALORES, customer_first_name: ' ' }, tokenBoton: 'Ab12Cd34Ef' })).toThrow(RangeError);
    expect(() => mensajePlantilla(COBRO, { to: '573001234567', valores: { ...VALORES, customer_first_name: 'a\nb' }, tokenBoton: 'Ab12Cd34Ef' })).toThrow(RangeError);
  });
});

describe('creación de versión en Meta (POST /{waba_id}/message_templates)', () => {
  it('nombre {key}_v{n}', () => {
    expect(nombreVersion('cobro_abono', 3)).toBe('cobro_abono_v3');
    expect(() => nombreVersion('cobro_abono', 0)).toThrow(RangeError);
  });

  it('UTILITY, idioma, cuerpo con ejemplos en orden, pie y botón URL con ejemplo', () => {
    expect(solicitudCreacion(COBRO, VALORES, 'Ab12Cd34Ef')).toEqual({
      name: 'cobro_abono_v1',
      language: 'es',
      category: 'UTILITY',
      components: [
        { type: 'BODY', text: COBRO.body_text, example: { body_text: [['Laura', 'IZ-CO-000123', '$30.000', '$219.900', '21 de octubre, 3:04 p. m.']] } },
        { type: 'FOOTER', text: 'Izao Perfumería' },
        { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'Pagar abono', url: 'https://izaoperfumeria.com/pagar/{{1}}', example: ['Ab12Cd34Ef'] }] },
      ],
    });
  });

  it('no crea una plantilla inválida', () => {
    expect(() => solicitudCreacion({ ...COBRO, body_text: '{{1}} hola' }, VALORES, 'Ab12Cd34Ef')).toThrow(/VARIABLE_EN_EXTREMO/);
  });
});

describe('plantillas ya aprobadas en Meta (nombre, idioma y orden de variables idénticos)', () => {
  const inicial = PLANTILLAS_SEMILLA.find((p) => p.key === 'cobro_abono')!;
  const conNombre = { ...inicial, meta_template_name: PLANTILLAS_META.cobro_abono!.meta_template_name };

  it('cobro_abono = izao_pago_envio_inicial, es_CO, 4 variables (nombre, pedido, abono, link) y sin botón', () => {
    expect(PLANTILLAS_META.cobro_abono).toEqual({ meta_template_name: 'izao_pago_envio_inicial', language: 'es_CO' });
    expect(inicial.language).toBe('es_CO');
    expect(inicial.button_url).toBeNull();
    expect(inicial.variables_map).toEqual({ '1': 'customer_first_name', '2': 'order_number', '3': 'cod_deposit_amount', '4': 'pay_link_url' });
    expect(inicial.body_text).toContain('verificar al numero 3161791082');
  });

  it('el mensaje lleva nombre e idioma de Meta y los 4 parámetros en orden, sin componente de botón', () => {
    const m = mensajePlantilla(conNombre, { to: '573001234567', valores: VALORES, tokenBoton: 'Ab12Cd34Ef' });
    expect(m.template.name).toBe('izao_pago_envio_inicial');
    expect(m.template.language).toEqual({ code: 'es_CO' });
    expect(m.template.components).toEqual([
      {
        type: 'body',
        parameters: ['Laura', 'IZ-CO-000123', '$30.000', 'https://izaoperfumeria.com/co/pagar/Ab12Cd34Ef'].map((text) => ({ type: 'text', text })),
      },
    ]);
  });

  it('el texto aprobado por Meta no bloquea el envío; las reglas de texto siguen al crear versiones', () => {
    expect(validarEnvio(conNombre)).toEqual([]);
    const conOriginal = { ...conNombre, body_text: `${conNombre.body_text} Producto original.` };
    expect(validarEnvio(conOriginal)).toEqual([]);
    expect(validarPlantilla(conOriginal).map((i) => i.codigo)).toContain('TEXTO_NO_PERMITIDO');
    expect(() => solicitudCreacion(conOriginal, VALORES, 'Ab12Cd34Ef')).toThrow(/TEXTO_NO_PERMITIDO/);
  });

  it('el envío sigue exigiendo estructura: variables en orden y mapeadas, nombre e idioma válidos', () => {
    expect(validarEnvio({ ...conNombre, variables_map: { '1': 'customer_first_name' } }).map((i) => i.codigo)).toContain('VARIABLE_SIN_MAPA');
    expect(validarEnvio({ ...conNombre, language: 'es-CO' }).map((i) => i.codigo)).toContain('IDIOMA_INVALIDO');
    expect(() => mensajePlantilla({ ...conNombre, body_text: 'Hola {{2}} y {{1}} listo.' }, { to: '573001234567', valores: VALORES, tokenBoton: 'Ab12Cd34Ef' })).toThrow(RangeError);
  });
});

describe('link de marca del abono (/{pais}/pagar/{token})', () => {
  it('incluye el país en minúscula y no deja barras dobles', () => {
    expect(urlPagoAbono('https://izaoperfumeria.com/', 'CO', 'Ab12Cd34Ef')).toBe('https://izaoperfumeria.com/co/pagar/Ab12Cd34Ef');
    expect(urlPagoAbono('https://izaoperfumeria.com', 'EC', 'Ab12Cd34Ef')).toBe('https://izaoperfumeria.com/ec/pagar/Ab12Cd34Ef');
  });

  it('rechaza origen no https, país desconocido y token inválido', () => {
    expect(() => urlPagoAbono('http://izaoperfumeria.com', 'CO', 'Ab12Cd34Ef')).toThrow(RangeError);
    expect(() => urlPagoAbono('https://izaoperfumeria.com/x', 'CO', 'Ab12Cd34Ef')).toThrow(RangeError);
    expect(() => urlPagoAbono('https://izaoperfumeria.com', 'PE', 'Ab12Cd34Ef')).toThrow(RangeError);
    expect(() => urlPagoAbono('https://izaoperfumeria.com', 'CO', 'a/b')).toThrow(RangeError);
  });
});
