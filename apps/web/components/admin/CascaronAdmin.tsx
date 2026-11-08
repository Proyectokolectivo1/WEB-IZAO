'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { NavegacionAdmin, type ItemNavegacion } from './NavegacionAdmin';

export const ID_MENU_ADMIN = 'adm-menu';

/** Ancho desde el que el menú lateral queda fijo (64 rem = 1024 px). Debe coincidir con `admin.css`. */
const CONSULTA_ESCRITORIO = '(min-width: 64rem)';

const FOCALIZABLES = 'a[href], button:not([disabled])';

/**
 * Estructura del panel autenticado: menú lateral, barra superior y contenido.
 * Desde 1024 px el menú es una columna fija; por debajo (celular y tablet vertical) es una hoja que se abre con el
 * botón de la barra: foco dentro mientras está abierta, `Esc`, toque en el velo o elegir un módulo la cierran y el
 * foco vuelve al botón. Sin JavaScript el HTML sale igual (menú cerrado en pantallas pequeñas).
 * `cerrarSesion` llega ya armado desde el servidor para que este componente no conozca las Server Actions.
 */
export function CascaronAdmin({
  items,
  nombre,
  rol,
  cerrarSesion,
  children,
}: {
  items: ItemNavegacion[];
  nombre: string;
  rol: string;
  cerrarSesion: ReactNode;
  children: ReactNode;
}) {
  const [abierto, setAbierto] = useState(false);
  const ruta = usePathname();
  const boton = useRef<HTMLButtonElement>(null);
  const lateral = useRef<HTMLElement>(null);

  const devolverFoco = useRef(false);

  const cerrar = useCallback((conFoco: boolean) => {
    devolverFoco.current = conFoco;
    setAbierto(false);
  }, []);

  // El foco vuelve al botón cuando la página de atrás ya dejó de estar inerte (no antes: `inert` impide enfocar).
  useEffect(() => {
    if (!abierto && devolverFoco.current) {
      devolverFoco.current = false;
      boton.current?.focus();
    }
  }, [abierto]);

  // Elegir un módulo (cambia la ruta) cierra la hoja.
  useEffect(() => {
    setAbierto(false);
  }, [ruta]);

  // Abierta: foco al primer enlace, `Esc` cierra, el fondo no se desplaza y, si la ventana crece, se cierra sola.
  useEffect(() => {
    if (!abierto) return;
    lateral.current?.querySelector<HTMLElement>(FOCALIZABLES)?.focus();
    const alTeclear = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') cerrar(true);
    };
    const consulta = window.matchMedia(CONSULTA_ESCRITORIO);
    const alCambiar = () => {
      if (consulta.matches) setAbierto(false);
    };
    document.addEventListener('keydown', alTeclear);
    consulta.addEventListener('change', alCambiar);
    const antes = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', alTeclear);
      consulta.removeEventListener('change', alCambiar);
      document.documentElement.style.overflow = antes;
    };
  }, [abierto, cerrar]);

  // Tab no sale de la hoja mientras está abierta.
  function atraparTab(e: KeyboardEvent<HTMLElement>) {
    if (!abierto || e.key !== 'Tab') return;
    const lista = Array.from(lateral.current?.querySelectorAll<HTMLElement>(FOCALIZABLES) ?? []);
    const primero = lista[0];
    const ultimo = lista[lista.length - 1];
    if (!primero || !ultimo) return;
    if (e.shiftKey && document.activeElement === primero) {
      e.preventDefault();
      ultimo.focus();
    } else if (!e.shiftKey && document.activeElement === ultimo) {
      e.preventDefault();
      primero.focus();
    }
  }

  return (
    <div className="adm-panel" data-menu={abierto ? 'abierto' : 'cerrado'}>
      <a href="#contenido" className="adm-saltar">
        Saltar al contenido
      </a>
      <aside id={ID_MENU_ADMIN} className="adm-lateral" ref={lateral} onKeyDown={atraparTab}>
        <div className="adm-lateral-cabecera">
          <p className="adm-marca">Izao Perfumería</p>
          <button type="button" className="adm-menu-cerrar" onClick={() => cerrar(true)}>
            <span className="adm-visualmente-oculto">Cerrar menú</span>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true" focusable="false">
              <path d="M5 5l14 14M19 5L5 19" />
            </svg>
          </button>
        </div>
        <div className="adm-usuario adm-usuario-menu">
          <strong>{nombre}</strong>
          <small>{rol}</small>
        </div>
        <NavegacionAdmin items={items} />
      </aside>
      <div className="adm-fondo" onClick={() => cerrar(true)} aria-hidden="true" />
      <div className="adm-principal" inert={abierto || undefined}>
        <header className="adm-barra">
          <button
            type="button"
            ref={boton}
            className="adm-menu-boton"
            aria-expanded={abierto}
            aria-controls={ID_MENU_ADMIN}
            onClick={() => setAbierto((v) => !v)}
          >
            <span className="adm-visualmente-oculto">Menú</span>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true" focusable="false">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>
          <p className="adm-marca adm-marca-barra">Izao Perfumería</p>
          <div className="adm-usuario adm-usuario-barra">
            <strong>{nombre}</strong>
            <small>{rol}</small>
          </div>
          {cerrarSesion}
        </header>
        <main id="contenido" className="adm-contenido">
          {children}
        </main>
      </div>
    </div>
  );
}
