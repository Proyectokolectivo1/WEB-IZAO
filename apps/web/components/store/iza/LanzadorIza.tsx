'use client';

import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Icono } from '@izao/ui';
import { TI } from '@/lib/store/chat/textos';
import type { CodigoPais } from '@/lib/store/types';
import { AvatarIza } from './AvatarIza';

// El panel (streaming, tarjetas, Turnstile) no entra en el JS inicial: se descarga al abrirlo o al acercarse a él.
const cargarPanel = () => import('./PanelIza');
const PanelIza = dynamic(cargarPanel, { ssr: false });

const CLAVE_BURBUJA = 'izao:iza:burbuja';
const SEGUNDOS_BURBUJA = 20;

/** Botón flotante de Iza (§20.1) y escucha de `izao:abrir-iza` (detail `{ producto?: slug }`). Es lo único de Iza en el JS inicial. */
export function LanzadorIza({ pais }: { pais: CodigoPais }) {
  const [montado, setMontado] = useState(false);
  const [abierto, setAbierto] = useState(false);
  const [producto, setProducto] = useState<string | null>(null);
  const [burbuja, setBurbuja] = useState(false);
  const ruta = usePathname();
  const enFicha = ruta?.includes('/perfume/') ?? false;

  const abrir = useCallback((slug: string | null) => {
    setProducto(slug);
    setMontado(true);
    setAbierto(true);
    setBurbuja(false);
  }, []);

  useEffect(() => {
    const alAbrir = (e: Event) => {
      const d = (e as CustomEvent<{ producto?: string }>).detail;
      abrir(typeof d?.producto === 'string' ? d.producto : null);
    };
    window.addEventListener('izao:abrir-iza', alAbrir);
    return () => window.removeEventListener('izao:abrir-iza', alAbrir);
  }, [abrir]);

  // Burbuja de saludo en las fichas tras 20 s, una sola vez por sesión del navegador.
  useEffect(() => {
    if (!enFicha || abierto) return;
    let ya = false;
    try {
      ya = window.sessionStorage.getItem(CLAVE_BURBUJA) === '1';
    } catch {
      /* sin almacenamiento: puede repetirse al recargar */
    }
    if (ya) return;
    const t = window.setTimeout(() => {
      setBurbuja(true);
      try {
        window.sessionStorage.setItem(CLAVE_BURBUJA, '1');
      } catch {
        /* nada */
      }
    }, SEGUNDOS_BURBUJA * 1000);
    return () => window.clearTimeout(t);
  }, [enFicha, abierto, ruta]);

  // Sobre la barra fija de la ficha en móvil (§20.1).
  const posicion = enFicha ? 'bottom-24 lg:bottom-6' : 'bottom-4 lg:bottom-6';

  return (
    <>
      <div className={`fixed right-4 z-40 flex flex-col items-end gap-2 lg:right-6 ${posicion}`}>
        {burbuja ? (
          <div role="status" className="relative max-w-[16rem] rounded-card border border-line bg-bg px-4 py-3 pr-10 text-[0.9375rem] shadow-elev">
            <button
              type="button"
              onClick={() => abrir(null)}
              className="text-left underline-offset-4 hover:underline"
            >
              {TI.burbuja}
            </button>
            <button
              type="button"
              onClick={() => setBurbuja(false)}
              aria-label={TI.cerrarBurbuja}
              className="absolute right-0 top-0 grid size-11 place-items-center text-ink"
            >
              <Icono nombre="cerrar" tamano={16} />
            </button>
          </div>
        ) : null}
        <button
          type="button"
          data-testid="lanzador-iza"
          aria-haspopup="dialog"
          aria-expanded={abierto}
          aria-label={TI.lanzador}
          onClick={() => abrir(null)}
          onPointerEnter={() => void cargarPanel()}
          onFocus={() => void cargarPanel()}
          className="grid size-14 place-items-center rounded-full border border-ink bg-bg shadow-elev transition-transform hover:scale-105 motion-reduce:transition-none motion-reduce:hover:scale-100"
        >
          <AvatarIza tamano={44} />
        </button>
      </div>
      {montado ? <PanelIza pais={pais} abierto={abierto} onCerrar={() => setAbierto(false)} producto={producto} /> : null}
    </>
  );
}
