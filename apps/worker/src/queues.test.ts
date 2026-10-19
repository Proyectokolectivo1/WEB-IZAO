import { describe, expect, it } from 'vitest';
import { createConnection, QUEUE_NAMES } from './queues.js';

describe('queues', () => {
  it('expone la cola de sistema', () => {
    expect(QUEUE_NAMES.sistema).toBe('sistema');
  });

  it('exige REDIS_URL', () => {
    expect(() => createConnection('')).toThrow('REDIS_URL');
  });
});
