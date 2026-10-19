/** Reloj inyectable: las pruebas usan uno falso que avanza sin esperar. */
export interface Clock {
  /** Milisegundos desde la época. */
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** Reloj falso: `sleep` avanza el tiempo al instante y queda registrado. */
export class FakeClock implements Clock {
  private current: number;
  readonly sleeps: number[] = [];

  constructor(start: Date | number = Date.UTC(2026, 9, 19, 15, 0, 0)) {
    this.current = typeof start === 'number' ? start : start.getTime();
  }

  now(): number {
    return this.current;
  }

  sleep(ms: number): Promise<void> {
    this.sleeps.push(ms);
    this.current += Math.max(0, ms);
    return Promise.resolve();
  }

  advance(ms: number): void {
    this.current += ms;
  }

  date(): Date {
    return new Date(this.current);
  }
}
