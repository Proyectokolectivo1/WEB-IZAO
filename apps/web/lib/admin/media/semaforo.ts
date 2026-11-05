/**
 * Semáforo con cola y tiempo de espera. Limita cuántas imágenes se procesan a la vez en el proceso: cada una puede
 * decodificar decenas de megapíxeles y varias en paralelo agotarían la memoria del VPS.
 */
export class SemaforoOcupado extends Error {
  constructor() {
    super('Hay demasiadas imágenes procesándose en este momento.');
    this.name = 'SemaforoOcupado';
  }
}

export type Semaforo = {
  /** Espera un turno; devuelve la función que lo libera. Lanza `SemaforoOcupado` si se agota la espera. */
  adquirir(esperaMaximaMs: number): Promise<() => void>;
  readonly activas: number;
  readonly enCola: number;
};

export function crearSemaforo(maximo: number): Semaforo {
  let activas = 0;
  const cola: Array<{ entrar: () => void }> = [];

  const liberarTurno = () => {
    const siguiente = cola.shift();
    if (siguiente) siguiente.entrar();
    else activas -= 1;
  };

  return {
    adquirir(esperaMaximaMs) {
      const turno = () => {
        let liberado = false;
        return () => {
          if (liberado) return;
          liberado = true;
          liberarTurno();
        };
      };
      if (activas < maximo) {
        activas += 1;
        return Promise.resolve(turno());
      }
      return new Promise<() => void>((resolver, rechazar) => {
        const espera = { entrar: () => {} };
        const reloj = setTimeout(() => {
          const i = cola.indexOf(espera);
          if (i >= 0) cola.splice(i, 1);
          rechazar(new SemaforoOcupado());
        }, esperaMaximaMs);
        // El turno se transfiere directamente (activas no cambia), así no hay carrera entre liberar y entrar.
        espera.entrar = () => {
          clearTimeout(reloj);
          resolver(turno());
        };
        cola.push(espera);
      });
    },
    get activas() {
      return activas;
    },
    get enCola() {
      return cola.length;
    },
  };
}
