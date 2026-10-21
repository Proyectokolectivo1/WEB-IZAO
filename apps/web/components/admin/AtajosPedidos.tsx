'use client';

import { useEffect } from 'react';

const SELECTOR_FILA = 'a[data-fila-pedido]';

function esCampoDeTexto(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

/**
 * Atajos de teclado de la lista de pedidos (skill del panel): `/` enfoca la búsqueda, `j`/`k` bajan y suben por los
 * pedidos (el enlace enfocado se abre con Enter). No hace nada mientras se escribe en un campo ni con Ctrl/Alt/Meta.
 * No renderiza nada: la ayuda visible la pone la página.
 */
export function AtajosPedidos({ idBusqueda }: { idBusqueda: string }) {
  useEffect(() => {
    function alPulsar(e: KeyboardEvent) {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (esCampoDeTexto(e.target)) return;
      if (e.key === '/') {
        const campo = document.getElementById(idBusqueda);
        if (campo instanceof HTMLInputElement) {
          e.preventDefault();
          campo.focus();
          campo.select();
        }
        return;
      }
      if (e.key !== 'j' && e.key !== 'k') return;
      const filas = Array.from(document.querySelectorAll<HTMLAnchorElement>(SELECTOR_FILA));
      if (filas.length === 0) return;
      e.preventDefault();
      const actual = filas.findIndex((f) => f === document.activeElement);
      const siguiente = e.key === 'j' ? Math.min(actual + 1, filas.length - 1) : Math.max(actual <= 0 ? 0 : actual - 1, 0);
      filas[siguiente]?.focus();
      filas[siguiente]?.scrollIntoView({ block: 'nearest' });
    }
    document.addEventListener('keydown', alPulsar);
    return () => document.removeEventListener('keydown', alPulsar);
  }, [idBusqueda]);
  return null;
}
