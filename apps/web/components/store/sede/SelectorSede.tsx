'use client';

import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { debeMostrarSede, EVENTO_ABRIR_SEDE, RETARDO_SEDE_MS, RETARDO_TRAS_INTERACCION_MS, recordarSede, sedeRecordada, type OpcionSede } from '@/lib/store/sede';
import { esPais } from '@/lib/store/pais';
import type { CodigoPais } from '@/lib/store/types';

// La ventana se baja solo cuando hace falta: no suma al JS inicial ni se pinta en el HTML (sin CLS, sin estorbar a los robots).
const ModalSede = dynamic(() => import('./ModalSede'), { ssr: false });

interface Props {
  pais: CodigoPais;
  opciones: OpcionSede[];
}

/**
 * Primera visita sin país elegido: tras la primera interacción (o unos segundos), abre la ventana de sede (no se puede cerrar sin elegir).
 * También se abre a mano con el evento `izao:abrir-sede` (botón de la cabecera). No sale en el pago ni en el seguimiento.
 */
export function SelectorSede({ pais, opciones }: Props) {
  const ruta = usePathname();
  const [estado, setEstado] = useState<{ abierto: boolean; cerrable: boolean; elegido: CodigoPais | null } | null>(null);

  useEffect(() => {
    const previo = sedeRecordada();
    const elegido = esPais(previo.cookiePais?.toLowerCase()) ? (previo.cookiePais!.toLowerCase() as CodigoPais) : null;
    // Si la cookie se perdió pero hay copia local, se restaura en silencio.
    if (!elegido && esPais(previo.guardado?.toLowerCase())) recordarSede(previo.guardado!.toLowerCase() as CodigoPais);
    if (!debeMostrarSede({ ruta, ...previo, agente: navigator.userAgent })) return;
    let abierta = false;
    let temporizador: number | undefined;
    const eventos = ['pointerdown', 'keydown', 'scroll'] as const;
    const quitarEscuchas = () => {
      for (const e of eventos) window.removeEventListener(e, alInteractuar, { capture: true });
    };
    const limpiar = () => {
      window.clearTimeout(temporizador);
      quitarEscuchas();
    };
    const abrir = () => {
      if (abierta) return;
      abierta = true;
      limpiar();
      setEstado({ abierto: true, cerrable: false, elegido: null });
    };
    // Tras la primera interacción deja terminar el toque (un enlace que se está abriendo) antes de mostrarla.
    function alInteractuar() {
      quitarEscuchas();
      window.clearTimeout(temporizador);
      temporizador = window.setTimeout(abrir, RETARDO_TRAS_INTERACCION_MS);
    }
    for (const e of eventos) window.addEventListener(e, alInteractuar, { capture: true, passive: true });
    // Si la persona solo mira, sale pasado un rato (después de que el LCP ya se asentó).
    temporizador = window.setTimeout(abrir, RETARDO_SEDE_MS);
    return limpiar;
  }, [ruta]);

  // Apertura manual (el país ya está elegido: se puede cerrar).
  useEffect(() => {
    const alAbrir = () => {
      const previo = sedeRecordada();
      const c = (previo.cookiePais ?? previo.guardado)?.toLowerCase();
      setEstado({ abierto: true, cerrable: true, elegido: esPais(c) ? c : pais });
    };
    window.addEventListener(EVENTO_ABRIR_SEDE, alAbrir);
    return () => window.removeEventListener(EVENTO_ABRIR_SEDE, alAbrir);
  }, [pais]);

  const cerrar = useCallback(() => setEstado((e) => (e ? { ...e, abierto: false } : e)), []);

  if (!estado) return null;
  return <ModalSede abierto={estado.abierto} onCerrar={cerrar} cerrable={estado.cerrable} paisActual={pais} paisElegido={estado.elegido} opciones={opciones} />;
}
