'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type ComponentType } from 'react';
import { EVENTO_NAVEGANDO } from '@/lib/store/navegacion';
import { T } from '@/lib/store/textos';
import type { CodigoPais } from '@/lib/store/types';

/**
 * Esqueleto de la pantalla de destino mientras llega la navegación suave a una ficha, un listado o la búsqueda.
 *
 * Todo ocurre del lado del cliente (no hay `loading.tsx`: en rutas dinámicas hace streaming y rompe el 404 y la
 * restauración de lotes). Un clic en un enlace del país, o el aviso `izao:navegando` del buscador, arma un temporizador;
 * si la pantalla nueva tarda más de `RETRASO_MS` se dibuja el esqueleto encima (posición fija: no mueve el contenido ni
 * el scroll de la pantalla de origen) y se quita en cuanto cambia la URL. Si la navegación es instantánea no se ve nada.
 */

const RETRASO_MS = 150;
/** Si la navegación nunca termina (red caída, cancelada), el esqueleto no se queda para siempre. */
const TOPE_MS = 10_000;
const LISTADOS = new Set(['catalogo', 'buscar', 'categoria', 'coleccion', 'marca', 'familia']);

type Tipo = 'ficha' | 'listado';

function clasificar(ruta: string, pais: CodigoPais): Tipo | null {
  const [, p, seccion] = ruta.split('/');
  if (p !== pais || !seccion) return null;
  if (seccion === 'perfume') return 'ficha';
  return LISTADOS.has(seccion) ? 'listado' : null;
}

const cargarEsqueletos = () => import('./EsqueletosPagina').then((m) => m.EsqueletoPagina);

export function NavegacionPendiente({ pais }: { pais: CodigoPais }) {
  const ruta = usePathname();
  const consulta = useSearchParams().toString();
  const clave = `${ruta}?${consulta}`;
  const claveRef = useRef(clave);
  claveRef.current = clave;
  const [pendiente, setPendiente] = useState<{ tipo: Tipo; top: number } | null>(null);
  const [Esqueleto, setEsqueleto] = useState<ComponentType<{ tipo: Tipo }> | null>(null);
  const temporizadores = useRef<number[]>([]);

  const limpiar = useRef(() => {
    for (const t of temporizadores.current) window.clearTimeout(t);
    temporizadores.current = [];
    setPendiente(null);
    document.getElementById('contenido')?.removeAttribute('aria-busy');
  }).current;

  // La pantalla nueva llegó (cambió la ruta o la consulta): fuera el esqueleto.
  useEffect(() => {
    limpiar();
  }, [clave, limpiar]);

  // El código de los esqueletos se baja en reposo, después de la carga: no suma al JavaScript inicial.
  useEffect(() => {
    let vivo = true;
    const pedir = () => void cargarEsqueletos().then((c) => vivo && setEsqueleto(() => c));
    const ric = (window as { requestIdleCallback?: (f: () => void) => number }).requestIdleCallback;
    const id = ric ? ric(pedir) : window.setTimeout(pedir, 2000);
    return () => {
      vivo = false;
      if (!ric) window.clearTimeout(id);
    };
  }, []);

  useEffect(() => {
    const iniciar = (href: string) => {
      let url: URL;
      try {
        url = new URL(href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      const tipo = clasificar(url.pathname, pais);
      if (!tipo || `${url.pathname}?${url.searchParams.toString()}` === claveRef.current) return;
      limpiar();
      temporizadores.current.push(
        window.setTimeout(() => {
          // Debajo de la barra superior (fija en `z-40`), sin cubrirla.
          const barra = document.querySelector('[data-barra-superior]');
          const top = Math.max(0, Math.round(barra?.getBoundingClientRect().bottom ?? 0));
          document.getElementById('contenido')?.setAttribute('aria-busy', 'true');
          setPendiente({ tipo, top });
        }, RETRASO_MS),
        window.setTimeout(limpiar, TOPE_MS),
      );
    };
    const alClic = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
      iniciar(a.href);
    };
    const alAviso = (e: Event) => iniciar((e as CustomEvent<{ href: string }>).detail.href);
    document.addEventListener('click', alClic);
    window.addEventListener(EVENTO_NAVEGANDO, alAviso);
    return () => {
      document.removeEventListener('click', alClic);
      window.removeEventListener(EVENTO_NAVEGANDO, alAviso);
      limpiar();
    };
  }, [pais, limpiar]);

  return (
    <>
      <div role="status" className="solo-lectores">
        {pendiente ? T.cargaPantalla[pendiente.tipo] : ''}
      </div>
      {pendiente && Esqueleto ? (
        <div
          aria-hidden="true"
          data-testid="esqueleto-navegacion"
          className="pointer-events-none fixed inset-x-0 bottom-0 z-30 overflow-hidden bg-bg"
          style={{ top: pendiente.top }}
        >
          <Esqueleto tipo={pendiente.tipo} />
        </div>
      ) : null}
    </>
  );
}
