/**
 * Cliente de lectura de la tienda: una sola petición por clave en vuelo, caché con vencimiento y revalidación
 * en segundo plano, y cancelación por suscriptor.
 *
 * - Dos llamadas con la misma clave mientras la primera sigue en vuelo comparten la misma petición (doble montaje de
 *   StrictMode, la vista rápida y «Agregar», el bolso y la ficha, etc.).
 * - `vigenteMs`: durante ese tiempo se responde desde memoria sin tocar la red.
 * - `obsoletoMs`: pasado `vigenteMs`, se responde lo guardado y se renueva en segundo plano (stale-while-revalidate).
 * - Cada llamada trae su propia `signal`: cancelar una no corta a las demás; la petición real solo se aborta cuando
 *   ya no queda nadie esperándola.
 * - Solo se guardan respuestas correctas; un fallo nunca se recuerda.
 * - Solo vive en el navegador (módulo con estado). En el servidor cada render es independiente: ahí se usa `cache()` de React.
 */

export class ErrorHttp extends Error {
  constructor(readonly estado: number) {
    super(`HTTP ${estado}`);
    this.name = 'ErrorHttp';
  }
}

export interface OpcionesLectura {
  /** Milisegundos en que la respuesta se sirve sin pedir de nuevo (0 = solo se dedupe lo que está en vuelo). */
  vigenteMs?: number;
  /** Milisegundos adicionales en que se sirve lo guardado y se renueva por detrás. */
  obsoletoMs?: number;
  signal?: AbortSignal;
  /** Para POST u otros métodos; la clave incluye método y cuerpo. */
  init?: Omit<RequestInit, 'signal'>;
  /** Clave propia (por defecto método + URL + cuerpo). */
  clave?: string;
}

interface Guardado {
  valor: unknown;
  vigenteHasta: number;
  obsoletoHasta: number;
}

interface EnVuelo {
  promesa: Promise<unknown>;
  control: AbortController;
  suscriptores: number;
}

const MAXIMO_GUARDADOS = 200;
const guardados = new Map<string, Guardado>();
const enVuelo = new Map<string, EnVuelo>();

/** Contadores para pruebas y para medir en el navegador (`window.__izaoFetcher`). */
export const estadisticas = { redes: 0, aciertos: 0, compartidas: 0 };

function claveDe(url: string, o: OpcionesLectura): string {
  if (o.clave) return o.clave;
  const metodo = (o.init?.method ?? 'GET').toUpperCase();
  const cuerpo = typeof o.init?.body === 'string' ? o.init.body : '';
  return `${metodo} ${url} ${cuerpo}`;
}

function errorDeCancelacion(): Error {
  return typeof DOMException === 'function' ? new DOMException('Cancelado', 'AbortError') : Object.assign(new Error('Cancelado'), { name: 'AbortError' });
}

function guardar(clave: string, valor: unknown, o: OpcionesLectura): void {
  const vigente = o.vigenteMs ?? 0;
  if (vigente <= 0) return;
  if (guardados.size >= MAXIMO_GUARDADOS) {
    const primera = guardados.keys().next();
    if (!primera.done) guardados.delete(primera.value);
  }
  const ahora = Date.now();
  guardados.set(clave, { valor, vigenteHasta: ahora + vigente, obsoletoHasta: ahora + vigente + (o.obsoletoMs ?? 0) });
}

function iniciar(url: string, clave: string, o: OpcionesLectura): EnVuelo {
  const control = new AbortController();
  estadisticas.redes += 1;
  const promesa = fetch(url, { ...o.init, signal: control.signal })
    .then((r) => {
      if (!r.ok) throw new ErrorHttp(r.status);
      return r.json() as Promise<unknown>;
    })
    .then((valor) => {
      guardar(clave, valor, o);
      return valor;
    })
    .finally(() => {
      if (enVuelo.get(clave)?.control === control) enVuelo.delete(clave);
    });
  // Evita «unhandled rejection» si todos los suscriptores se fueron antes del fallo.
  promesa.catch(() => undefined);
  const entrada: EnVuelo = { promesa, control, suscriptores: 0 };
  enVuelo.set(clave, entrada);
  return entrada;
}

