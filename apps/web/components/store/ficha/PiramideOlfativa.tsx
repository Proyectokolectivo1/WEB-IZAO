import { T } from '@/lib/store/textos';
import type { FichaProducto } from '@/lib/store/types';

type Nivel = NonNullable<FichaProducto['longevity']>;
const NIVELES: readonly Nivel[] = ['baja', 'media', 'alta', 'muy_alta'];

/** Segmentos de la pirámide: triángulo (salida), trapecio (corazón) y trapecio ancho (fondo). Trazo fino, sin relleno. */
const SEGMENTOS = [
  'M50 2 L75 66 H25 Z',
  'M25 66 L75 66 L100 130 H0 Z',
  'M0 130 L100 130 L125 194 H-25 Z',
] as const;

function Medidor({ nivel, etiqueta }: { nivel: Nivel; etiqueta: string }) {
  const n = NIVELES.indexOf(nivel) + 1;
  const nombre = T.ficha.niveles[nivel];
  return (
    <div className="flex items-center gap-3">
      <span role="img" aria-label={`${etiqueta}: ${T.ficha.nivelDe(nombre, n, NIVELES.length)}`} className="flex gap-1">
        {NIVELES.map((_, k) => (
          <span key={k} aria-hidden="true" className={`h-1.5 w-7 rounded-full ${k < n ? 'bg-ink' : 'bg-ink/15'}`} />
        ))}
      </span>
      <span aria-hidden="true" className="text-[0.9375rem]">
        {nombre}
      </span>
    </div>
  );
}

/**
 * Pirámide olfativa (§7.6): salida, corazón y fondo con trazo de 1 px, y los atributos de duración, estela,
 * ocasión y temporada. Muestra solo lo que el panel haya cargado.
 */
export function PiramideOlfativa({ ficha }: { ficha: FichaProducto }) {
  const TODAS = [
    { clave: 'salida', titulo: T.ficha.salida, notas: ficha.notes_top },
    { clave: 'corazon', titulo: T.ficha.corazon, notas: ficha.notes_heart },
    { clave: 'fondo', titulo: T.ficha.fondo, notas: ficha.notes_base },
  ];
  const filas = TODAS.filter((f) => f.notas.length > 0);
  const hayAtributos = !!ficha.longevity || !!ficha.sillage || ficha.occasion.length > 0 || ficha.season.length > 0;
  if (filas.length === 0 && !hayAtributos) return <p className="text-lg">{T.ficha.sinPiramide}</p>;

  return (
    <div className="grid gap-10 md:grid-cols-2 md:gap-16">
      {filas.length > 0 ? (
        <div data-testid="piramide" role="group" aria-label={T.ficha.piramide} className="flex gap-5 sm:gap-8">
          <svg
            aria-hidden="true"
            viewBox="-25 0 150 196"
            preserveAspectRatio="none"
            className="w-24 shrink-0 text-ink sm:w-32"
            stroke="currentColor"
            strokeWidth={1}
          >
            {SEGMENTOS.map((d, k) => (
              <path key={d} d={d} vectorEffect="non-scaling-stroke" style={{ fill: 'var(--tono)' }} className={`tono-${k} ${TODAS[k]!.notas.length ? '' : 'opacity-30'}`} />
            ))}
          </svg>
          <ol className="grid min-w-0 flex-1 grid-rows-3 overflow-hidden rounded-card">
            {TODAS.map((f, k) => (
              <li key={f.clave} className={`tono-${k} fondo-tono flex min-h-24 flex-col justify-center gap-1 px-5 py-3`}>
                <p className="etiqueta text-ink/80">{f.titulo}</p>
                <p className="font-display text-xl leading-snug sm:text-2xl">{f.notas.length ? f.notas.join(' · ') : '—'}</p>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {hayAtributos ? (
        <dl data-testid="atributos" className="bloque-calido grid content-start gap-x-6 gap-y-5 p-5 sm:grid-cols-[8rem_minmax(0,1fr)] sm:p-7">
          {ficha.longevity ? (
            <>
              <dt className="etiqueta pt-1 text-ink/70">{T.ficha.duracion}</dt>
              <dd>
                <Medidor nivel={ficha.longevity} etiqueta={T.ficha.duracion} />
              </dd>
            </>
          ) : null}
          {ficha.sillage ? (
            <>
              <dt className="etiqueta pt-1 text-ink/70">{T.ficha.estela}</dt>
              <dd>
                <Medidor nivel={ficha.sillage} etiqueta={T.ficha.estela} />
              </dd>
            </>
          ) : null}
          {ficha.occasion.length > 0 ? (
            <>
              <dt className="etiqueta pt-1 text-ink/70">{T.ficha.ocasion}</dt>
              <dd className="text-[0.9375rem]">{ficha.occasion.join(' · ')}</dd>
            </>
          ) : null}
          {ficha.season.length > 0 ? (
            <>
              <dt className="etiqueta pt-1 text-ink/70">{T.ficha.temporada}</dt>
              <dd className="text-[0.9375rem]">{ficha.season.join(' · ')}</dd>
            </>
          ) : null}
        </dl>
      ) : null}
    </div>
  );
}
