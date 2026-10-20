'use client';

/**
 * Utilidades de movimiento (§8.7). Solo `transform` y `opacity`; con `prefers-reduced-motion`
 * se anima únicamente la opacidad. Usa `motion/mini` (≈ 2,5 KB) para no inflar el JS inicial.
 */
import { animate } from 'motion/mini';
import { useEffect, useState } from 'react';

export const EASE_IZAO = [0.2, 0.7, 0.2, 1] as const;
export const DURACION_ENTRADA = 0.5;
export const DURACION_PANEL = 0.28;
export const ESCALONADO = 0.06;
export const DESPLAZAMIENTO_PX = 16;

export function prefiereMenosMovimiento(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function useMenosMovimiento(): boolean {
  const [reducido, setReducido] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducido(mq.matches);
    const alCambiar = (e: MediaQueryListEvent) => setReducido(e.matches);
    mq.addEventListener('change', alCambiar);
    return () => mq.removeEventListener('change', alCambiar);
  }, []);
  return reducido;
}

/** Aparece 0→1 con `translateY` 16→0 (solo opacidad si el usuario pidió menos movimiento). */
export function animarEntrada(el: HTMLElement, indice = 0): Promise<void> {
  const delay = Math.min(indice, 8) * ESCALONADO;
  const keyframes = prefiereMenosMovimiento()
    ? { opacity: [0, 1] }
    : { opacity: [0, 1], transform: [`translateY(${DESPLAZAMIENTO_PX}px)`, 'translateY(0px)'] };
  return animate(el, keyframes, { duration: DURACION_ENTRADA, delay, ease: [...EASE_IZAO] }).finished.then(() => {
    el.style.opacity = '';
    el.style.transform = '';
  });
}

/** Deslizamiento de drawers y hojas (280 ms). `direccion` indica de dónde viene el panel. */
export function animarPanel(
  el: HTMLElement,
  direccion: 'derecha' | 'izquierda' | 'abajo' | 'centro',
  entrando: boolean,
): Promise<void> {
  const reducido = prefiereMenosMovimiento();
  const fuera =
    direccion === 'derecha'
      ? 'translateX(100%)'
      : direccion === 'izquierda'
        ? 'translateX(-100%)'
        : direccion === 'abajo'
          ? 'translateY(100%)'
          : 'translateY(12px)';
  const dentro = 'translate(0px, 0px)';
  const keyframes = reducido
    ? { opacity: entrando ? [0, 1] : [1, 0] }
    : direccion === 'centro'
      ? { opacity: entrando ? [0, 1] : [1, 0], transform: entrando ? [fuera, dentro] : [dentro, fuera] }
      : { transform: entrando ? [fuera, dentro] : [dentro, fuera] };
  return animate(el, keyframes, { duration: DURACION_PANEL, ease: [...EASE_IZAO] }).finished.then(() => undefined);
}

export function animarVelo(el: HTMLElement, entrando: boolean): Promise<void> {
  return animate(el, { opacity: entrando ? [0, 1] : [1, 0] }, { duration: DURACION_PANEL }).finished.then(
    () => undefined,
  );
}
