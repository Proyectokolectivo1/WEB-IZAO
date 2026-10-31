/**
 * Un turno de conversación con Iza (§20.2, §20.5): arma el prompt, llama al modelo con streaming, ejecuta las
 * herramientas (máximo 4 rondas) y convierte los marcadores `[[producto:slug]]` en tarjetas validadas contra el catálogo
 * del país. Todo entra por `DepsConversar`; aquí no hay red, base ni Next, así que se prueba con proveedores falsos.
 *
 * Presupuesto: el nivel (`normal | degradado`) decide el modelo; el costo de cada llamada es el que informa el proveedor o,
 * si falta, la estimación por tokens (`estimarCostoMicros`), y se suma al total del turno.
 */
import type { LineaCarrito } from '../carrito/logica';
import { DEFINICIONES, MAX_ITERACIONES_HERRAMIENTAS, ejecutarHerramienta, type DepsHerramientas } from './herramientas';
import type { LLMProvider, MensajeLLM, TurnoGuardado } from './llm';
import { FiltroMarcadores } from './marcadores';
import { elegirModelo, estimarCostoMicros, type NivelPresupuesto, type PreciosModelo } from './presupuesto';
import { construirPrompt, type ContextoPrompt } from './prompt';

export const MAX_TARJETAS_POR_RESPUESTA = 3;

export interface TarjetaChat {
  slug: string;
  nombre: string;
  presentacion: string | null;
  /** Precio del país ya formateado. */
  precio: string;
  disponible: boolean;
  url: string;
  /** Miniatura (solo lo necesario para pintarla). */
  imagen: Omit<NonNullable<LineaCarrito['imagen']>, never> | null;
  /** Línea lista para el bolso (variante por defecto con existencias); `null` si está agotado. */
  linea: Omit<LineaCarrito, 'cantidad'> | null;
}

export type EventoChat =
  | { tipo: 'texto'; texto: string }
  | { tipo: 'tarjeta'; tarjeta: TarjetaChat }
  | { tipo: 'fin' }
  | { tipo: 'error'; codigo: 'proveedor' | 'sin_modelo' };

export interface ResultadoTurno {
  modelo: string;
  tokensIn: number;
  tokensOut: number;
  costoMicros: bigint;
  texto: string;
  herramientas: { nombre: string; argumentos: string }[];
}

export interface DepsConversar {
  proveedor: LLMProvider;
  herramientas: DepsHerramientas;
  /** Tarjeta del producto si existe y es visible en el país; `null` si no (el marcador se descarta). */
  tarjeta(slug: string): Promise<TarjetaChat | null>;
  precios: PreciosModelo;
  /** Se llama una vez por turno, al terminar (con o sin error del proveedor tras haber gastado). */
  registrar(r: ResultadoTurno): Promise<void>;
}

export interface EntradaTurno {
  nivel: NivelPresupuesto;
  modeloPrimario: string | null;
  modeloRespaldo: string | null;
  maxTokens: number;
  contexto: ContextoPrompt;
  /** Últimos turnos ya recortados (solo `user` y `assistant`). */
  historial: TurnoGuardado[];
  mensaje: string;
  senal?: AbortSignal;
}

