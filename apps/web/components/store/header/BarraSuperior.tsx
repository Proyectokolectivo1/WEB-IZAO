'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Contenedor fijo del header. En móvil se oculta al bajar y reaparece al subir (§8.4) deslizándose con
 * `transform`; en escritorio permanece visible. No altera el flujo: el contenedor reserva su altura.
 */
export function BarraSuperior({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [oculto, setOculto] = useState(false);

  useEffect(() => {
    let ultimo = window.scrollY;
    let pendiente = false;
    const alScroll = () => {
      if (pendiente) return;
      pendiente = true;
      requestAnimationFrame(() => {
        pendiente = false;
        const y = window.scrollY;
        const alto = ref.current?.offsetHeight ?? 100;
        const abierto = ref.current?.contains(document.activeElement) && document.activeElement !== document.body;
        if (Math.abs(y - ultimo) > 6) {
          setOculto(y > alto && y > ultimo && !abierto);
          ultimo = y;
        }
      });
    };
    window.addEventListener('scroll', alScroll, { passive: true });
    return () => window.removeEventListener('scroll', alScroll);
  }, []);

  return (
    <div
      ref={ref}
      data-barra-superior=""
      className={`sticky top-0 z-40 bg-bg transition-transform duration-[280ms] ease-izao lg:!translate-y-0 ${
        oculto ? '-translate-y-full' : 'translate-y-0'
      }`}
    >
      {children}
    </div>
  );
}
