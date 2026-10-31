'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button, ChipQuitar, GrillaEsqueleto, Icono, Sheet } from '@izao/ui';
import { aParametros, contarFiltros } from '@/lib/store/filtros';
import {
  hrefListado,
  leerInstantanea,
  quitarFijos,
  serializarInstantanea,
  type ConsultaListado,
  type LoteListado,
} from '@/lib/store/lote';
import { abrirIza, llegoPorAtras } from '@/lib/store/navegacion';
import { formatearPrecio } from '@/lib/store/pais';
import { T } from '@/lib/store/textos';
import type { CodigoPais, FiltrosCatalogo, OpcionesFiltros, OrdenCatalogo } from '@/lib/store/types';
import { FiltrosPanel } from './FiltrosPanel';
import { TarjetaProducto } from './TarjetaProducto';
import { useConteoEnVivo, useLote } from './useLote';

interface Props {
  pais: CodigoPais;
  titulo: string;
  descripcion?: string | null;
  /** Ruta del listado sin parámetros, p. ej. `/co/categoria/arabes`. */
  base: string;
  /** Filtros que fija la ruta (categoría, marca, familia, colección). */
  fijos: FiltrosCatalogo;
  /** Estado leído de la URL en el servidor. */
  consulta: ConsultaListado;
  pagina: number;
  inicial: LoteListado;
  opciones: OpcionesFiltros;
  /** Mensaje cuando la búsqueda no trae nada (usa el de la tienda por defecto). */
  esBusqueda?: boolean;
}

const ORDENES_ELEGIBLES: OrdenCatalogo[] = ['featured', 'sales', 'newest', 'price_asc', 'price_desc', 'discount'];
const claveConsulta = (c: ConsultaListado) => aParametros({ q: c.q, filtros: c.filtros, orden: c.orden }).toString();

function nombreDe(lista: { slug: string; name: string }[], slug: string): string {
  return lista.find((o) => o.slug === slug)?.name ?? slug;
}