export async function* conversar(deps: DepsConversar, e: EntradaTurno): AsyncGenerator<EventoChat> {
  let modelo = elegirModelo(e.nivel, e.modeloPrimario, e.modeloRespaldo);
  if (!modelo) {
    yield { tipo: 'error', codigo: 'sin_modelo' };
    return;
  }

  const mensajes: MensajeLLM[] = [{ role: 'system', content: construirPrompt(e.contexto) }, ...e.historial, { role: 'user', content: e.mensaje }];
  const filtro = new FiltroMarcadores();
  const tarjetasEnviadas = new Set<string>();
  const herramientasUsadas: ResultadoTurno['herramientas'] = [];
  let textoFinal = '';
  let tokensIn = 0;
  let tokensOut = 0;
  let costo = 0n;
  let huboSalida = false;
  let fallido = false;

  async function* emitir(salida: { texto: string; slugs: string[] }): AsyncGenerator<EventoChat> {
    if (salida.texto) {
      textoFinal += salida.texto;
      huboSalida = true;
      yield { tipo: 'texto', texto: salida.texto };
    }
    for (const slug of salida.slugs) {
      if (tarjetasEnviadas.has(slug) || tarjetasEnviadas.size >= MAX_TARJETAS_POR_RESPUESTA) continue;
      tarjetasEnviadas.add(slug);
      // Un slug que el catálogo del país no reconoce se elimina sin avisar.
      const t = await deps.tarjeta(slug);
      if (t) {
        huboSalida = true;
        yield { tipo: 'tarjeta', tarjeta: t };
      }
    }
  }

  for (let ronda = 0; ronda <= MAX_ITERACIONES_HERRAMIENTAS; ronda++) {
    const permitirHerramientas = ronda < MAX_ITERACIONES_HERRAMIENTAS;
    let llamadas: { id: string; nombre: string; argumentos: string }[] = [];
    let textoRonda = '';
    let caracteresRonda = 0;
    try {
      for await (const ev of deps.proveedor.completar({
        modelo,
        mensajes,
        herramientas: permitirHerramientas ? DEFINICIONES : [],
        maxTokens: e.maxTokens,
        ...(e.senal ? { senal: e.senal } : {}),
      })) {
        if (ev.tipo === 'texto') {
          textoRonda += ev.delta;
          caracteresRonda += ev.delta.length;
          yield* emitir(filtro.empujar(ev.delta));
        } else if (ev.tipo === 'herramientas') {
          llamadas = ev.llamadas;
        } else {
          tokensIn += ev.uso.tokensIn;
          tokensOut += ev.uso.tokensOut;
          costo += ev.uso.costoMicros ?? estimarCostoMicros(ev.uso.tokensIn, ev.uso.tokensOut, deps.precios);
        }
      }
    } catch {
      // OpenRouter solo informa el uso en el último chunk: si la llamada se corta o se aborta, el costo de lo que ya se
      // procesó se estima por caracteres (≈ 4 por token, redondeando hacia arriba) para que el presupuesto no lo pierda.
      const caracteresPrompt = JSON.stringify(mensajes).length + JSON.stringify(DEFINICIONES).length;
      const tIn = Math.ceil(caracteresPrompt / 4);
      const tOut = Math.ceil(caracteresRonda / 4);
      tokensIn += tIn;
      tokensOut += tOut;
      costo += estimarCostoMicros(tIn, tOut, deps.precios);
      // Si falló antes de decir nada y hay otro modelo, se reintenta una vez con el de respaldo.
      const alterno = e.modeloRespaldo?.trim();
      if (!huboSalida && !fallido && !e.senal?.aborted && alterno && alterno !== modelo) {
        fallido = true;
        modelo = alterno;
        ronda--;
        continue;
      }
      yield { tipo: 'error', codigo: 'proveedor' };
      await deps.registrar({ modelo, tokensIn, tokensOut, costoMicros: costo, texto: textoFinal, herramientas: herramientasUsadas });
      return;
    }

    if (llamadas.length === 0 || !permitirHerramientas) break;
    yield* emitir(filtro.cerrar());
    mensajes.push({ role: 'assistant', content: textoRonda || null, llamadas });
    for (const l of llamadas) {
      herramientasUsadas.push({ nombre: l.nombre, argumentos: l.argumentos.slice(0, 500) });
      const r = await ejecutarHerramienta(deps.herramientas, l.nombre, l.argumentos);
      mensajes.push({ role: 'tool', llamadaId: l.id, content: JSON.stringify(r.resultado).slice(0, 6000) });
    }
  }

  yield* emitir(filtro.cerrar());
  await deps.registrar({ modelo, tokensIn, tokensOut, costoMicros: costo, texto: textoFinal.trim(), herramientas: herramientasUsadas });
  yield { tipo: 'fin' };
}
