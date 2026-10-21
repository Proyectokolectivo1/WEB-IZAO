import { describe, expect, it } from 'vitest';
import { CLAVES_PLANTILLA_COD, PLANTILLAS_SEMILLA, VARIABLES_COBRO, nombreVersion } from '@izao/whatsapp';
import {
  CLAVES_PLANTILLA,
  CLAVE_VARIABLE_BOTON,
  VARIABLES_PLANTILLA,
  VARIABLE_BOTON,
  VALORES_EJEMPLO,
  mensajeProblema,
  normalizarMapa,
  posicionesDelTexto,
  textoDeEjemplo,
} from './etiquetas';
import { esquemaPlantilla, validarCampos, type CamposEditables } from './plantillas';

const ID = '11111111-1111-4111-8111-111111111111';

const base = (extra: Partial<CamposEditables> = {}): CamposEditables => ({
  key: 'cobro_abono',
  meta_template_name: 'cobro_abono_v2',
  language: 'es',
  body_text: 'Hola, {{1}}. Tu pedido {{2}} espera el abono de {{3}}. Al recibir pagas {{4}}. Disponible hasta el {{5}}.',
  footer_text: 'Izao Perfumería',
  button_text: 'Pagar abono',
  button_url: 'https://izaoperfumeria.com/pagar/{{1}}',
  variables_map: {
    '1': 'customer_first_name',
    '2': 'order_number',
    '3': 'cod_deposit_amount',
    '4': 'cod_collect_amount',
    '5': 'pay_link_expires_at',
    [CLAVE_VARIABLE_BOTON]: VARIABLE_BOTON,
  },
  ...extra,
});

describe('constantes del panel frente a @izao/whatsapp', () => {
  it('las claves y las variables coinciden con el paquete', () => {
    expect([...CLAVES_PLANTILLA]).toEqual([...CLAVES_PLANTILLA_COD]);
    expect(Object.keys(VARIABLES_PLANTILLA).sort()).toEqual([...VARIABLES_COBRO].sort());
    expect(Object.keys(VALORES_EJEMPLO).sort()).toEqual([...VARIABLES_COBRO].sort());
  });

  it('los textos por defecto del paquete pasan la validación', () => {
    for (const s of PLANTILLAS_SEMILLA) {
      expect(validarCampos({ ...s, meta_template_name: nombreVersion(s.key, 1), variables_map: { ...s.variables_map } }), s.key).toEqual([]);
    }
  });
});

describe('validarCampos', () => {
  it('una plantilla correcta no tiene problemas', () => {
    expect(validarCampos(base())).toEqual([]);
  });

  it('rechaza variable al inicio y mapa incompleto con mensajes en español', () => {
    const problemas = validarCampos(base({ body_text: '{{1}} tu pedido {{2}} espera', variables_map: { '1': 'customer_first_name' } }));
    const codigos = problemas.map((p) => p.codigo);
    expect(codigos).toContain('VARIABLE_EN_EXTREMO');
    expect(codigos).toContain('VARIABLE_SIN_MAPA');
    expect(problemas.find((p) => p.codigo === 'VARIABLE_SIN_MAPA')?.mensaje).toContain('{{2}}');
  });

  it('rechaza palabras de originalidad y lenguaje promocional', () => {
    for (const t of ['Tu perfume original espera. Gracias por tu compra hoy.', 'Aprovecha este descuento exclusivo en tu pedido ahora.']) {
      expect(validarCampos(base({ body_text: `Hola ${t}`, variables_map: {}, button_text: null, button_url: null })).map((p) => p.codigo)).toContain(
        'TEXTO_NO_PERMITIDO',
      );
    }
  });

  it('cada código conocido tiene mensaje propio y los desconocidos uno genérico', () => {
    expect(mensajeProblema('URL_BOTON_INVALIDA')).toContain('https');
    expect(mensajeProblema('NO_EXISTE')).toContain('NO_EXISTE');
  });
});

describe('utilidades de texto', () => {
  it('posicionesDelTexto no repite y respeta el orden', () => {
    expect(posicionesDelTexto('a {{1}} b {{2}} c {{1}} d {{3}}')).toEqual([1, 2, 3]);
  });

  it('normalizarMapa quita posiciones que ya no existen y agrega el botón', () => {
    expect(normalizarMapa({ '1': 'order_number', '9': 'order_number' }, true, [1])).toEqual({ '1': 'order_number', [CLAVE_VARIABLE_BOTON]: VARIABLE_BOTON });
    expect(normalizarMapa({ '1': 'order_number' }, false, [1, 2])).toEqual({ '1': 'order_number' });
  });

  it('textoDeEjemplo sustituye solo lo que tiene dato', () => {
    expect(textoDeEjemplo('Hola {{1}}, {{2}}', { '1': 'customer_first_name' })).toBe('Hola Camila, {{2}}');
  });
});

describe('esquemaPlantilla', () => {
  const entrada = (extra: Record<string, string> = {}) => ({
    id: ID,
    language: 'es',
    body_text: 'Hola {{1}} texto',
    footer_text: '  ',
    button_text: '',
    button_url: '',
    variables_map: '{"1":"customer_first_name"}',
    ...extra,
  });

  it('convierte vacíos en null y lee el mapa JSON', () => {
    const r = esquemaPlantilla.parse(entrada());
    expect(r.footer_text).toBeNull();
    expect(r.button_url).toBeNull();
    expect(r.variables_map).toEqual({ '1': 'customer_first_name' });
  });

  it('rechaza un mapa que no es JSON de texto, un id inválido y un idioma vacío', () => {
    expect(esquemaPlantilla.safeParse(entrada({ variables_map: 'no-json' })).success).toBe(false);
    expect(esquemaPlantilla.safeParse(entrada({ variables_map: '{"1":5}' })).success).toBe(false);
    expect(esquemaPlantilla.safeParse(entrada({ id: 'x' })).success).toBe(false);
    expect(esquemaPlantilla.safeParse(entrada({ language: '' })).success).toBe(false);
  });
});
