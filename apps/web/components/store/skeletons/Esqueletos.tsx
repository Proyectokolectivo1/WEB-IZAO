import { Skeleton } from '@izao/ui';
import { T } from '@/lib/store/textos';

/**
 * Esqueletos de carga de la tienda: vista rápida y bolso/checkout con productos guardados (antes de hidratar).
 * No hay `loading.tsx`: en rutas dinámicas hace streaming y el 404 de `notFound()` pasa a 200 (ver bitácora).
 *
 * - Misma caja que la pantalla final (contenedor, paddings, columnas y alturas de línea), para que reemplazarlos no mueva nada.
 * - Solo colores del tema (`Skeleton` usa `bg-surface`) y pulso de opacidad; con `prefers-reduced-motion` el pulso se
 *   congela (regla global en tokens.css).
 * - Accesibles: el contenedor es `role="status"` con `aria-busy` y un texto solo para lectores; las formas son `aria-hidden`.
 * - Server components: no suman JavaScript.
 */

/** Líneas y resumen del bolso: la caja de `PaginaCarrito` con productos. */
export function EsqueletoBolsoLleno({ className = '' }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      data-testid="esqueleto-bolso"
      className={`grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,1fr)_24rem] lg:gap-16 xl:grid-cols-[minmax(0,1fr)_26rem] ${className}`}
    >
      <ul className="flex flex-col">
        {Array.from({ length: 2 }, (_, i) => (
          <li key={i} className="flex gap-4 border-b border-line py-6">
            <Skeleton className="aspect-[4/5] w-24 shrink-0 sm:w-28" />
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="mt-auto h-11 w-32" />
            </div>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-4 self-start rounded-panel bg-surface/40 p-6">
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    </div>
  );
}

/** Pasos del checkout y su resumen: la caja de `FormularioCheckout` con productos. */
export function EsqueletoCheckoutLleno({ className = '' }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      data-testid="esqueleto-checkout"
      className={`grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,1fr)_24rem] lg:gap-16 ${className}`}
    >
      <div className="flex flex-col gap-8">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="flex flex-col gap-4 border-b border-line pb-8">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ))}
      </div>
      <Skeleton className="h-80 w-full self-start rounded-panel" />
    </div>
  );
}

/** Contenido de la vista rápida mientras llega la ficha: misma rejilla que la vista (imagen 4:5 + columna de compra). */
export function EsqueletoVistaRapida() {
  return (
    <>
      <p className="solo-lectores md:col-span-2" role="status">
        {T.cargaPantalla.vistaRapida}
      </p>
      <Skeleton className="aspect-[4/5] w-full rounded-card" />
      <div className="flex flex-col gap-5" aria-hidden="true">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-9 w-3/4 md:h-10" />
          <Skeleton className="h-5 w-1/3" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-14 w-28" />
          <Skeleton className="h-14 w-28" />
        </div>
        <Skeleton className="h-10 w-40" />
        <div className="flex flex-wrap items-center gap-3">
          <Skeleton className="h-12 w-32" />
          <Skeleton className="h-12 min-w-[12rem] flex-1" />
        </div>
        <Skeleton className="h-5 w-32" />
      </div>
    </>
  );
}
