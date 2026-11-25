'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { pixelActivo, rastrear } from '@/lib/store/analitica/pixel-cliente';

/** `PageView` en cada navegación del App Router. La primera vista ya la envía el guion en línea, así que se omite. */
export function NavegacionPixel({ pixelId }: { pixelId: string }) {
  const ruta = usePathname();
  const anterior = useRef<string | null>(null);
  useEffect(() => {
    const previa = anterior.current;
    anterior.current = ruta;
    if (previa === null || previa === ruta) return;
    if (pixelActivo(pixelId)) rastrear('PageView');
  }, [ruta, pixelId]);
  return null;
}