function esperar<T>(clave: string, entrada: EnVuelo, signal?: AbortSignal): Promise<T> {
  entrada.suscriptores += 1;
  return new Promise<T>((resolver, rechazar) => {
    let cerrado = false;
    const salir = () => {
      if (cerrado) return;
      cerrado = true;
      signal?.removeEventListener('abort', alCancelar);
      entrada.suscriptores -= 1;
    };
    function alCancelar() {
      if (cerrado) return;
      salir();
      if (entrada.suscriptores <= 0) {
        if (enVuelo.get(clave) === entrada) enVuelo.delete(clave);
        entrada.control.abort();
      }
      rechazar(errorDeCancelacion());
    }
    if (signal?.aborted) {
      cerrado = false;
      alCancelar();
      return;
    }
    signal?.addEventListener('abort', alCancelar, { once: true });
    entrada.promesa.then(
      (v) => {
        if (cerrado) return;
        salir();
        resolver(v as T);
      },
      (e: unknown) => {
        if (cerrado) return;
        salir();
        rechazar(e);
      },
    );
  });
}

/** GET (o la petición de `init`) con dedupe, caché y revalidación. Rechaza con `ErrorHttp` si el servidor no responde 2xx. */
export function pedirJson<T>(url: string, opciones: OpcionesLectura = {}): Promise<T> {
  const clave = claveDe(url, opciones);
  const ahora = Date.now();
  const previo = guardados.get(clave);
  if (previo && ahora < previo.vigenteHasta) {
    estadisticas.aciertos += 1;
    return Promise.resolve(previo.valor as T);
  }
  if (previo && ahora < previo.obsoletoHasta) {
    estadisticas.aciertos += 1;
    if (!enVuelo.has(clave)) iniciar(url, clave, opciones);
    return Promise.resolve(previo.valor as T);
  }
  if (previo) guardados.delete(clave);
  let entrada = enVuelo.get(clave);
  if (entrada) estadisticas.compartidas += 1;
  else entrada = iniciar(url, clave, opciones);
  return esperar<T>(clave, entrada, opciones.signal);
}

/** Olvida lo guardado cuyas claves contienen `fragmento` (todo, si no se da). No cancela lo que está en vuelo. */
export function olvidar(fragmento?: string): void {
  if (!fragmento) {
    guardados.clear();
    return;
  }
  for (const k of [...guardados.keys()]) if (k.includes(fragmento)) guardados.delete(k);
}

/** Solo para pruebas. */
export function reiniciarFetcher(): void {
  guardados.clear();
  for (const e of enVuelo.values()) e.control.abort();
  enVuelo.clear();
  estadisticas.redes = 0;
  estadisticas.aciertos = 0;
  estadisticas.compartidas = 0;
}

/** Vigencias por tipo de dato (milisegundos); un solo lugar para ajustarlas. */
export const VIGENCIA = {
  sugerencias: { vigenteMs: 60_000, obsoletoMs: 5 * 60_000 },
  relacionados: { vigenteMs: 60_000, obsoletoMs: 5 * 60_000 },
  listado: { vigenteMs: 30_000, obsoletoMs: 0 },
  conteo: { vigenteMs: 30_000, obsoletoMs: 0 },
  estadoChat: { vigenteMs: 60_000, obsoletoMs: 5 * 60_000 },
  configResenas: { vigenteMs: 10 * 60_000, obsoletoMs: 0 },
  ciudades: { vigenteMs: 60 * 60_000, obsoletoMs: 0 },
  producto: { vigenteMs: 60_000, obsoletoMs: 0 },
} as const;
