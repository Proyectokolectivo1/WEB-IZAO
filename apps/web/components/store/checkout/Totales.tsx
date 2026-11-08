import type { ReactNode } from 'react';

export interface FilaTotal {
  clave: string;
  etiqueta: ReactNode;
  valor: ReactNode;
  tono?: 'normal' | 'positivo';
}

/** Lista de totales (dl) con cifras tabulares; el total final va aparte y se anuncia al cambiar. */
export function Totales({ filas, total, etiquetaTotal, valorTotal }: { filas: FilaTotal[]; total?: boolean; etiquetaTotal?: string; valorTotal?: string }) {
  return (
    <dl className="flex flex-col gap-2 text-[0.9375rem]">
      {filas.map((f) => (
        <div key={f.clave} className={`flex items-baseline justify-between gap-4 ${f.tono === 'positivo' ? 'text-success' : ''}`}>
          <dt>{f.etiqueta}</dt>
          <dd className="text-right tabular-nums">{f.valor}</dd>
        </div>
      ))}
      {total && valorTotal ? (
        <div className="mt-2 flex items-baseline justify-between gap-4 border-t border-ink/25 pt-4">
          <dt className="etiqueta">{etiquetaTotal}</dt>
          <dd className="font-display text-3xl tabular-nums" aria-live="polite" aria-atomic="true">
            {valorTotal}
          </dd>
        </div>
      ) : null}
    </dl>
  );
}
