import { Skeleton, TarjetaEsqueleto } from '@izao/ui';

/**
 * Esqueletos de pantalla completa para la navegación suave (listados, búsqueda y ficha). Se muestran del lado del
 * cliente, encima del contenido y sin `loading.tsx`: ese archivo vuelve las rutas dinámicas un flujo en streaming y
 * el 404 de `notFound()` pasa a 200 (ver bitácora). Reproducen la caja de la pantalla final (contenedor, columnas,
 * alturas de línea y tarjeta) y solo usan colores del tema; con `prefers-reduced-motion` el pulso se congela.
 * Son decorativos: el aviso para lectores de pantalla lo da `NavegacionPendiente`.
 */

const CONTENEDOR_FICHA = 'mx-auto w-full max-w-[96rem] px-4 sm:px-8';
const TARJETAS = 10;

/** Misma caja que `ListadoCatalogo`: encabezado, barra de herramientas, panel de filtros y rejilla de tarjetas. */
function EsqueletoListado() {
  return (
    <div className="mx-auto w-full max-w-[96rem] px-4 pb-24 pt-8 sm:px-8 lg:pt-12">
      <div className="border-b border-line pb-6">
        <Skeleton className="h-10 w-2/3 max-w-sm md:h-12" />
      </div>
      <div className="flex min-h-14 items-center justify-between gap-3 border-b border-line py-2">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="hidden h-11 w-48 lg:block" />
      </div>
      <div className="flex gap-10 pt-6">
        <div className="hidden w-64 shrink-0 flex-col gap-6 lg:flex">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex flex-col gap-3 border-b border-line pb-6">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
            </div>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <div className="grid grid-cols-2 gap-x-3 gap-y-10 sm:gap-x-5 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {Array.from({ length: TARJETAS }, (_, i) => (
              <TarjetaEsqueleto key={i} testId={null} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Misma caja que la ficha: migas, galería 4:5 con miniaturas y columna de compra. */
function EsqueletoFicha() {
  return (
    <div className={`${CONTENEDOR_FICHA} pb-28 pt-6 lg:pb-24`}>
      <div className="flex min-h-11 items-center pb-6">
        <Skeleton className="h-4 w-56" />
      </div>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] lg:gap-16">
        <div className="grid gap-3 md:grid-cols-[5rem_minmax(0,1fr)] md:gap-4">
          <Skeleton className="aspect-[4/5] w-full rounded-card md:order-2" />
          <div className="hidden flex-col gap-2 md:order-1 md:flex">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="aspect-[4/5] w-full" />
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-7 lg:pt-2">
          <div className="flex flex-col gap-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-10 w-3/4 md:h-12" />
            <Skeleton className="h-5 w-1/2" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-14 w-28" />
            <Skeleton className="h-14 w-28" />
          </div>
          <Skeleton className="h-10 w-40" />
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <Skeleton className="h-12 w-32" />
              <Skeleton className="h-12 min-w-[12rem] flex-1" />
            </div>
            <Skeleton className="h-12 w-full" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function EsqueletoPagina({ tipo }: { tipo: 'ficha' | 'listado' }) {
  return tipo === 'ficha' ? <EsqueletoFicha /> : <EsqueletoListado />;
}