export function ListadoCatalogo({ pais, titulo, descripcion, base, fijos, consulta: consultaInicial, pagina, inicial, opciones, esBusqueda = false }: Props) {
  const uid = useId();
  const { lote, consulta, estado, cargarMas, aplicar, reintentar, restaurar } = useLote(pais, fijos, inicial, consultaInicial);
  const [paginaActual, setPaginaActual] = useState(pagina);
  const [hidratado, setHidratado] = useState(false);
  const [panelAbierto, setPanelAbierto] = useState(true);
  const [hoja, setHoja] = useState(false);
  const [borrador, setBorrador] = useState<ConsultaListado>(consultaInicial);
  const [mostrarSubir, setMostrarSubir] = useState(false);

  const centinela = useRef<HTMLDivElement>(null);
  const rejilla = useRef<HTMLDivElement>(null);
  const scrollRef = useRef(0);
  const temporizador = useRef<number | null>(null);
  const vivo = useRef(true);
  const datos = useRef({ lote, clave: '' });
  const clave = useCallback((c: ConsultaListado) => claveConsulta({ ...c, filtros: quitarFijos(c.filtros, fijos) }), [fijos]);
  const datosConsulta = useRef(consulta);
  datosConsulta.current = consulta;
  const cambiado = clave(consulta) !== clave(consultaInicial);

  const href = useMemo(() => hrefListado(base, consulta, fijos, paginaActual), [base, consulta, fijos, paginaActual]);
  datos.current.lote = lote;
  datos.current.clave = `izao:lista:${pais}:${href}`;

  // --- Instantánea para volver desde la ficha (§7.1) ---------------------------------------------------------
  const guardar = useCallback((y: number) => {
    const { lote: l, clave } = datos.current;
    if (l.items.length === 0) return;
    try {
      window.sessionStorage.setItem(clave, serializarInstantanea({ items: l.items, nextCursor: l.nextCursor, total: l.total, scrollY: y, guardado: Date.now() }));
    } catch {
      /* almacenamiento lleno o bloqueado: se vuelve a pedir el listado */
    }
  }, []);

  useLayoutEffect(() => {
    setHidratado(true);
    if (!llegoPorAtras()) return;
    let snap = null;
    try {
      snap = leerInstantanea(window.sessionStorage.getItem(datos.current.clave));
    } catch {
      /* sin almacenamiento */
    }
    if (!snap) return;
    restaurar({ items: snap.items, nextCursor: snap.nextCursor, total: snap.total });
    // Next también lleva la página nueva al inicio, y eso puede ocurrir tras nuestro primer `scrollTo` (ficha leída
    // un rato, página regenerada, red lenta). Se vuelve a colocar hasta 3 s, y se deja de insistir en cuanto la
    // persona mueve la pantalla ella misma.
    const objetivo = snap.scrollY;
    let cancelado = false;
    const parar = () => {
      cancelado = true;
    };
    const eventos = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;
    for (const e of eventos) window.addEventListener(e, parar, { once: true, passive: true });
    const inicio = performance.now();
    const ir = () => {
      if (cancelado) return;
      if (Math.abs(window.scrollY - objetivo) > 4) window.scrollTo(0, objetivo);
      if (performance.now() - inicio < 3000) window.setTimeout(ir, 100);
      else for (const e of eventos) window.removeEventListener(e, parar);
    };
    requestAnimationFrame(ir);
  }, []);

  // Alto real de una tarjeta como referencia de las que están fuera de pantalla (`content-visibility`): con el alto fijo
  // de antes, saltar al final del listado movía el pie al pintarse las tarjetas (CLS).
  const primerId = lote.items[0]?.product_id ?? null;
  useEffect(() => {
    const g = rejilla.current;
    const primera = g?.firstElementChild as HTMLElement | null | undefined;
    if (!g || !primera) return;
    const medir = () => {
      if (primera.offsetHeight > 0) g.style.setProperty('--alto-tarjeta', `${primera.offsetHeight}px`);
    };
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(primera);
    return () => ro.disconnect();
  }, [primerId]);

  useEffect(() => {
    vivo.current = true;
    scrollRef.current = window.scrollY;
    const alScroll = () => {
      scrollRef.current = window.scrollY;
      setMostrarSubir(window.scrollY > window.innerHeight * 2);
      if (temporizador.current) window.clearTimeout(temporizador.current);
      temporizador.current = window.setTimeout(() => vivo.current && guardar(scrollRef.current), 250);
    };
    const alSalir = () => guardar(window.scrollY);
    const alOcultar = () => document.visibilityState === 'hidden' && guardar(window.scrollY);
    window.addEventListener('scroll', alScroll, { passive: true });
    window.addEventListener('pagehide', alSalir);
    document.addEventListener('visibilitychange', alOcultar);
    return () => {
      vivo.current = false;
      if (temporizador.current) window.clearTimeout(temporizador.current);
      window.removeEventListener('scroll', alScroll);
      window.removeEventListener('pagehide', alSalir);
      document.removeEventListener('visibilitychange', alOcultar);
      guardar(scrollRef.current);
    };
  }, [guardar]);

  // --- Centinela: precarga el siguiente lote a ~800 px del final ---------------------------------------------
  useEffect(() => {
    const el = centinela.current;
    if (!el || !lote.nextCursor || estado !== 'listo' || typeof IntersectionObserver === 'undefined') return;
    const obs = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && void cargarMas(), { rootMargin: '800px 0px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, [lote.nextCursor, lote.items.length, estado, cargarMas]);

  // --- Cambios de filtros y orden ------------------------------------------------------------------------------
  const aplicarConsulta = useCallback(
    (c: ConsultaListado) => {
      if (clave(c) === clave(datosConsulta.current)) return;
      setPaginaActual(1);
      void aplicar(c);
      window.history.replaceState(window.history.state, '', hrefListado(base, c, fijos));
      const tope = rejilla.current ? rejilla.current.getBoundingClientRect().top + window.scrollY - 96 : 0;
      if (window.scrollY > tope) window.scrollTo({ top: Math.max(tope, 0) });
    },
    [aplicar, base, fijos, clave],
  );
  const filtrosVisibles = quitarFijos(consulta.filtros, fijos);
  const nFiltros = contarFiltros(filtrosVisibles);
  const quitar = (parcial: Partial<FiltrosCatalogo>, claves: (keyof FiltrosCatalogo)[]) => {
    const f: FiltrosCatalogo = { ...consulta.filtros, ...parcial };
    for (const k of claves) delete f[k];
    aplicarConsulta({ ...consulta, filtros: f });
  };

  const chips: { id: string; etiqueta: string; quitar: () => void }[] = [];
  if (filtrosVisibles.gender) chips.push({ id: 'genero', etiqueta: nombreDe(opciones.generos, filtrosVisibles.gender), quitar: () => quitar({}, ['gender']) });
  for (const b of filtrosVisibles.brands ?? [])
    chips.push({ id: `marca-${b}`, etiqueta: nombreDe(opciones.marcas, b), quitar: () => quitar({ brands: (consulta.filtros.brands ?? []).filter((x) => x !== b) }, (consulta.filtros.brands ?? []).length === 1 ? ['brands'] : []) });
  for (const f of filtrosVisibles.families ?? [])
    chips.push({ id: `familia-${f}`, etiqueta: nombreDe(opciones.familias, f), quitar: () => quitar({ families: (consulta.filtros.families ?? []).filter((x) => x !== f) }, (consulta.filtros.families ?? []).length === 1 ? ['families'] : []) });
  if (filtrosVisibles.concentration) chips.push({ id: 'concentracion', etiqueta: nombreDe(opciones.concentraciones, filtrosVisibles.concentration), quitar: () => quitar({}, ['concentration']) });
  if (filtrosVisibles.category) chips.push({ id: 'categoria', etiqueta: nombreDe(opciones.categorias, filtrosVisibles.category), quitar: () => quitar({}, ['category']) });
  if (filtrosVisibles.availability) chips.push({ id: 'disponible', etiqueta: T.listado.disponibleChip, quitar: () => quitar({}, ['availability']) });
  if (filtrosVisibles.price_min !== undefined || filtrosVisibles.price_max !== undefined) {
    chips.push({
      id: 'precio',
      etiqueta: T.listado.precioChip(
        filtrosVisibles.price_min !== undefined ? formatearPrecio(filtrosVisibles.price_min, pais) : null,
        filtrosVisibles.price_max !== undefined ? formatearPrecio(filtrosVisibles.price_max, pais) : null,
      ),
      quitar: () => quitar({}, ['price_min', 'price_max']),
    });
  }
  const limpiarTodo = () => aplicarConsulta({ ...consulta, filtros: {} });

  // --- Hoja móvil ---------------------------------------------------------------------------------------------------
  const abrirHoja = () => {
    setBorrador(consulta);
    setHoja(true);
  };
  const borradorIgual = clave(borrador) === clave(consulta);
  const conteo = useConteoEnVivo(pais, hoja && !borradorIgual ? borrador : null, fijos);
  const totalHoja = borradorIgual ? lote.total : conteo.total;
  const textoTotalHoja = !borradorIgual && conteo.contando && conteo.total === null ? T.listado.contando : T.listado.contador(totalHoja, pais);

  const cargando = estado === 'cargandoMas';
  const recargando = estado === 'recargando';
  const sinResultados = lote.items.length === 0 && estado === 'listo';
  const hayAnterior = paginaActual > 1;
  const hrefSiguiente = !cambiado && inicial.nextCursor ? hrefListado(base, consulta, fijos, pagina + 1) : null;
  const hrefAnterior = hayAnterior && !cambiado ? hrefListado(base, consulta, fijos, pagina - 1) : null;

  const columnas = panelAbierto
    ? 'grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5'
    : 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5';

  return (
    <section aria-labelledby={`${uid}-titulo`} className="mx-auto w-full max-w-[96rem] px-4 pb-24 pt-8 sm:px-8 lg:pt-12">
      {hrefSiguiente ? <link rel="next" href={hrefSiguiente} /> : null}
      {hrefAnterior ? <link rel="prev" href={hrefAnterior} /> : null}

      <header className="border-b border-line pb-6">
        <h1 id={`${uid}-titulo`} className="text-4xl md:text-5xl">
          {titulo}
        </h1>
        {descripcion ? <p className="mt-3 max-w-2xl text-ink/80">{descripcion}</p> : null}
      </header>

      <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-b border-line py-2">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => setPanelAbierto((v) => !v)}
            aria-expanded={panelAbierto}
            aria-controls={`${uid}-filtros`}
            className="hidden min-h-11 items-center gap-2 text-[0.9375rem] underline-offset-4 hover:underline lg:inline-flex"
          >
            <Icono nombre="filtro" />
            {panelAbierto ? T.listado.ocultarFiltros : T.listado.mostrarFiltros}
            {nFiltros > 0 ? ` (${nFiltros})` : ''}
          </button>
          <p role="status" aria-live="polite" data-testid="total-resultados" className="text-[0.9375rem] text-ink/80">
            {recargando ? T.listado.contando : T.listado.contador(lote.total, pais)}
          </p>
        </div>
        <div className="hidden items-center gap-3 lg:flex">
          <label htmlFor={`${uid}-orden`} className="etiqueta text-ink/70">
            {T.listado.ordenar}
          </label>
          <select
            id={`${uid}-orden`}
            data-testid="selector-orden"
            value={consulta.orden === 'relevance' && !esBusqueda ? 'featured' : consulta.orden}
            onChange={(e) => aplicarConsulta({ ...consulta, orden: e.target.value as OrdenCatalogo })}
            className="min-h-11 rounded-md border border-line bg-transparent px-3 text-[0.9375rem]"
          >
            {esBusqueda ? <option value="relevance">{T.listado.ordenes.relevance}</option> : null}
            {ORDENES_ELEGIBLES.map((o) => (
              <option key={o} value={o}>
                {T.listado.ordenes[o]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {chips.length > 0 ? (
        <div role="group" aria-label={T.listado.filtrosActivos} className="flex flex-wrap items-center gap-2 border-b border-line py-3">
          {chips.map((c) => (
            <ChipQuitar key={c.id} testId="chip-filtro" etiqueta={c.etiqueta} etiquetaQuitar={T.listado.quitarFiltro(c.etiqueta)} onQuitar={c.quitar} />
          ))}
          <Button variante="texto" tamano="sm" data-testid="limpiar-filtros" onClick={limpiarTodo}>
            {T.listado.limpiarTodo}
          </Button>
        </div>
      ) : null}

      <div className="flex gap-10 pt-6">
        <aside id={`${uid}-filtros`} aria-label={T.listado.filtros} className={`hidden w-64 shrink-0 ${panelAbierto ? 'lg:block' : ''}`}>
          <div className="sticky top-24 max-h-[calc(100dvh-7rem)] overflow-y-auto pr-2">
            <FiltrosPanel pais={pais} opciones={opciones} fijos={fijos} valor={consulta.filtros} onCambio={(f) => aplicarConsulta({ ...consulta, filtros: f })} />
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          {hrefAnterior ? (
            <p className="pb-4">
              <Link href={hrefAnterior} className="text-[0.9375rem] underline underline-offset-4">
                {T.listado.verAnteriores}
              </Link>
            </p>
          ) : null}

          <div
            ref={rejilla}
            aria-busy={recargando || cargando}
            className={`grid gap-x-3 gap-y-10 transition-opacity duration-200 sm:gap-x-5 ${columnas} ${recargando ? 'opacity-50' : ''}`}
          >
            {lote.items.map((item, i) => (
              <TarjetaProducto
                key={item.product_id}
                item={item}
                pais={pais}
                prioritaria={i < 4}
                nivelTitulo="h2"
                concentracion={item.concentration_slug ? nombreDe(opciones.concentraciones, item.concentration_slug) : null}
              />
            ))}
            {cargando ? <GrillaEsqueleto cantidad={4} /> : null}
          </div>

          {sinResultados ? (
            <div data-testid="sin-resultados" className="mx-auto max-w-md py-20 text-center">
              <p className="font-[family-name:var(--font-display)] text-3xl">{T.listado.vacio}</p>
              {nFiltros > 0 ? <p className="mt-3 text-ink/80">{T.listado.sinResultadosAyuda}</p> : null}
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                {nFiltros > 0 ? (
                  <Button variante="secundario" onClick={limpiarTodo}>
                    {T.listado.limpiarTodo}
                  </Button>
                ) : null}
                <Button onClick={() => abrirIza({ busqueda: consulta.q || undefined })}>{T.listado.abrirIza}</Button>
              </div>
            </div>
          ) : null}

          {estado === 'error' ? (
            <div role="alert" className="py-10 text-center">
              <p>{T.listado.errorLote}</p>
              <Button className="mt-4" variante="secundario" onClick={reintentar}>
                {T.listado.reintentar}
              </Button>
            </div>
          ) : null}

          <div ref={centinela} data-testid="centinela-scroll" aria-hidden="true" className="h-px" />

          {!lote.nextCursor && lote.items.length > 0 && estado === 'listo' ? (
            <div data-testid="fin-resultados" className="mx-auto mt-16 max-w-lg border-t border-line pt-10 text-center">
              <p className="font-[family-name:var(--font-display)] text-3xl">{T.listado.finTitulo}</p>
              <p className="mt-3 text-ink/80">{T.listado.finIza}</p>
              <Button className="mt-6" variante="secundario" onClick={() => abrirIza({ busqueda: consulta.q || undefined })}>
                <Icono nombre="chat" />
                {T.listado.abrirIza}
              </Button>
            </div>
          ) : null}

          {/* Respaldo para buscadores y para quien navega sin JavaScript (§7.1); con JS el scroll infinito lo reemplaza. */}
          {hrefSiguiente && !hidratado ? (
            <nav aria-label={T.listado.paginacion} data-testid="paginacion-respaldo" className="mt-10 flex justify-center gap-6">
              {hrefAnterior ? (
                <Link href={hrefAnterior} rel="prev" className="inline-flex min-h-11 items-center underline underline-offset-4">
                  {T.listado.paginaAnterior}
                </Link>
              ) : null}
              <Link href={hrefSiguiente} rel="next" className="inline-flex min-h-11 items-center underline underline-offset-4">
                {T.listado.paginaSiguiente}
              </Link>
            </nav>
          ) : null}
        </div>
      </div>

      {/* Botón fijo de móvil (§7.2) */}
      <button
        type="button"
        data-testid="abrir-filtros"
        onClick={abrirHoja}
        aria-haspopup="dialog"
        className="fixed bottom-4 left-1/2 z-30 inline-flex min-h-12 -translate-x-1/2 items-center gap-2 rounded-md border border-ink bg-ink px-6 text-[0.9375rem] font-semibold text-bg shadow-elev lg:hidden"
      >
        <Icono nombre="filtro" />
        {T.listado.filtrarYOrdenarN(nFiltros)}
      </button>

      {mostrarSubir ? (
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })}
          aria-label={T.listado.volverArriba}
          // Por encima del botón flotante de Iza (56 px, misma esquina): bottom-4 + 56 px + aire.
          className="fixed bottom-[5.25rem] right-[1.25rem] z-30 inline-flex size-12 items-center justify-center rounded-md border border-ink bg-bg text-ink shadow-elev lg:bottom-[6.5rem] lg:right-[1.75rem]"
        >
          <Icono nombre="flechaArriba" />
        </button>
      ) : null}

      <Sheet
        abierto={hoja}
        onCerrar={() => setHoja(false)}
        titulo={T.listado.filtrarYOrdenar}
        etiquetaCerrar={T.listado.cerrarFiltros}
        lado="abajo"
        testId="hoja-filtros"
        pie={
          <div className="flex items-center gap-3">
            <p data-testid="contador-resultados" role="status" aria-live="polite" className="min-w-0 flex-1 text-[0.9375rem] tabular-nums">
              {textoTotalHoja}
            </p>
            <Button variante="texto" tamano="sm" data-testid="limpiar-filtros-hoja" onClick={() => setBorrador({ ...borrador, filtros: {} })}>
              {T.listado.limpiarTodo}
            </Button>
            <Button
              data-testid="aplicar-filtros"
              onClick={() => {
                aplicarConsulta(borrador);
                setHoja(false);
              }}
            >
              {T.listado.verResultados(totalHoja)}
            </Button>
          </div>
        }
      >
        <div className="px-5 pb-4">
          <div className="border-b border-line py-4">
            <label htmlFor={`${uid}-orden-hoja`} className="etiqueta mb-2 block">
              {T.listado.ordenar}
            </label>
            <select
              id={`${uid}-orden-hoja`}
              data-testid="selector-orden-hoja"
              value={borrador.orden === 'relevance' && !esBusqueda ? 'featured' : borrador.orden}
              onChange={(e) => setBorrador({ ...borrador, orden: e.target.value as OrdenCatalogo })}
              className="min-h-11 w-full rounded-md border border-line bg-transparent px-3 text-[0.9375rem]"
            >
              {esBusqueda ? <option value="relevance">{T.listado.ordenes.relevance}</option> : null}
              {ORDENES_ELEGIBLES.map((o) => (
                <option key={o} value={o}>
                  {T.listado.ordenes[o]}
                </option>
              ))}
            </select>
          </div>
          <FiltrosPanel pais={pais} opciones={opciones} fijos={fijos} valor={borrador.filtros} sufijo="-hoja" onCambio={(f) => setBorrador({ ...borrador, filtros: f })} />
        </div>
      </Sheet>
    </section>
  );
}
