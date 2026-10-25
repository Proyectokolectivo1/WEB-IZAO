import { describe, expect, expectTypeOf, it } from 'vitest';
import type { Money } from '../money';
import {
  DOCUMENT_TYPES,
  ESTADO_INTEGRACION_METODO,
  PAYMENT_METHODS,
  isFinancingMethod,
  metodoVendible,
  soloMetodosVendibles,
  maskSecret,
  maskedPreview,
  validateCredentials,
  type CarrierOrder,
  type CarrierOrderSummary,
  type CarrierProvider,
  type CredentialSchema,
  type Order,
  type Payment,
  type PaymentProvider,
  type ProviderStatus,
  type ConfirmRedemptionResult,
  type ExpiringOrderRow,
  type RawRequest,
  type ReserveRedemptionResult,
  type RedemptionFunctionResult,
  type StockFunctionResult,
  type StockShortage,
  type StockState,
  type VerifiedEvent,
} from './index';

const ESQUEMA: CredentialSchema = {
  provider: 'wompi',
  countries: ['CO'],
  environments: ['sandbox', 'production'],
  fields: [
    { key: 'public_key', label: 'Llave pública', secret: false, required: true, kind: 'text' },
    { key: 'private_key', label: 'Llave privada', secret: true, required: true, kind: 'text' },
    { key: 'events_secret', label: 'Secreto de eventos', secret: true, required: true, kind: 'text' },
    { key: 'notes', label: 'Notas', secret: false, required: false, kind: 'text' },
    {
      key: 'mode',
      label: 'Modo',
      secret: false,
      required: false,
      kind: 'select',
      options: ['a', 'b'],
    },
    { key: 'callback_url', label: 'URL de retorno', secret: false, required: false, kind: 'url' },
  ],
};

describe('contracts: credenciales', () => {
  it('maskSecret conserva el prefijo de tipo y los últimos 4 (§26.3)', () => {
    expect(maskSecret('prv_prod_abcdefgh12349a2f')).toBe('prv_prod_****9a2f');
    expect(maskSecret('prv_test_ABCDEFGH1234zz99')).toBe('prv_test_****zz99');
    expect(maskSecret('ABCDEFGHIJKLMNOP1234')).toBe('****1234');
  });

  it('maskSecret no revela secretos cortos', () => {
    expect(maskSecret('abc')).toBe('****');
    expect(maskSecret('12345678901')).toBe('****');
  });

  it('maskedPreview enmascara solo los secretos', () => {
    const preview = maskedPreview(ESQUEMA, {
      public_key: 'pub_prod_1234567890abcd',
      private_key: 'prv_prod_abcdefgh12349a2f',
      events_secret: 'prod_events_ZZZZZZZZZZZZ1111',
    });
    expect(preview).toEqual({
      public_key: 'pub_prod_1234567890abcd',
      private_key: 'prv_prod_****9a2f',
      events_secret: 'prod_events_****1111',
    });
    expect(JSON.stringify(preview)).not.toContain('abcdefgh1234');
  });

  it('validateCredentials exige obligatorios y rechaza campos desconocidos', () => {
    const issues = validateCredentials(ESQUEMA, { public_key: 'x', intruso: 'y' });
    expect(issues.map((i) => `${i.key}:${i.code}`).sort()).toEqual(
      ['events_secret:REQUIRED', 'intruso:UNKNOWN_FIELD', 'private_key:REQUIRED'].sort(),
    );
  });

  it('validateCredentials valida opciones y URL https', () => {
    const issues = validateCredentials(ESQUEMA, {
      public_key: 'x',
      private_key: 'y',
      events_secret: 'z',
      mode: 'c',
      callback_url: 'http://inseguro.example',
    });
    expect(issues.map((i) => i.code).sort()).toEqual(['INVALID_OPTION', 'INVALID_URL']);
  });

  it('validateCredentials acepta valores completos', () => {
    expect(
      validateCredentials(ESQUEMA, {
        public_key: 'x',
        private_key: 'y',
        events_secret: 'z',
        mode: 'a',
        callback_url: 'https://izaoperfumeria.com/api/webhooks/addi',
      }),
    ).toEqual([]);
  });

  it('un valor en blanco cuenta como ausente', () => {
    const issues = validateCredentials(ESQUEMA, {
      public_key: '   ',
      private_key: 'y',
      events_secret: 'z',
    });
    expect(issues).toEqual([
      { key: 'public_key', code: 'REQUIRED', message: 'Llave pública es obligatorio.' },
    ]);
  });
});

describe('contracts: dominio', () => {
  it('métodos de pago y financiación', () => {
    expect(PAYMENT_METHODS).toEqual(['wompi', 'addi', 'sistecredito', 'cod']);
    expect(isFinancingMethod('addi')).toBe(true);
    expect(isFinancingMethod('sistecredito')).toBe(true);
    expect(isFinancingMethod('wompi')).toBe(false);
    expect(isFinancingMethod('cod')).toBe(false);
  });

  it('Sistecrédito no se vende mientras su integración esté pendiente de documentación (D-032)', () => {
    expect(ESTADO_INTEGRACION_METODO.sistecredito).toBe('pendiente_documentacion');
    expect(metodoVendible('sistecredito')).toBe(false);
    for (const m of ['wompi', 'addi', 'cod'] as const) expect(metodoVendible(m)).toBe(true);
    expect(metodoVendible('otro')).toBe(false);
    expect(Object.keys(ESTADO_INTEGRACION_METODO).sort()).toEqual([...PAYMENT_METHODS].sort());
  });

  it('soloMetodosVendibles apaga los métodos no vendibles sin perder los demás campos', () => {
    const filas = [
      { method: 'wompi' as const, is_enabled: true, sort_order: 1 },
      { method: 'sistecredito' as const, is_enabled: true, sort_order: 2 },
      { method: 'cod' as const, is_enabled: false, sort_order: 3 },
    ];
    const r = soloMetodosVendibles(filas);
    expect(r).toEqual([
      { method: 'wompi', is_enabled: true, sort_order: 1 },
      { method: 'sistecredito', is_enabled: false, sort_order: 2 },
      { method: 'cod', is_enabled: false, sort_order: 3 },
    ]);
    expect(filas[1]!.is_enabled).toBe(true);
  });

  it('tipos de documento por país (§10.1)', () => {
    expect(DOCUMENT_TYPES.CO).toEqual(['CC', 'CE', 'NIT', 'PAS', 'TI']);
    expect(DOCUMENT_TYPES.EC).toEqual(['CEDULA', 'RUC', 'PASAPORTE']);
  });
});

