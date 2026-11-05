'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Icono, IzaoImage } from '@izao/ui';
import { formatearPrecio } from '@/lib/store/pais';
import { T } from '@/lib/store/textos';
import type { CodigoPais, Sugerencias } from '@/lib/store/types';

interface Opcion {
  id: string;
  href: string;
  etiqueta: string;
  grupo: 'productos' | 'marcas' | 'familias' | 'todos' | 'populares';
}

const MIN_CARACTERES = 2;
const ESPERA_MS = 200;

export function Buscador({ pais, populares }: { pais: CodigoPais; populares: string[] }) {
  const router = useRouter();
  const uid = useId();
  const [abierto, setAbierto] = useState(false); // panel móvil
  const [q, setQ] = useState('');
  const [enfocado, setEnfocado] = useState(false);
  const [datos, setDatos] = useState<Sugerencias | null>(null);
  const [activo, setActivo] = useState(-1);
  const entrada = useRef<HTMLInputElement>(null);
  const caja = useRef<HTMLDivElement>(null);
  const texto = q.trim();

  // Sugerencias con espera de 200 ms y cancelación de la petición anterior.
  useEffect(() => {
    if (texto.length < MIN_CARACTERES) {
      setDatos(null);
      return;
    }
    const ctl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/catalog/suggest?country=${pais}&q=${encodeURIComponent(texto)}`, { signal: ctl.signal })
        .then((r) => (r.ok ? (r.json() as Promise<Sugerencias>) : null))
        .then((d) => d && setDatos(d))
        .catch(() => undefined);
    }, ESPERA_MS);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [texto, pais]);

  const opciones = useMemo<Opcion[]>(() => {
    if (texto.length < MIN_CARACTERES) {
      return populares.map((p, k) => ({
        id: `${uid}-pop-${k}`,
        href: `/${pais}/buscar?q=${encodeURIComponent(p)}`,
        etiqueta: p,
        grupo: 'populares' as const,
      }));
    }
    const out: Opcion[] = [];
    datos?.productos.forEach((p) =>
      out.push({ id: `${uid}-p-${p.product_id}`, href: `/${pais}/perfume/${p.slug}`, etiqueta: p.name, grupo: 'productos' }),
    );
    datos?.marcas.forEach((m) => out.push({ id: `${uid}-m-${m.slug}`, href: `/${pais}/marca/${m.slug}`, etiqueta: m.name, grupo: 'marcas' }));
    datos?.familias.forEach((f) =>
      out.push({ id: `${uid}-f-${f.slug}`, href: `/${pais}/familia/${f.slug}`, etiqueta: f.name, grupo: 'familias' }),
    );
    out.push({ id: `${uid}-todos`, href: `/${pais}/buscar?q=${encodeURIComponent(texto)}`, etiqueta: T.busqueda.verTodos(texto), grupo: 'todos' });
    return out;
  }, [texto, datos, populares, pais, uid]);

  const listaVisible = enfocado && opciones.length > 0;

  function cerrarTodo() {
    setEnfocado(false);
    setAbierto(false);
    setActivo(-1);
  }

  function alEnviar(e: React.FormEvent) {
    e.preventDefault();
    const destino = activo >= 0 ? opciones[activo]?.href : texto ? `/${pais}/buscar?q=${encodeURIComponent(texto)}` : null;
    if (!destino) return;
    cerrarTodo();
    entrada.current?.blur();
    router.push(destino);
  }

  function alTeclear(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      if (listaVisible || abierto) {
        e.preventDefault();
        cerrarTodo();
      }
    } else if (e.key === 'ArrowDown' && opciones.length) {
      e.preventDefault();
      setActivo((a) => (a + 1) % opciones.length);
    } else if (e.key === 'ArrowUp' && opciones.length) {
      e.preventDefault();
      setActivo((a) => (a <= 0 ? opciones.length - 1 : a - 1));
    }
  }

  // Clic fuera cierra la lista.
  useEffect(() => {
    if (!enfocado) return;
    const f = (e: PointerEvent) => {
      if (caja.current && !caja.current.contains(e.target as Node)) cerrarTodo();
    };
    document.addEventListener('pointerdown', f);
    return () => document.removeEventListener('pointerdown', f);
  }, [enfocado]);

  useEffect(() => {
    if (abierto) entrada.current?.focus();
  }, [abierto]);

  const grupos: { clave: Opcion['grupo']; titulo: string }[] = [
    { clave: 'populares', titulo: T.busqueda.populares },
    { clave: 'productos', titulo: T.busqueda.productos },
    { clave: 'marcas', titulo: T.busqueda.marcas },
    { clave: 'familias', titulo: T.busqueda.familias },
    { clave: 'todos', titulo: '' },
  ];

  return (
    <div ref={caja} onKeyDown={alTeclear} className="flex items-center">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-label={abierto ? T.busqueda.cerrar : T.header.buscar}
        aria-expanded={abierto}
        className="inline-flex size-11 items-center justify-center rounded-control hover:bg-surface lg:hidden"
      >
        <Icono nombre={abierto ? 'cerrar' : 'buscar'} tamano={22} />
      </button>

      <form
        role="search"
        onSubmit={alEnviar}
        className={`${abierto ? 'block' : 'hidden'} absolute inset-x-0 top-full border-b border-line bg-bg px-4 py-3 lg:static lg:block lg:w-72 lg:border-0 lg:p-0 xl:w-80`}
      >
        <label htmlFor={`${uid}-q`} className="solo-lectores">
          {T.header.buscar}
        </label>
        <div className="relative">
          <Icono nombre="buscar" tamano={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/70" />
          <input
            ref={entrada}
            id={`${uid}-q`}
            type="search"
            role="combobox"
            aria-expanded={listaVisible}
            aria-controls={`${uid}-lista`}
            aria-autocomplete="list"
            aria-activedescendant={activo >= 0 ? opciones[activo]?.id : undefined}
            autoComplete="off"
            enterKeyHint="search"
            value={q}
            maxLength={80}
            placeholder={T.header.buscarPlaceholder}
            onChange={(e) => {
              setQ(e.target.value);
              setActivo(-1);
            }}
            onFocus={() => setEnfocado(true)}
            className="min-h-11 w-full rounded-control border border-line bg-bg pl-10 pr-3 text-[0.9375rem] placeholder:text-ink/60 focus:bg-surface"
          />

          {listaVisible ? (
            <div data-testid="sugerencias-busqueda" className="absolute inset-x-0 top-full z-50 mt-1 max-h-[70dvh] overflow-y-auto rounded-card border border-line bg-bg py-2 shadow-elev lg:min-w-[22rem]">
              <ul id={`${uid}-lista`} role="listbox" aria-label={T.busqueda.sugerencias}>
                {grupos.map((g) => {
                  const items = opciones.filter((o) => o.grupo === g.clave);
                  if (items.length === 0) return null;
                  return (
                    <li key={g.clave} role="presentation" className={g.clave === 'todos' ? 'mt-1 border-t border-line pt-1' : ''}>
                      {g.titulo ? <p className="etiqueta px-4 pb-1 pt-2 text-ink/70">{g.titulo}</p> : null}
                      <ul role="presentation">
                        {items.map((o) => {
                          const idx = opciones.indexOf(o);
                          const prod = g.clave === 'productos' ? datos?.productos.find((p) => `${uid}-p-${p.product_id}` === o.id) : null;
                          return (
                            <li key={o.id} id={o.id} role="option" aria-selected={idx === activo}>
                              <Link
                                href={o.href}
                                tabIndex={-1}
                                onClick={cerrarTodo}
                                className={`flex min-h-11 items-center gap-3 px-4 py-2 text-[0.9375rem] ${idx === activo ? 'bg-surface' : 'hover:bg-surface'}`}
                              >
                                {prod ? (
                                  <span className="w-9 shrink-0">
                                    <IzaoImage media={prod.img_primary} alt="" sizes="36px" redondeo="control" />
                                  </span>
                                ) : null}
                                <span className="min-w-0 flex-1 truncate">
                                  {o.etiqueta}
                                  {prod?.brand_name ? <span className="block text-[0.8125rem] text-ink/70">{prod.brand_name}</span> : null}
                                </span>
                                {prod ? <span className="text-[0.8125rem] tabular-nums">{formatearPrecio(prod.min_price, pais)}</span> : null}
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </div>
      </form>
    </div>
  );
}
