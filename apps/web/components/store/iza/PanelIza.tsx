'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icono, Sheet, clasesBoton } from '@izao/ui';
import type { TarjetaChat } from '@/lib/store/chat/conversar';
import { leerSSE } from '@/lib/store/chat/sse';
import { TI } from '@/lib/store/chat/textos';
import { enlaceWhatsapp } from '@/lib/store/contacto';
import type { CodigoPais } from '@/lib/store/types';
import { useCarrito } from '../carrito/CarritoProvider';
import { CLASE_CONTROL } from '../checkout/Campo';
import { useTurnstile } from '../useTurnstile';
import { AvatarIza } from './AvatarIza';
import { TarjetaIza } from './TarjetaIza';

interface Mensaje {
  id: number;
  rol: 'iza' | 'persona';
  texto: string;
  tarjetas: TarjetaChat[];
  /** Enlace de WhatsApp que Iza ofrece en este mensaje (regla 7). */
  asesor?: string;
}

interface Estado {
  estado: 'activo' | 'agotado' | 'desactivado';
  bienvenida: string;
  whatsappNumero: string | null;
  maxEntrada: number;
  turnstileKey: string | null;
}

const CLAVE_VISITANTE = 'izao:iza:visitante';
const claveSesion = (pais: string) => `izao:iza:sesion:${pais}`;

function leerAlmacen(tipo: 'local' | 'session', clave: string): string | null {
  try {
    return (tipo === 'local' ? window.localStorage : window.sessionStorage).getItem(clave);
  } catch {
    return null;
  }
}
function escribirAlmacen(tipo: 'local' | 'session', clave: string, valor: string): void {
  try {
    (tipo === 'local' ? window.localStorage : window.sessionStorage).setItem(clave, valor);
  } catch {
    /* sin almacenamiento: la conversación vive solo en memoria */
  }
}

