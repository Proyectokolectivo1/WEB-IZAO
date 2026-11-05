'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Icono, IzaoImage, Sheet, clasesBoton } from '@izao/ui';
import { descartarReferido, referidoParaAplicar } from '@/lib/store/atribucion/referido';
import { pedirVistaPrevia } from '@/lib/store/carrito/adaptador';
import { mensajeCodigo } from '@/lib/store/carrito/contrato';
import { vistaPrevia } from '@/lib/store/carrito/logica';
import { formatearPrecio } from '@/lib/store/pais';
import { T } from '@/lib/store/textos';
import type { ItemCatalogo } from '@/lib/store/types';
import { Cantidad } from '../Cantidad';
import { useCarrito } from './CarritoProvider';

interface Codigo {
  texto: string;
  estado: 'aplicado' | 'rechazado' | 'sin-servicio';
  mensaje: string | null;
}

export function CarritoDrawer() {
  const { pais, notaEnvio, valorEnvio, lineas, abierto, cerrar, cambiar, quitar, reemplazar } = useCarrito();
  const [codigoEscrito, setCodigoEscrito] = useState('');
  const [codigo, setCodigo] = useState<Codigo | null>(null);
  const [revisando, setRevisando] = useState(false);
  const [descuentoServidor, setDescuentoServidor] = useState<bigint | null>(null);
  const [subtotalServidor, setSubtotalServidor] = useState<bigint | null>(null);
  const [ajustado, setAjustado] = useState(false);
  const [complementos, setComplementos] = useState<ItemCatalogo[]>([]);
  const lineasRef = useRef(lineas);
  lineasRef.current = lineas;

  const local = useMemo(() => vistaPrevia(lineas, pais, new Date()), [lineas, pais]);
  const llaveLineas = lineas.map((l) => `${l.variantId}:${l.cantidad}`).join('|');
  const llaveCodigo = codigo?.estado === 'aplicado' ? codigo.texto : null;
  // Código del enlace de referido (`?ref=`) puesto solo: si el servidor lo rechaza, se retira sin avisar.
  const referidoAuto = useRef<string | null>(null);
  const referidoProbado = useRef(false);

  useEffect(() => {
    if (!abierto || codigo || referidoProbado.current) return;
    referidoProbado.current = true;
    const ref = referidoParaAplicar(pais);
    if (!ref) return;
    referidoAuto.current = ref;
    setCodigo({ texto: ref, estado: 'aplicado', mensaje: T.carrito.codigoAplicado(ref) });
  }, [abierto, codigo, pais]);

  // El servidor recalcula siempre: al abrir y al cambiar el bolso o el código se pide la vista previa.
  useEffect(() => {
    if (!abierto || lineasRef.current.length === 0) return;
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await pedirVistaPrevia(pais, lineasRef.current, llaveCodigo, ctl.signal);
        if (!r) {
          setSubtotalServidor(null);
          setDescuentoServidor(null);
          return;
        }
        setSubtotalServidor(BigInt(r.subtotal));
        setDescuentoServidor(BigInt(r.discount));
        let cambio = false;
        const actualizadas = lineasRef.current
          .map((l) => {
            const s = r.lines.find((x) => x.variant_id === l.variantId);
            if (!s) return l;
            // `max_quantity` ya viene acotado por lo pedido: solo sirve para bajar la cantidad o quitar agotados.
            if (s.unit_price !== l.precio || s.max_quantity < l.cantidad) cambio = true;
            return { ...l, precio: s.unit_price, tachado: s.compare_at, cantidad: Math.min(l.cantidad, Math.max(s.max_quantity, 1)) };
          })
          .filter((l) => r.lines.find((x) => x.variant_id === l.variantId)?.max_quantity !== 0);
        if (actualizadas.length !== lineasRef.current.length) cambio = true;
        if (cambio) {
          setAjustado(true);
          reemplazar(actualizadas);
        }
        if (r.code && r.code.status === 'rejected') {
          if (referidoAuto.current === r.code.code) {
            // No lo escribió la persona: se retira sin avisar (se vuelve a probar al recargar la página).
            referidoAuto.current = null;
            setCodigo(null);
            setDescuentoServidor(null);
          } else {
            setCodigo({ texto: r.code.code, estado: 'rechazado', mensaje: mensajeCodigo(r.code.reason) });
          }
        }
      } catch {
        /* sin red o cancelado: se queda el subtotal local */
      }
    }, 350);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [abierto, llaveLineas, llaveCodigo, pais, reemplazar]);

  // Complementos: 2–3 aromas de la misma familia que el primero del bolso.
  const primero = lineas[0]?.productId;
  useEffect(() => {
    if (!abierto || !primero) {
      setComplementos([]);
      return;
    }
    const ctl = new AbortController();
    fetch(`/api/catalog/related?country=${pais}&id=${encodeURIComponent(primero)}&limit=3`, { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d: { items?: ItemCatalogo[] }) => setComplementos((d.items ?? []).slice(0, 3)))
      .catch(() => undefined);
    return () => ctl.abort();
  }, [abierto, primero, pais]);

  async function aplicarCodigo(e: React.FormEvent) {
    e.preventDefault();
    const texto = codigoEscrito.trim().toUpperCase().slice(0, 40);
    if (!texto || lineas.length === 0) return;
    setRevisando(true);
    try {
      const r = await pedirVistaPrevia(pais, lineas, texto);
      if (!r) {
        setCodigo({ texto, estado: 'sin-servicio', mensaje: T.carrito.codigoFalla });
      } else if (r.code?.status === 'applied') {
        setCodigo({ texto: r.code.code, estado: 'aplicado', mensaje: T.carrito.codigoAplicado(r.code.code) });
        setDescuentoServidor(BigInt(r.discount));
        setSubtotalServidor(BigInt(r.subtotal));
        setCodigoEscrito('');
      } else {
        setCodigo({ texto, estado: 'rechazado', mensaje: mensajeCodigo(r.code?.reason ?? null) });
      }
    } catch {
      setCodigo({ texto, estado: 'sin-servicio', mensaje: T.carrito.codigoFalla });
    } finally {
      setRevisando(false);
    }
  }

  const subtotal = subtotalServidor ?? local.subtotal;
  const descuento = codigo?.estado === 'aplicado' ? (descuentoServidor ?? 0n) : 0n;
  const precio = (v: bigint | string | number) => formatearPrecio(v, pais);

  return (
    <Sheet
      abierto={abierto}
      onCerrar={cerrar}
      titulo={T.carrito.titulo}
      lado="derecha"
      pie={
        lineas.length > 0 ? (
          <div className="flex flex-col gap-3">
            <dl className="flex flex-col gap-1 text-[0.9375rem]">
              <div className="flex justify-between">
                <dt>{T.carrito.subtotal}</dt>
                <dd className="tabular-nums">{precio(subtotal)}</dd>
              </div>
              {descuento > 0n ? (
                <div className="flex justify-between text-success">
                  <dt>{T.carrito.descuento}</dt>
                  <dd className="tabular-nums">−{precio(descuento)}</dd>
                </div>
              ) : null}
              <div className="flex justify-between">
                <dt>{T.carrito.envio}</dt>
                <dd>{valorEnvio}</dd>
              </div>
            </dl>
            <p className="text-[0.8125rem] text-ink/80">{notaEnvio}</p>
            <Link href={`/${pais}/checkout`} onClick={cerrar} className={clasesBoton({ bloque: true, tamano: 'lg' })}>
              {T.carrito.finalizar}
            </Link>
          </div>
        ) : null
      }
    >
      <div aria-label={T.carrito.resumenAria(lineas.length)}>
        {lineas.length === 0 ? (
          <div className="flex flex-col items-start gap-5 px-5 py-10">
            <Icono nombre="bolso" tamano={32} />
            <p className="font-display text-2xl leading-snug">{T.carrito.vacio}</p>
            <Link href={`/${pais}/catalogo`} onClick={cerrar} className={clasesBoton({ variante: 'secundario' })}>
              {T.carrito.verAromas}
            </Link>
          </div>
        ) : (
          <>
            {ajustado ? (
              <p role="status" className="mx-5 mt-4 rounded-card bg-surface px-3 py-2 text-[0.875rem]">
                {T.carrito.ajusteServidor}
              </p>
            ) : null}
            <ul className="divide-y divide-line px-5">
              {lineas.map((l) => (
                <li key={l.variantId} className="flex gap-4 py-5">
                  <Link href={`/${pais}/perfume/${l.slug}`} onClick={cerrar} className="w-20 shrink-0">
                    <IzaoImage media={l.imagen} alt={l.nombre} sizes="80px" redondeo="control" />
                  </Link>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <Link href={`/${pais}/perfume/${l.slug}`} onClick={cerrar} className="font-display text-xl leading-tight">
                      {l.nombre}
                    </Link>
                    {l.presentacion ? <p className="text-[0.875rem] text-ink/80">{l.presentacion}</p> : null}
                    <p className="flex items-baseline gap-2 text-[0.9375rem]">
                      <span className="tabular-nums">{precio(l.precio)}</span>
                      {l.tachado ? <s className="text-[1.125rem] text-muted tabular-nums">{precio(l.tachado)}</s> : null}
                    </p>
                    <div className="mt-2 flex items-center justify-between">
                      <Cantidad
                        valor={l.cantidad}
                        max={l.max}
                        onCambiar={(n) => cambiar(l.variantId, n)}
                        etiqueta={T.carrito.cantidad(l.nombre, l.cantidad)}
                        etiquetaMas={T.carrito.masUna(l.nombre)}
                        etiquetaMenos={T.carrito.menosUna(l.nombre)}
                      />
                      <button
                        type="button"
                        onClick={() => quitar(l.variantId)}
                        aria-label={T.carrito.quitar(l.nombre)}
                        className="inline-flex size-11 items-center justify-center rounded-control hover:bg-surface"
                      >
                        <Icono nombre="papelera" />
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            <form onSubmit={aplicarCodigo} className="border-t border-line px-5 py-5" noValidate>
              <label htmlFor="codigo-descuento" className="etiqueta block pb-2">
                {T.carrito.codigo}
              </label>
              <div className="flex gap-2">
                <input
                  id="codigo-descuento"
                  value={codigoEscrito}
                  onChange={(e) => setCodigoEscrito(e.target.value)}
                  autoComplete="off"
                  autoCapitalize="characters"
                  maxLength={40}
                  aria-describedby="codigo-mensaje"
                  aria-invalid={codigo?.estado === 'rechazado' || undefined}
                  className="min-h-11 min-w-0 flex-1 rounded-control border border-line bg-bg px-3 uppercase focus:bg-surface"
                />
                <Button type="submit" variante="secundario" disabled={revisando || !codigoEscrito.trim()}>
                  {revisando ? T.carrito.aplicando : T.carrito.aplicar}
                </Button>
              </div>
              <p
                id="codigo-mensaje"
                role="status"
                className={`min-h-5 pt-2 text-[0.875rem] ${codigo?.estado === 'rechazado' ? 'text-danger' : ''}`}
              >
                {codigo?.mensaje}
                {codigo?.estado === 'aplicado' ? (
                  <button type="button" onClick={() => {
                      descartarReferido(pais, codigo.texto);
                      setCodigo(null);
                    }}
                    className="ml-2 underline underline-offset-4">
                    {T.carrito.quitarCodigo}
                  </button>
                ) : null}
              </p>
            </form>

            {complementos.length > 0 ? (
              <section className="border-t border-line px-5 py-5" aria-labelledby="complementos-titulo">
                <h3 id="complementos-titulo" className="pb-3 text-xl">
                  {T.carrito.complementos}
                </h3>
                <ul className="grid grid-cols-3 gap-3">
                  {complementos.map((c) => (
                    <li key={c.product_id}>
                      <Link href={`/${pais}/perfume/${c.slug}`} onClick={cerrar} className="block">
                        <IzaoImage media={c.img_primary} alt={c.name} sizes="120px" />
                        <span className="mt-2 block text-[0.8125rem] leading-snug">{c.name}</span>
                        <span className="block text-[0.8125rem] tabular-nums">{precio(c.min_price)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        )}
      </div>
    </Sheet>
  );
}
