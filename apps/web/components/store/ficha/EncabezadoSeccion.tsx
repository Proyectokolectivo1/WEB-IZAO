import { T } from '@/lib/store/textos';

/** Encabezado numerado de las secciones de la ficha: filete de 1 px, número en versalitas y título editorial. */
export function EncabezadoSeccion({ n, titulo, id }: { n: number; titulo: string; id?: string }) {
  return (
    <div className="mb-8 flex items-baseline gap-4 border-t border-ink pt-4">
      <span className="etiqueta tabular-nums text-ink/70">{T.home.seccion(n)}</span>
      <h2 id={id} className="text-3xl md:text-5xl">
        {titulo}
      </h2>
    </div>
  );
}
