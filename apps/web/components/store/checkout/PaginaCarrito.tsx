'use client';

import Link from 'next/link';
import { Icono, IzaoImage, Revelar, clasesBoton } from '@izao/ui';
import { formatearPrecio } from '@/lib/store/pais';
import { T } from '@/lib/store/textos';
import { TC } from '@/lib/store/textos-checkout';
import { Cantidad } from '../Cantidad';
import { useCarrito } from '../carrito/CarritoProvider';
import { useVistaPrevia } from '../carrito/useVistaPrevia';
import { CodigoDescuento } from './CodigoDescuento';
import { Totales, type FilaTotal } from './Totales';

/** Página completa del bolso (`/{pais}/carrito`): lo mismo que el drawer, con aire y un resumen a la vista. */
export function PaginaCarrito() {
  const { pais, notaEnvio, valorEnvio, lineas, listo, cambiar, quitar, unidades } = useCarrito();
  const vista = useVistaPrevia();
  const precio = (v: bigint | string) => formatearPrecio(v, pais);

  if (!listo) {
    return (
      <div className="min-h-[60vh]" aria-busy="true">
        <p className="solo-lectores" role="status">
          {TC.carrito.cargando}
        </p>
      </div>
    );
  }

  if (lineas.length === 0) {
    return (
      <div className="flex min-h-[50vh] flex-col items-start gap-6 py-10">
        <Icono nombre="bolso" tamano={32} />
        <p className="max-w-xl font-display text-3xl leading-snug md:text-4xl">{T.carrito.vacio}</p>
        <Link href={`/${pais}/catalogo`} className={clasesBoton({ variante: 'secundario' })}>
          {T.carrito.verAromas}
        </Link>
      </div>
    );
  }

  const total = vista.subtotal - vista.descuento;
  const filas: FilaTotal[] = [{ clave: 'sub', etiqueta: T.carrito.subtotal, valor: precio(vista.subtotal) }];
  if (vista.descuento > 0n) filas.push({ clave: 'desc', etiqueta: T.carrito.descuento, valor: `−${precio(vista.descuento)}`, tono: 'positivo' });
  filas.push({ clave: 'envio', etiqueta: T.carrito.envio, valor: valorEnvio });

  return (
    <div className="grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,1fr)_24rem] lg:gap-16 xl:grid-cols-[minmax(0,1fr)_26rem]">
      <section aria-label={T.carrito.resumenAria(lineas.length)}>
        {vista.ajuste ? (
          <p role="status" className="mb-6 rounded-card bg-surface px-4 py-3 text-[0.9375rem]">
            {vista.ajuste === 'agotado' ? TC.checkout.agotadoQuitado : T.carrito.ajusteServidor}
          </p>
        ) : null}
        <ul className="divide-y divide-line border-y border-line">
          {lineas.map((l, i) => (
            <li key={l.variantId}>
              <Revelar indice={Math.min(i, 6)} className="flex gap-4 py-6 sm:gap-6">
                <Link href={`/${pais}/perfume/${l.slug}`} className="w-24 shrink-0 sm:w-32">
                  <IzaoImage media={l.imagen} alt={l.nombre} sizes="(min-width: 640px) 128px, 96px" />
                </Link>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <Link href={`/${pais}/perfume/${l.slug}`} className="font-display text-2xl leading-tight">
                    {l.nombre}
                  </Link>
                  {l.presentacion ? <p className="text-[0.9375rem] text-ink/80">{l.presentacion}</p> : null}
                  <p className="flex items-baseline gap-2 text-[0.9375rem]">
                    <span className="tabular-nums">{precio(l.precio)}</span>
                    {l.tachado ? <s className="text-[1.125rem] text-muted tabular-nums">{precio(l.tachado)}</s> : null}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <Cantidad
                      valor={l.cantidad}
                      max={l.max}
                      onCambiar={(n) => cambiar(l.variantId, n)}
                      etiqueta={T.carrito.cantidad(l.nombre, l.cantidad)}
                      etiquetaMas={T.carrito.masUna(l.nombre)}
                      etiquetaMenos={T.carrito.menosUna(l.nombre)}
                    />
                    <p className="tabular-nums" aria-label={TC.carrito.totalLinea(l.nombre)}>
                      {precio(BigInt(l.precio) * BigInt(l.cantidad))}
                    </p>
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
              </Revelar>
            </li>
          ))}
        </ul>
        <Link href={`/${pais}/catalogo`} className={clasesBoton({ variante: 'texto', className: 'mt-6' })}>
          {TC.carrito.seguirComprando}
        </Link>
      </section>

      <aside aria-labelledby="resumen-bolso" className="h-fit lg:sticky lg:top-28">
        <div className="rounded-card border border-line p-6">
          <p id="resumen-bolso" className="etiqueta pb-5">
            01 · {TC.carrito.resumen} · {TC.carrito.unidades(unidades)}
          </p>
          <Totales filas={filas} total etiquetaTotal={TC.resumen.total} valorTotal={precio(total)} />
          <p className="pt-4 text-[0.875rem] text-ink/80">{notaEnvio}</p>
          <div className="mt-6 border-t border-line pt-5">
            <CodigoDescuento
              id="codigo-bolso"
              codigo={vista.codigo}
              revisando={vista.revisando}
              onAplicar={vista.aplicar}
              onQuitar={vista.quitarCodigo}
            />
          </div>
          <Link href={`/${pais}/checkout`} className={clasesBoton({ bloque: true, tamano: 'lg', className: 'mt-6' })}>
            {TC.carrito.finalizar}
          </Link>
        </div>
      </aside>
    </div>
  );
}
