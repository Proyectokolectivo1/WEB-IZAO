'use client';

import dynamic from 'next/dynamic';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
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

/** Lo que no cambia con el contenido del bolso: las acciones y los textos del país. Quien solo agrega no se re-renderiza al agregar. */
interface Acciones {
  pais: CodigoPais;
  /** Nota de envío del bolso y del resumen: sale del espacio `nota_envio` del panel (por defecto, el texto del seed). */
  notaEnvio: string;
  /** Valor de la fila «Envío» (espacio `valor_envio`, campo título); por defecto, el del seed. */
  valorEnvio: string;
  abrir: () => void;
  cerrar: () => void;
  agregar: (l: NuevaLinea, opciones?: { abrirBolso?: boolean }) => void;
  cambiar: (variantId: string, cantidad: number) => void;
  quitar: (variantId: string) => void;
  alternarDeseo: (productId: string) => void;
  /** Reemplaza líneas con lo que devolvió el servidor (precio o existencias distintas). */
  reemplazar: (lineas: LineaCarrito[]) => void;
}

interface EstadoLineas {
  lineas: LineaCarrito[];
  unidades: number;
  /** Se vuelve `true` cuando ya se leyó `localStorage` (evita mostrar un bolso vacío por un instante). */
  listo: boolean;
}

/** Lista de deseos como almacén externo: cada tarjeta se suscribe solo a su producto y las demás no se enteran. */
interface AlmacenDeseos {
  leer: () => ReadonlySet<string>;
  poner: (d: ReadonlySet<string>) => void;
  suscribir: (cb: () => void) => () => void;
}

function crearAlmacenDeseos(): AlmacenDeseos {
  let actual: ReadonlySet<string> = new Set();
  const oyentes = new Set<() => void>();
  return {
    leer: () => actual,
    poner: (d) => {
      actual = d;
      oyentes.forEach((o) => o());
    },
    suscribir: (cb) => {
      oyentes.add(cb);
      return () => oyentes.delete(cb);
    },
  };
}

// Contexto partido (acciones / líneas / abierto / pulso / deseos): un cambio solo despierta a quien lo lee.
const CtxAcciones = createContext<Acciones | null>(null);
const CtxLineas = createContext<EstadoLineas | null>(null);
const CtxAbierto = createContext<boolean>(false);
const CtxPulso = createContext<number>(0);
const CtxDeseos = createContext<AlmacenDeseos | null>(null);

function exigir<T>(c: T | null): T {
  if (!c) throw new Error('El bolso debe usarse dentro de <CarritoProvider>.');
  return c;
}

/** Acciones estables (agregar, cambiar, quitar, abrir…) y datos del país. No cambia al editar el bolso. */
export function useCarritoAcciones(): Acciones {
  return exigir(useContext(CtxAcciones));
}
/** Líneas, unidades y `listo`. */
export function useCarritoLineas(): EstadoLineas {
  return exigir(useContext(CtxLineas));
}
/** `true` mientras el drawer del bolso está abierto. */
export function useBolsoAbierto(): boolean {
  return useContext(CtxAbierto);
}
/** Sube cada vez que se agrega algo; el ícono del carrito lo usa para rebotar. */
export function usePulsoBolso(): number {
  return useContext(CtxPulso);
}
/** ¿Está este producto en la lista de deseos? Solo re-renderiza cuando cambia la respuesta para ese producto. */
export function useDeseo(productId: string): boolean {
  const a = exigir(useContext(CtxDeseos));
  return useSyncExternalStore(
    a.suscribir,
    () => a.leer().has(productId),
    () => false,
  );
}

/** Todo junto, para las pantallas que de todos modos dependen de casi todo. Prefiere los hooks finos de arriba. */
export function useCarrito() {
  const acciones = useCarritoAcciones();
  const estado = useCarritoLineas();
  const abierto = useBolsoAbierto();
  const pulso = usePulsoBolso();
  const almacen = exigir(useContext(CtxDeseos));
  const deseos = useSyncExternalStore(almacen.suscribir, almacen.leer, () => VACIO);
  return { ...acciones, ...estado, abierto, pulso, deseos };
}
const VACIO: ReadonlySet<string> = new Set();

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

export function CarritoProvider({
  pais,
  notaEnvio = T.carrito.notaEnvio,
  valorEnvio = T.carrito.envioGratis,
  children,
}: {
  pais: CodigoPais;
  notaEnvio?: string;
  valorEnvio?: string;
  children: ReactNode;
}) {
  const [lineas, setLineas] = useState<LineaCarrito[]>([]);
  const [listo, setListo] = useState(false);
  const [abierto, setAbierto] = useState(false);
  const [drawerCargado, setDrawerCargado] = useState(false);
  const [pulso, setPulso] = useState(0);
  const [aviso, setAviso] = useState('');
  const [almacenDeseos] = useState(crearAlmacenDeseos);
  const clave = claveCarrito(pais);
  const claveDeseos = `izao:deseos:${pais}`;
  const omitirEscritura = useRef(true);

  // Lectura inicial y sincronía entre pestañas.
  useEffect(() => {
    setLineas(leer(leerAlmacen(clave)));
    try {
      const d: unknown = JSON.parse(leerAlmacen(claveDeseos) ?? '[]');
      almacenDeseos.poner(new Set(Array.isArray(d) ? d.filter((x): x is string => typeof x === 'string').slice(0, 500) : []));
    } catch {
      almacenDeseos.poner(new Set());
    }
    setListo(true);
    const alCambiar = (e: StorageEvent) => {
      if (e.key === clave) setLineas(leer(e.newValue));
    };
    window.addEventListener('storage', alCambiar);
    return () => window.removeEventListener('storage', alCambiar);
  }, [clave, claveDeseos, almacenDeseos]);

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

  const agregar = useCallback<Acciones['agregar']>(
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
      const sig = new Set(almacenDeseos.leer());
      if (!sig.delete(id)) sig.add(id);
      escribirAlmacen(claveDeseos, JSON.stringify([...sig]));
      almacenDeseos.poner(sig);
    },
    [claveDeseos, almacenDeseos],
  );

  const acciones = useMemo<Acciones>(
    () => ({ pais, notaEnvio, valorEnvio, abrir, cerrar, agregar, cambiar, quitar, alternarDeseo, reemplazar }),
    [pais, notaEnvio, valorEnvio, abrir, cerrar, agregar, cambiar, quitar, alternarDeseo, reemplazar],
  );
  const estadoLineas = useMemo<EstadoLineas>(() => ({ lineas, unidades: contarUnidades(lineas), listo }), [lineas, listo]);

  return (
    <CtxAcciones.Provider value={acciones}>
      <CtxLineas.Provider value={estadoLineas}>
        <CtxAbierto.Provider value={abierto}>
          <CtxPulso.Provider value={pulso}>
            <CtxDeseos.Provider value={almacenDeseos}>
              {children}
              {drawerCargado ? <CarritoDrawer /> : null}
              {/* Anuncio para lectores de pantalla de lo que pasó con el bolso. */}
              <div role="status" aria-live="polite" className="solo-lectores">
                {aviso}
              </div>
            </CtxDeseos.Provider>
          </CtxPulso.Provider>
        </CtxAbierto.Provider>
      </CtxLineas.Provider>
    </CtxAcciones.Provider>
  );
}
