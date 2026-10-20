import { describe, expect, it } from 'vitest';
import { createConnection, QUEUE_NAMES } from './queues.js';

describe('queues', () => {
  it('expone la cola de sistema', () => {
    expect(QUEUE_NAMES.sistema).toBe('sistema');
  });

  it('expone las colas de pagos y contra entrega', () => {
    expect(QUEUE_NAMES.pagos).toBe('pagos');
    expect(QUEUE_NAMES.contraentrega).toBeTruthy();
  });

  it('exige REDIS_URL', () => {
    expect(() => createConnection('')).toThrow('REDIS_URL');
  });
});