function idVisitante(): string {
  const guardado = leerAlmacen('local', CLAVE_VISITANTE);
  if (guardado && /^[A-Za-z0-9_-]{8,64}$/.test(guardado)) return guardado;
  const nuevo = (crypto.randomUUID?.() ?? `${Date.now()}${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
  escribirAlmacen('local', CLAVE_VISITANTE, nuevo);
  return nuevo;
}

interface Props {
  pais: CodigoPais;
  abierto: boolean;
  onCerrar: () => void;
  /** Slug del producto que la persona estaba viendo al abrir el chat. */
  producto: string | null;
}

/** Panel del chat de Iza (§20.1): streaming, tarjetas de producto, sugerencias y «Hablar con un asesor» siempre a la mano. */
export default function PanelIza({ pais, abierto, onCerrar, producto }: Props) {
  const { lineas } = useCarrito();
  const [estado, setEstado] = useState<Estado | null>(null);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [limiteAlcanzado, setLimiteAlcanzado] = useState(false);
  const sesion = useRef<string | null>(null);
  const contador = useRef(0);
  const fin = useRef<HTMLDivElement>(null);
  const entrada = useRef<HTMLTextAreaElement>(null);
  const { contenedor, token, reiniciar } = useTurnstile(estado?.estado === 'activo' ? estado.turnstileKey : null, abierto);

  // Estado, bienvenida y clave pública de Turnstile al montarse (la primera vez que se abre).
  useEffect(() => {
    sesion.current = leerAlmacen('session', claveSesion(pais));
    const ctl = new AbortController();
    fetch(`/api/chat/estado?country=${pais}`, { signal: ctl.signal })
      .then((r) => r.json() as Promise<Partial<Estado>>)
      .then((d) => {
        const e: Estado = {
          estado: d.estado === 'agotado' || d.estado === 'activo' ? d.estado : 'desactivado',
          bienvenida: d.bienvenida ?? TI.bienvenidaDefecto,
          whatsappNumero: d.whatsappNumero ?? null,
          maxEntrada: d.maxEntrada ?? 500,
          turnstileKey: d.turnstileKey ?? null,
        };
        setEstado(e);
        setMensajes([{ id: ++contador.current, rol: 'iza', texto: e.bienvenida, tarjetas: [] }]);
      })
      .catch(() => {
        if (!ctl.signal.aborted) {
          setEstado({ estado: 'desactivado', bienvenida: TI.bienvenidaDefecto, whatsappNumero: null, maxEntrada: 500, turnstileKey: null });
        }
      });
    return () => ctl.abort();
  }, [pais]);

  useEffect(() => {
    fin.current?.scrollIntoView({ block: 'end' });
  }, [mensajes]);

  useEffect(() => {
    if (abierto) requestAnimationFrame(() => entrada.current?.focus());
  }, [abierto, estado]);

  const ultimaPregunta = useMemo(() => [...mensajes].reverse().find((m) => m.rol === 'persona')?.texto ?? '', [mensajes]);
  const enlaceAsesor = enlaceWhatsapp(estado?.whatsappNumero ?? null, TI.mensajeAsesor(ultimaPregunta.slice(0, 160)));
  const descansando = estado !== null && estado.estado !== 'activo';
  const bloqueado = descansando || limiteAlcanzado;

  const enviar = useCallback(
    async (crudo: string) => {
      const mensaje = crudo.trim();
      if (!mensaje || enviando || !estado || bloqueado) return;
      setAviso(null);
      setTexto('');
      setEnviando(true);
      const idPersona = ++contador.current;
      const idRespuesta = ++contador.current;
      setMensajes((m) => [
        ...m,
        { id: idPersona, rol: 'persona', texto: mensaje, tarjetas: [] },
        { id: idRespuesta, rol: 'iza', texto: '', tarjetas: [] },
      ]);
      const parchar = (f: (m: Mensaje) => Mensaje) => setMensajes((ms) => ms.map((m) => (m.id === idRespuesta ? f(m) : m)));
      const quitarRespuestaVacia = () => setMensajes((ms) => ms.filter((m) => !(m.id === idRespuesta && !m.texto && m.tarjetas.length === 0)));

      try {
        const r = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            country: pais,
            visitor_id: idVisitante(),
            session_id: sesion.current,
            message: mensaje,
            page: producto ? { producto } : null,
            cart: lineas.slice(0, 10).map((l) => ({ nombre: l.nombre, cantidad: l.cantidad })),
            turnstile: sesion.current ? null : token.current,
          }),
        });
        if (!r.ok || !r.headers.get('content-type')?.includes('text/event-stream')) {
          quitarRespuestaVacia();
          const d = (await r.json().catch(() => ({}))) as { estado?: string };
          if (d.estado === 'agotado' || d.estado === 'desactivado') setEstado((e) => (e ? { ...e, estado: d.estado as Estado['estado'] } : e));
          else if (d.estado === 'sesion_llena') setLimiteAlcanzado(true);
          setAviso(
            d.estado === 'limite' ? TI.estados.limite
            : d.estado === 'sesion_llena' ? TI.estados.sesionLlena
            : d.estado === 'entrada_larga' ? TI.estados.entradaLarga(estado.maxEntrada)
            : d.estado === 'bot' ? TI.estados.bot
            : d.estado === 'agotado' ? TI.estados.agotado
            : d.estado === 'desactivado' ? TI.estados.desactivado
            : TI.estados.error,
          );
          return;
        }
        const lector = r.body?.getReader();
        if (!lector) throw new Error('sin cuerpo');
        const dec = new TextDecoder();
        let pendiente = '';
        let huboError = false;
        for (;;) {
          const { done, value } = await lector.read();
          if (done) break;
          const { eventos, resto } = leerSSE(pendiente + dec.decode(value, { stream: true }));
          pendiente = resto;
          for (const ev of eventos) {
            if (ev.evento === 'sesion') {
              sesion.current = ev.datos.id;
              escribirAlmacen('session', claveSesion(pais), ev.datos.id);
            } else if (ev.evento === 'texto') parchar((m) => ({ ...m, texto: m.texto + ev.datos.t }));
            else if (ev.evento === 'asesor') parchar((m) => ({ ...m, asesor: ev.datos.enlace }));
            else if (ev.evento === 'tarjeta') parchar((m) => ({ ...m, tarjetas: [...m.tarjetas, ev.datos] }));
            else if (ev.evento === 'fin' && ev.datos.restantes <= 0) setLimiteAlcanzado(true);
            else if (ev.evento === 'error') huboError = true;
          }
        }
        if (huboError) {
          setAviso(TI.estados.error);
          quitarRespuestaVacia();
        }
      } catch {
        setAviso(TI.estados.red);
        quitarRespuestaVacia();
      } finally {
        reiniciar();
        setEnviando(false);
        requestAnimationFrame(() => entrada.current?.focus());
      }
    },
    [bloqueado, enviando, estado, lineas, pais, producto, reiniciar, token],
  );

  const sugerencias = producto ? [TI.preguntaProducto, ...TI.sugerencias] : TI.sugerencias;
  const sinPreguntas = !mensajes.some((m) => m.rol === 'persona');

  return (
    <Sheet
      abierto={abierto}
      onCerrar={onCerrar}
      titulo={TI.panelTitulo}
      etiquetaCerrar={TI.cerrar}
      lado="derecha"
      testId="panel-iza"
      pie={
        <div className="flex flex-col gap-3">
          {aviso ? (
            <p role="alert" className="text-[0.9375rem] text-danger">
              {aviso}
            </p>
          ) : null}
          {!bloqueado ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void enviar(texto);
              }}
              className="flex items-end gap-2"
            >
              <div className="min-w-0 flex-1">
                <label htmlFor="iza-mensaje" className="solo-lectores">
                  {TI.escribe}
                </label>
                <textarea
                  id="iza-mensaje"
                  ref={entrada}
                  value={texto}
                  rows={1}
                  maxLength={estado?.maxEntrada ?? 500}
                  placeholder={TI.escribe}
                  onChange={(e) => setTexto(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void enviar(texto);
                    }
                  }}
                  disabled={!estado}
                  className={`${CLASE_CONTROL} max-h-32 resize-none py-3`}
                />
                {texto.length > (estado?.maxEntrada ?? 500) * 0.8 ? (
                  <p className="pt-1 text-right text-[0.8125rem] text-ink/70" aria-hidden="true">
                    {TI.contador(texto.length, estado?.maxEntrada ?? 500)}
                  </p>
                ) : null}
              </div>
              <button type="submit" disabled={enviando || !texto.trim() || !estado} aria-label={TI.enviar} className={clasesBoton({ tamano: 'md', className: 'shrink-0' })}>
                <Icono nombre="flechaArriba" tamano={20} />
              </button>
            </form>
          ) : null}
          {estado?.turnstileKey && !descansando ? <div ref={contenedor} /> : null}
          {enlaceAsesor ? (
            <a href={enlaceAsesor} target="_blank" rel="noopener" data-testid="asesor-iza" className={clasesBoton({ variante: bloqueado ? 'primario' : 'secundario', bloque: true })}>
              <Icono nombre="chat" tamano={20} />
              {TI.asesor}
              <span className="solo-lectores"> {TI.asesorNota}</span>
            </a>
          ) : null}
        </div>
      }
    >
      {!estado ? (
        <p role="status" className="px-5 py-6 text-[0.9375rem]">
          {TI.cargando}
        </p>
      ) : (
        <div className="flex flex-col gap-4 px-5 py-4">
          {descansando ? (
            <p role="status" className="border border-line bg-surface px-4 py-3 text-[0.9375rem]">
              {estado.estado === 'agotado' ? TI.estados.agotado : TI.estados.desactivado}
            </p>
          ) : null}
          <div role="log" aria-live="polite" aria-relevant="additions text" aria-busy={enviando} aria-label={TI.panelTitulo} className="flex flex-col gap-4">
            {mensajes.map((m) => (
              <div key={m.id} className={m.rol === 'persona' ? 'flex justify-end' : 'flex items-start gap-2'}>
                {m.rol === 'iza' ? <AvatarIza tamano={32} /> : null}
                <div className={m.rol === 'persona' ? 'max-w-[85%] bg-ink px-4 py-2.5 text-bg' : 'min-w-0 max-w-[90%]'}>
                  <p className="solo-lectores">{m.rol === 'persona' ? TI.tuMensaje : TI.izaDice}: </p>
                  {m.texto ? (
                    <p className="whitespace-pre-line text-[1rem] leading-relaxed">{m.texto}</p>
                  ) : m.rol === 'iza' && enviando ? (
                    <p className="text-[0.9375rem] text-ink/70">{TI.pensando}</p>
                  ) : null}
                  {m.asesor ? (
                    <a href={m.asesor} target="_blank" rel="noopener" className={`${clasesBoton({ variante: 'secundario', tamano: 'sm' })} mt-2`}>
                      <Icono nombre="chat" tamano={18} />
                      {TI.asesor}
                      <span className="solo-lectores"> {TI.asesorNota}</span>
                    </a>
                  ) : null}
                  {m.tarjetas.length > 0 ? (
                    <ul className="flex flex-col gap-2 pt-2">
                      {m.tarjetas.map((t) => (
                        <TarjetaIza key={t.slug} tarjeta={t} pais={pais} onNavegar={onCerrar} />
                      ))}
                    </ul>
                  ) : null}
                </div>
              </div>
            ))}
            <div ref={fin} />
          </div>
          {sinPreguntas && !bloqueado ? (
            <div role="group" aria-label={TI.sugerenciasEtiqueta} className="flex flex-wrap gap-2">
              {sugerencias.map((s) => (
                <button key={s} type="button" disabled={enviando} onClick={() => void enviar(s)} className="min-h-11 border border-ink px-3 text-[0.9375rem] hover:bg-surface">
                  {s}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </Sheet>
  );
}
