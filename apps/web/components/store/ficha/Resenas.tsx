import { Icono } from '@izao/ui';
import { T } from '@/lib/store/textos';
import type { FichaProducto } from '@/lib/store/types';

function Estrellas({ valor, tamano = 16 }: { valor: number; tamano?: number }) {
  return (
    <span role="img" aria-label={T.ficha.calificacion(Math.round(valor * 10) / 10)} className="inline-flex gap-0.5">
      {Array.from({ length: 5 }, (_, k) => (
        <Icono key={k} nombre="estrella" tamano={tamano} className={k < Math.round(valor) ? 'fill-ink' : ''} />
      ))}
    </span>
  );
}

const promedioTexto = (n: number) => n.toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Promedio, distribución y últimas reseñas aprobadas (§7.6, §9.6). Los nombres ya llegan abreviados («Andrea M.»). */
export function Resenas({ resenas }: { resenas: FichaProducto['reviews'] }) {
  if (resenas.count === 0 || resenas.avg === null) {
    return <p className="text-lg">{T.ficha.resenasSinNinguna}</p>;
  }
  const maximo = Math.max(1, ...[1, 2, 3, 4, 5].map((n) => Number(resenas.distribution[String(n)] ?? 0)));

  return (
    <div className="grid gap-10 md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] md:gap-16">
      <div className="flex flex-col gap-5">
        <div className="flex items-end gap-4">
          <p className="font-display text-7xl leading-none tabular-nums">{promedioTexto(resenas.avg)}</p>
          <div className="flex flex-col gap-1 pb-1">
            <Estrellas valor={resenas.avg} tamano={18} />
            <p className="text-[0.9375rem]">{T.ficha.resenasPromedio(promedioTexto(resenas.avg), resenas.count)}</p>
          </div>
        </div>
        <ul className="flex flex-col gap-2" aria-label={T.ficha.resenas}>
          {[5, 4, 3, 2, 1].map((n) => {
            const cantidad = Number(resenas.distribution[String(n)] ?? 0);
            return (
              <li key={n} className="grid grid-cols-[4.5rem_minmax(0,1fr)_2rem] items-center gap-3 text-[0.875rem]">
                <span>{T.ficha.estrellasN(n)}</span>
                <span aria-hidden="true" className="h-1 bg-line">
                  <span className="block h-full bg-ink" style={{ width: `${Math.round((cantidad / maximo) * 100)}%` }} />
                </span>
                <span className="text-right tabular-nums">{cantidad}</span>
              </li>
            );
          })}
        </ul>
      </div>

      {resenas.latest.length > 0 ? (
        <ul data-testid="lista-resenas" className="flex flex-col">
          {resenas.latest.map((r, k) => (
            <li key={k} className="flex flex-col gap-2 border-t border-line py-6 first:border-t-0 first:pt-0">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <Estrellas valor={r.rating} />
                {r.is_verified_purchase ? (
                  <span className="inline-flex items-center gap-1 text-[0.8125rem]">
                    <Icono nombre="check" tamano={14} />
                    {T.ficha.compraVerificada}
                  </span>
                ) : null}
              </div>
              {r.body ? <p className="font-display text-xl leading-snug">{r.body}</p> : null}
              <p className="text-[0.875rem]">
                {r.author_name}
                {r.city ? `, ${r.city}` : ''}
                <span className="px-2" aria-hidden="true">
                  ·
                </span>
                <time dateTime={r.created_at}>{T.ficha.fechaResena(r.created_at)}</time>
              </p>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
