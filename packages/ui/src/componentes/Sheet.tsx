'use client';

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { animarPanel, animarVelo } from '../movimiento';
import { Icono } from '../iconos/Icono';

/**
 * - `derecha` / `izquierda`: drawer lateral (carrito, menú).
 * - `abajo`: hoja inferior (filtros en móvil).
 * - `responsivo`: hoja inferior en móvil y modal centrado desde 768 px (vista rápida).
 */
export type LadoSheet = 'derecha' | 'izquierda' | 'abajo' | 'responsivo';

interface Props {
  abierto: boolean;
  onCerrar: () => void;
  /** Nombre accesible del diálogo (se ve como título si `mostrarTitulo`). */
  titulo: string;
  mostrarTitulo?: boolean;
  etiquetaCerrar?: string;
  lado?: LadoSheet;
  children: ReactNode;
  /** Pie fijo (p. ej. subtotal y botón del carrito). */
  pie?: ReactNode;
  className?: string;
}

const FOCOS =
  'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function enfocables(raiz: HTMLElement): HTMLElement[] {
  return [...raiz.querySelectorAll<HTMLElement>(FOCOS)].filter((el) => el.offsetParent !== null || el === document.activeElement);
}

const POSICION: Record<LadoSheet, string> = {
  derecha: 'inset-y-0 right-0 w-[min(100vw,26rem)]',
  izquierda: 'inset-y-0 left-0 w-[min(100vw,24rem)]',
  abajo: 'inset-x-0 bottom-0 max-h-[88dvh] rounded-t-lg',
  responsivo:
    'inset-x-0 bottom-0 max-h-[92dvh] rounded-t-lg md:inset-auto md:left-1/2 md:top-1/2 md:w-[min(92vw,62rem)] md:max-h-[90dvh] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-lg',
};

/** Diálogo modal accesible: portal, foco atrapado, `Esc`, bloqueo de scroll y retorno del foco. */
export function Sheet({
  abierto,
  onCerrar,
  titulo,
  mostrarTitulo = true,
  etiquetaCerrar = 'Cerrar',
  lado = 'derecha',
  children,
  pie,
  className = '',
}: Props) {
  const [montado, setMontado] = useState(abierto);
  const panel = useRef<HTMLDivElement>(null);
  const velo = useRef<HTMLDivElement>(null);
  const previo = useRef<HTMLElement | null>(null);
  const idTitulo = useId();
  const cerrando = useRef(false);

  const direccion = useCallback((): 'derecha' | 'izquierda' | 'abajo' | 'centro' => {
    if (lado !== 'responsivo') return lado;
    return window.matchMedia('(min-width: 768px)').matches ? 'centro' : 'abajo';
  }, [lado]);

  // Monta al abrir; al cerrar anima la salida y desmonta.
  useEffect(() => {
    if (abierto) {
      cerrando.current = false;
      setMontado(true);
      return;
    }
    if (!montado || cerrando.current) return;
    cerrando.current = true;
    const p = panel.current;
    const v = velo.current;
    const salida = Promise.all([p ? animarPanel(p, direccion(), false) : null, v ? animarVelo(v, false) : null]);
    void salida.finally(() => {
      setMontado(false);
      cerrando.current = false;
    });
  }, [abierto, montado, direccion]);

  // Entrada, foco inicial, bloqueo de scroll y retorno del foco.
  useEffect(() => {
    if (!abierto || !montado) return;
    previo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const p = panel.current;
    if (!p) return;
    void animarPanel(p, direccion(), true);
    if (velo.current) void animarVelo(velo.current, true);
    const anchoBarra = window.innerWidth - document.documentElement.clientWidth;
    const { overflow, paddingRight } = document.body.style;
    document.body.style.overflow = 'hidden';
    if (anchoBarra > 0) document.body.style.paddingRight = `${anchoBarra}px`;
    const frame = requestAnimationFrame(() => {
      const [primero] = enfocables(p);
      (primero ?? p).focus();
    });
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = overflow;
      document.body.style.paddingRight = paddingRight;
      previo.current?.focus?.();
    };
  }, [abierto, montado, direccion]);

  const alTeclear = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onCerrar();
      return;
    }
    if (e.key !== 'Tab' || !panel.current) return;
    const lista = enfocables(panel.current);
    if (lista.length === 0) {
      e.preventDefault();
      return;
    }
    const primero = lista[0]!;
    const ultimo = lista[lista.length - 1]!;
    if (e.shiftKey && (document.activeElement === primero || document.activeElement === panel.current)) {
      e.preventDefault();
      ultimo.focus();
    } else if (!e.shiftKey && document.activeElement === ultimo) {
      e.preventDefault();
      primero.focus();
    }
  };

  if (!montado || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-50" onKeyDown={alTeclear}>
      <div ref={velo} className="absolute inset-0 bg-ink/45" onClick={onCerrar} aria-hidden="true" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        tabIndex={-1}
        className={`absolute flex flex-col bg-bg text-ink shadow-elev outline-none ${POSICION[lado]} ${className}`}
      >
        <div className="flex items-center justify-between border-b border-line px-5">
          <h2 id={idTitulo} className={mostrarTitulo ? 'py-4 text-2xl' : 'solo-lectores'}>
            {titulo}
          </h2>
          <button
            type="button"
            onClick={onCerrar}
            aria-label={etiquetaCerrar}
            className="-mr-3 inline-flex size-11 items-center justify-center rounded-md hover:bg-surface"
          >
            <Icono nombre="cerrar" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
        {pie ? <div className="border-t border-line bg-bg px-5 py-4">{pie}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
