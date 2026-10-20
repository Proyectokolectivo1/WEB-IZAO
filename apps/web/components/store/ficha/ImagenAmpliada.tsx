'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Icono, IzaoImage, Sheet } from '@izao/ui';
import { T } from '@/lib/store/textos';
import type { MediaRef } from '@/lib/store/types';

interface Props {
  abierto: boolean;
  onCerrar: () => void;
  imagenes: MediaRef[];
  indice: number;
  onIndice: (n: number) => void;
  nombre: string;
}

interface Vista {
  s: number;
  x: number;
  y: number;
}

const MIN = 1;
const MAX = 4;
const PASO = 0.5;

/**
 * Pantalla completa de la galería. Pellizco con dos dedos, arrastre para mover, rueda del mouse y doble toque;
 * además botones (+, −, original) para quien no puede hacer gestos (WCAG 2.5.1). Solo `transform`.
 */
export function ImagenAmpliada({ abierto, onCerrar, imagenes, indice, onIndice, nombre }: Props) {
  const [vista, setVista] = useState<Vista>({ s: 1, x: 0, y: 0 });
  const marco = useRef<HTMLDivElement>(null);
  const punteros = useRef(new Map<number, { x: number; y: number }>());
  const gesto = useRef<{ dist: number; s: number } | null>(null);
  const ultimoToque = useRef(0);
  const total = imagenes.length;
  const actual = imagenes[indice] ?? null;

  const limitar = useCallback((v: Vista): Vista => {
    const r = marco.current?.getBoundingClientRect();
    const s = Math.min(MAX, Math.max(MIN, v.s));
    if (!r || s === 1) return { s, x: 0, y: 0 };
    const mx = (r.width * (s - 1)) / 2;
    const my = (r.height * (s - 1)) / 2;
    return { s, x: Math.min(mx, Math.max(-mx, v.x)), y: Math.min(my, Math.max(-my, v.y)) };
  }, []);

  const cambiarZoom = useCallback((delta: number) => setVista((v) => limitar({ ...v, s: v.s + delta })), [limitar]);

  // Al cambiar de imagen o cerrar, vuelve al tamaño original.
  useEffect(() => setVista({ s: 1, x: 0, y: 0 }), [indice, abierto]);

  // La rueda necesita listener no pasivo para poder evitar el scroll de la página.
  useEffect(() => {
    const el = marco.current;
    if (!el || !abierto) return;
    const alRueda = (e: WheelEvent) => {
      e.preventDefault();
      cambiarZoom(e.deltaY < 0 ? PASO / 2 : -PASO / 2);
    };
    el.addEventListener('wheel', alRueda, { passive: false });
    return () => el.removeEventListener('wheel', alRueda);
  });

  const distancia = () => {
    const [a, b] = [...punteros.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };

  function alBajar(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    punteros.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (punteros.current.size === 2) gesto.current = { dist: distancia(), s: vista.s };
    if (punteros.current.size === 1 && e.pointerType === 'touch') {
      const ahora = Date.now();
      if (ahora - ultimoToque.current < 300) setVista((v) => (v.s > 1 ? { s: 1, x: 0, y: 0 } : limitar({ ...v, s: 2.5 })));
      ultimoToque.current = ahora;
    }
  }

  function alMover(e: React.PointerEvent<HTMLDivElement>) {
    const previo = punteros.current.get(e.pointerId);
    if (!previo) return;
    const nuevo = { x: e.clientX, y: e.clientY };
    punteros.current.set(e.pointerId, nuevo);
    if (punteros.current.size === 2 && gesto.current && gesto.current.dist > 0) {
      const factor = distancia() / gesto.current.dist;
      setVista((v) => limitar({ ...v, s: gesto.current!.s * factor }));
    } else if (punteros.current.size === 1) {
      setVista((v) => (v.s > 1 ? limitar({ ...v, x: v.x + nuevo.x - previo.x, y: v.y + nuevo.y - previo.y }) : v));
    }
  }

  function alSoltar(e: React.PointerEvent<HTMLDivElement>) {
    punteros.current.delete(e.pointerId);
    if (punteros.current.size < 2) gesto.current = null;
  }

  const boton = 'inline-flex size-11 items-center justify-center rounded-md border border-line hover:bg-surface disabled:opacity-40';

  return (
    <Sheet
      abierto={abierto}
      onCerrar={onCerrar}
      titulo={nombre}
      etiquetaCerrar={T.ficha.cerrarImagen}
      lado="abajo"
      className="inset-0! h-dvh max-h-none! rounded-none!"
      testId="imagen-ampliada"
      pie={
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button type="button" className={boton} onClick={() => cambiarZoom(-PASO)} disabled={vista.s <= MIN} aria-label={T.ficha.alejar}>
              <Icono nombre="menos" />
            </button>
            <button type="button" className={boton} onClick={() => cambiarZoom(PASO)} disabled={vista.s >= MAX} aria-label={T.ficha.acercar}>
              <Icono nombre="mas" />
            </button>
            <button type="button" className={`${boton} px-3 text-[0.8125rem]`} onClick={() => setVista({ s: 1, x: 0, y: 0 })} disabled={vista.s === 1}>
              {T.ficha.restablecer}
            </button>
          </div>
          {total > 1 ? (
            <div className="flex items-center gap-2">
              <button type="button" className={boton} onClick={() => onIndice(indice - 1)} aria-label={T.ficha.anterior}>
                <Icono nombre="chevronIzquierda" />
              </button>
              <p className="min-w-12 text-center text-[0.875rem] tabular-nums" aria-live="polite">
                {indice + 1} / {total}
              </p>
              <button type="button" className={boton} onClick={() => onIndice(indice + 1)} aria-label={T.ficha.siguiente}>
                <Icono nombre="chevronDerecha" />
              </button>
            </div>
          ) : null}
        </div>
      }
    >
      <div
        ref={marco}
        data-testid="marco-zoom"
        role="group"
        aria-label={T.ficha.imagenAmpliada(nombre)}
        className="relative h-full min-h-[50dvh] touch-none select-none overflow-hidden bg-surface"
        onPointerDown={alBajar}
        onPointerMove={alMover}
        onPointerUp={alSoltar}
        onPointerCancel={alSoltar}
        style={{ cursor: vista.s > 1 ? 'grab' : 'zoom-in' }}
      >
        <div
          className="flex h-full w-full items-center justify-center will-change-transform"
          style={{ transform: `translate3d(${vista.x}px, ${vista.y}px, 0) scale(${vista.s})` }}
        >
          <IzaoImage media={actual} alt={actual?.alt ?? nombre} sizes="2400px" className="h-full object-contain" style={{ backgroundImage: 'none' }} draggable={false} />
        </div>
        <p className="solo-lectores">{T.ficha.gestoZoom}</p>
      </div>
    </Sheet>
  );
}
