'use client';

import dynamic from 'next/dynamic';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  agregarLinea,
  cambiarCantidad,
  claveCarrito,
  contarUnidades,
  leer,
  quitarLinea,
  serializar,
  type LineaCarrito,
} from '@/lib/store/carrito/logica';
import { T } from '@/lib/store/textos';
import type { CodigoPais } from '@/lib/store/types';

// El drawer se descarga solo cuando alguien abre el bolso: no pesa en el JS inicial.
const CarritoDrawer = dynamic(() => import('./CarritoDrawer').then((m) => m.CarritoDrawer), { ssr: false });

type NuevaLinea = Omit<LineaCarrito, 'cantidad'> & { cantidad?: number };

interface Contexto {
  pais: CodigoPais;
  /** Nota de envío del bolso y del resumen: sale del espacio `nota_envio` del panel (por defecto, el texto del seed). */
  notaEnvio: string;
  lineas: LineaCarrito[];
  unidades: number;
  /** Se vuelve `true` cuando ya se leyó `localStorage` (evita mostrar un bolso vacío por un instante). */
  listo: boolean;
  abierto: boolean;
  abrir: () => void;
  cerrar: () => void;
  agregar: (l: NuevaLinea, opciones?: { abrirBolso?: boolean }) => void;
  cambiar: (variantId: string, cantidad: number) => void;
  quitar: (variantId: string) => void;
  /** Sube cada vez que se agrega algo; el ícono del carrito lo usa para rebotar. */
  pulso: number;
  deseos: ReadonlySet<string>;
  alternarDeseo: (productId: string) => void;
  /** Reemplaza líneas con lo que devolvió el servidor (precio o existencias distintas). */
  reemplazar: (lineas: LineaCarrito[]) => void;
}

const Ctx = createContext<Contexto | null>(null);

export function useCarrito(): Contexto {
  const c = useContext(Ctx);
  if (!c) throw new Error('useCarrito debe usarse dentro de <CarritoProvider>.');
  return c;
}

function leerAlmacen(clave: string): string | null {
  try {
    return window.localStorage.getItem(clave);
  } catch {
    return null;
  }
}

function escribirAlmacen(clave: string, valor: string): void {
  try {
    window.localStorage.setItem(clave, valor);
  } catch {
    /* modo privado o almacenamiento lleno: el bolso sigue funcionando en memoria */
  }
}

export function CarritoProvider({ pais, notaEnvio = T.carrito.notaEnvio, children }: { pais: CodigoPais; notaEnvio?: string; children: ReactNode }) {
  const [lineas, setLineas] = useState<LineaCarrito[]>([]);
  const [listo, setListo] = useState(false);
  const [abierto, setAbierto] = useState(false);
  const [drawerCargado, setDrawerCargado] = useState(false);
  const [pulso, setPulso] = useState(0);
  const [aviso, setAviso] = useState('');
  const [deseos, setDeseos] = useState<ReadonlySet<string>>(new Set());
  const clave = claveCarrito(pais);
  const claveDeseos = `izao:deseos:${pais}`;
  const omitirEscritura = useRef(true);

  // Lectura inicial y sincronía entre pestañas.
  useEffect(() => {
    setLineas(leer(leerAlmacen(clave)));
    try {
      const d: unknown = JSON.parse(leerAlmacen(claveDeseos) ?? '[]');
      setDeseos(new Set(Array.isArray(d) ? d.filter((x): x is string => typeof x === 'string').slice(0, 500) : []));
    } catch {
      setDeseos(new Set());
    }
    setListo(true);
    const alCambiar = (e: StorageEvent) => {
      if (e.key === clave) setLineas(leer(e.newValue));
    };
    window.addEventListener('storage', alCambiar);
    return () => window.removeEventListener('storage', alCambiar);
  }, [clave, claveDeseos]);

  useEffect(() => {
    if (!listo) return;
    if (omitirEscritura.current) {
      omitirEscritura.current = false;
      return;
    }
    escribirAlmacen(clave, serializar(lineas));
  }, [lineas, listo, clave]);

  const abrir = useCallback(() => {
    setDrawerCargado(true);
    setAbierto(true);
  }, []);
  const cerrar = useCallback(() => setAbierto(false), []);

  const agregar = useCallback<Contexto['agregar']>(
    (l, opciones) => {
      setLineas((prev) => agregarLinea(prev, { ...l, cantidad: l.cantidad ?? 1 }));
      setPulso((n) => n + 1);
      setAviso(T.carrito.agregado);
      if (opciones?.abrirBolso) abrir();
    },
    [abrir],
  );
  const cambiar = useCallback((id: string, c: number) => setLineas((p) => cambiarCantidad(p, id, c)), []);
  const quitar = useCallback((id: string) => {
    setLineas((p) => quitarLinea(p, id));
    setAviso(T.carrito.quitado);
  }, []);
  const reemplazar = useCallback((nuevas: LineaCarrito[]) => setLineas(nuevas), []);

  const alternarDeseo = useCallback(
    (id: string) => {
      setDeseos((prev) => {
        const sig = new Set(prev);
        if (!sig.delete(id)) sig.add(id);
        escribirAlmacen(claveDeseos, JSON.stringify([...sig]));
        return sig;
      });
    },
    [claveDeseos],
  );

  const valor = useMemo<Contexto>(
    () => ({
      pais,
      notaEnvio,
      lineas,
      unidades: contarUnidades(lineas),
      listo,
      abierto,
      abrir,
      cerrar,
      agregar,
      cambiar,
      quitar,
      pulso,
      deseos,
      alternarDeseo,
      reemplazar,
    }),
    [pais, notaEnvio, lineas, listo, abierto, abrir, cerrar, agregar, cambiar, quitar, pulso, deseos, alternarDeseo, reemplazar],
  );

  return (
    <Ctx.Provider value={valor}>
      {children}
      {drawerCargado ? <CarritoDrawer /> : null}
      {/* Anuncio para lectores de pantalla de lo que pasó con el bolso. */}
      <div role="status" aria-live="polite" className="solo-lectores">
        {aviso}
      </div>
    </Ctx.Provider>
  );
}
