'use client';

import { useEffect, useRef, type ElementType, type ReactNode } from 'react';
import { animarEntrada } from '../movimiento';

interface Props {
  children: ReactNode;
  /** Posición dentro de un grupo, para el escalonado de 60 ms. */
  indice?: number;
  como?: ElementType;
  className?: string;
}

/**
 * Aparición al entrar en pantalla, una sola vez. Lo que ya está a la vista al montar
 * no se oculta (no afecta al LCP ni al CLS); lo que está más abajo se anima al llegar.
 */
export function Revelar({ children, indice = 0, como: Tag = 'div', className }: Props) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const { top } = el.getBoundingClientRect();
    if (top < window.innerHeight) return;
    el.style.opacity = '0';
    const obs = new IntersectionObserver(
      (entradas) => {
        if (!entradas.some((e) => e.isIntersecting)) return;
        obs.disconnect();
        void animarEntrada(el, indice);
      },
      { rootMargin: '0px 0px -8% 0px' },
    );
    obs.observe(el);
    return () => {
      obs.disconnect();
      el.style.opacity = '';
    };
  }, [indice]);

  return (
    <Tag ref={ref} className={className}>
      {children}
    </Tag>
  );
}