describe('contracts: interfaces (comprobación de tipos)', () => {
  it('los montos de Order y Payment son bigint', () => {
    expectTypeOf<Order['total_customer']>().toEqualTypeOf<bigint>();
    expectTypeOf<Order['items'][number]['line_discount']>().toEqualTypeOf<bigint>();
    expectTypeOf<Payment['amount']>().toEqualTypeOf<bigint>();
    expectTypeOf<ProviderStatus['amount']>().toEqualTypeOf<bigint | null>();
  });

  it('PaymentProvider tiene la forma de §12.1', () => {
    expectTypeOf<PaymentProvider['verifyWebhook']>().toEqualTypeOf<
      (req: RawRequest) => Promise<VerifiedEvent | null>
    >();
    expectTypeOf<Parameters<NonNullable<PaymentProvider['createPaymentLink']>>[2]>().toEqualTypeOf<{
      amount: Money;
      expiresAt: Date;
    }>();
    expectTypeOf<PaymentProvider['credentialSchema']>().toEqualTypeOf<CredentialSchema>();
  });

  it('CarrierProvider tiene la forma de §14.1', () => {
    expectTypeOf<CarrierProvider['getOrder']>().toEqualTypeOf<
      (ref: { externalOrderId?: string; providerOrderId?: number }) => Promise<CarrierOrder>
    >();
    expectTypeOf<CarrierProvider['listOrders']>().toEqualTypeOf<
      (filter: { startDate: Date; page: number }) => Promise<CarrierOrderSummary[]>
    >();
    expectTypeOf<CarrierProvider['createOrder']>().toEqualTypeOf<
      (order: Order) => Promise<{ providerOrderId: number; statusId: number }>
    >();
  });

  it('resultados de funciones de stock y canje se distinguen por ok y motivo', () => {
    const r = { ok: false, estado: 'none', motivo: 'sin_stock', faltantes: [] } as StockFunctionResult;
    if (!r.ok && r.motivo === 'sin_stock') expectTypeOf(r.faltantes).toEqualTypeOf<StockShortage[]>();
    expectTypeOf<Extract<RedemptionFunctionResult, { ok: false }>['motivo']>().toEqualTypeOf<
      | 'pedido_inexistente'
      | 'codigo_inactivo'
      | 'codigo_de_otro_pais'
      | 'codigo_fuera_de_vigencia'
      | 'limite_total'
      | 'limite_por_cliente'
    >();
    expectTypeOf<Order['stock_state']>().toEqualTypeOf<StockState>();
    expectTypeOf<Order['whatsapp_opt_in']>().toEqualTypeOf<boolean>();
  });

  it('A2/M3: pago_rechazado vence y confirmar_canje no revalida límites ni vigencia', () => {
    expectTypeOf<ExpiringOrderRow['estado_actual']>().toEqualTypeOf<
      'pendiente_pago' | 'pago_rechazado' | 'esperando_abono' | 'pendiente_manual'
    >();
    expectTypeOf<ExpiringOrderRow['nuevo_estado']>().toEqualTypeOf<'expirado' | 'abandonado'>();
    expectTypeOf<Extract<ConfirmRedemptionResult, { ok: false }>['motivo']>().toEqualTypeOf<
      'pedido_inexistente'
    >();
    expectTypeOf<Extract<ConfirmRedemptionResult, { ok: true }>['advertencia']>().toEqualTypeOf<
      'limite_superado' | undefined
    >();
    expectTypeOf<Extract<ReserveRedemptionResult, { ok: false }>['motivo']>().toEqualTypeOf<
      | 'pedido_inexistente'
      | 'codigo_inactivo'
      | 'codigo_de_otro_pais'
      | 'codigo_fuera_de_vigencia'
      | 'limite_total'
      | 'limite_por_cliente'
    >();
    const r: ConfirmRedemptionResult = { ok: true, estado: 'confirmed', advertencia: 'limite_superado' };
    expect(r.ok && r.advertencia).toBe('limite_superado');
    // discount_code_text lo llena el trigger: es de solo lectura en el contrato.
    expectTypeOf<Readonly<Pick<Order, 'discount_code_text'>>>().toEqualTypeOf<
      Pick<Order, 'discount_code_text'>
    >();
  });

  it('un adaptador de prueba implementa CarrierProvider', async () => {
    const fake: CarrierProvider = {
      id: 'fake',
      createOrder: async () => ({ providerOrderId: 1, statusId: 1 }),
      confirmOrder: async () => undefined,
      getOrder: async () => {
        throw new Error('no usado');
      },
      listOrders: async () => [],
      cancelOrder: async () => undefined,
      testCredentials: async () => ({ ok: true, message: 'ok' }),
    };
    await expect(fake.listOrders({ startDate: new Date(0), page: 1 })).resolves.toEqual([]);
  });
});
