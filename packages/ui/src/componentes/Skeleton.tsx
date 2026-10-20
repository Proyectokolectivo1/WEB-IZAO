/**
 * Esqueletos con las proporciones reales de la tarjeta (§7.1): imagen 4:5 y bloque de texto de
 * altura fija, igual que `TarjetaProducto`, para que cargar no mueva nada (CLS = 0).
 * Pulso solo de opacidad.
 */

export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-sm bg-surface/70 ${className}`} />;
}

/** Alturas del bloque de texto de la tarjeta; las comparte `TarjetaProducto` en la tienda. */
export const ALTURA_TEXTO_TARJETA = 'h-[7.25rem]';

export function TarjetaEsqueleto() {
  return (
    <div aria-hidden="true" className="flex flex-col">
      <Skeleton className="aspect-[4/5] w-full" />
      <div className={`flex flex-col gap-2 pt-3 ${ALTURA_TEXTO_TARJETA}`}>
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-4 w-3/5" />
        <Skeleton className="mt-auto h-5 w-2/5" />
      </div>
      <Skeleton className="mt-1 h-11 w-full" />
    </div>
  );
}

export function GrillaEsqueleto({ cantidad = 8 }: { cantidad?: number }) {
  return (
    <>
      {Array.from({ length: cantidad }, (_, i) => (
        <TarjetaEsqueleto key={i} />
      ))}
    </>
  );
}
