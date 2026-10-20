'use client';

import type { ReactNode } from 'react';
import { Chip } from '@izao/ui';
import { T } from '@/lib/store/textos';
import type { CodigoPais, FiltrosCatalogo, OpcionFiltro, OpcionesFiltros } from '@/lib/store/types';
import { RangoPrecio } from './RangoPrecio';

interface Props {
  pais: CodigoPais;
  opciones: OpcionesFiltros;
  /** Filtros que fija la ruta (p. ej. la categoría): su grupo no se muestra. */
  fijos: FiltrosCatalogo;
  valor: FiltrosCatalogo;
  onCambio: (f: FiltrosCatalogo) => void;
  /** Sufijo de los `data-testid` y de los `id` (`-hoja` en la hoja inferior). */
  sufijo?: string;
  /** Límites reales del precio; si faltan, se usan los de `opciones`. */
  limitesPrecio?: { min: number; max: number };
}

function Grupo({ titulo, abierto = true, children }: { titulo: string; abierto?: boolean; children: ReactNode }) {
  return (
    <details open={abierto} className="group border-b border-line py-4">
      <summary className="etiqueta flex min-h-11 cursor-pointer list-none items-center justify-between marker:hidden [&::-webkit-details-marker]:hidden">
        {titulo}
        <span aria-hidden="true" className="text-lg leading-none text-ink/70 group-open:hidden">+</span>
        <span aria-hidden="true" className="hidden text-lg leading-none text-ink/70 group-open:inline">−</span>
      </summary>
      <div className="pt-2">{children}</div>
    </details>
  );
}

function ListaCasillas({
  nombre,
  opciones,
  elegidos,
  onCambio,
  sufijo,
}: {
  nombre: string;
  opciones: OpcionFiltro[];
  elegidos: string[];
  onCambio: (slugs: string[]) => void;
  sufijo: string;
}) {
  return (
    <ul className="max-h-72 overflow-y-auto pr-1">
      {opciones.map((o) => {
        const id = `${nombre}${sufijo}-${o.slug}`;
        const marcado = elegidos.includes(o.slug);
        return (
          <li key={o.slug}>
            <label htmlFor={id} className="flex min-h-11 cursor-pointer items-center gap-3 text-[0.9375rem]">
              <input
                id={id}
                type="checkbox"
                checked={marcado}
                onChange={() => onCambio(marcado ? elegidos.filter((s) => s !== o.slug) : [...elegidos, o.slug])}
                className="size-5 shrink-0 accent-ink"
              />
              {o.name}
            </label>
          </li>
        );
      })}
    </ul>
  );
}

function Fichas({
  opciones,
  elegido,
  onCambio,
  etiqueta,
}: {
  opciones: OpcionFiltro[];
  elegido: string | undefined;
  onCambio: (slug: string | undefined) => void;
  etiqueta: string;
}) {
  return (
    <div role="group" aria-label={etiqueta} className="flex flex-wrap gap-2">
      {opciones.map((o) => (
        <Chip key={o.slug} seleccionado={elegido === o.slug} onClick={() => onCambio(elegido === o.slug ? undefined : o.slug)}>
          {o.name}
        </Chip>
      ))}
    </div>
  );
}

/**
 * Filtros del listado (§7.2). Se usa igual en la barra lateral de escritorio (aplica al instante) y en la hoja
 * inferior móvil (edita un borrador). Marca y familia admiten varias opciones; el resto, una.
 */
export function FiltrosPanel({ pais, opciones, fijos, valor, onCambio, sufijo = '', limitesPrecio }: Props) {
  const poner = (parcial: Partial<FiltrosCatalogo>) => {
    const sig: FiltrosCatalogo = { ...valor, ...parcial };
    for (const k of Object.keys(sig) as (keyof FiltrosCatalogo)[]) {
      const v = sig[k];
      if (v === undefined || (Array.isArray(v) && v.length === 0)) delete sig[k];
    }
    onCambio(sig);
  };
  const oculta = (k: keyof FiltrosCatalogo) => fijos[k] !== undefined;
  const limites = limitesPrecio ?? { min: opciones.precioMin, max: opciones.precioMax };

  return (
    <div>
      {!oculta('gender') && opciones.generos.length > 0 ? (
        <Grupo titulo={T.listado.genero}>
          <Fichas opciones={opciones.generos} elegido={valor.gender} etiqueta={T.listado.genero} onCambio={(gender) => poner({ gender })} />
        </Grupo>
      ) : null}

      {!oculta('brands') && opciones.marcas.length > 0 ? (
        <Grupo titulo={T.listado.marca}>
          <ListaCasillas nombre="marca" sufijo={sufijo} opciones={opciones.marcas} elegidos={valor.brands ?? []} onCambio={(brands) => poner({ brands })} />
        </Grupo>
      ) : null}

      {!oculta('families') && opciones.familias.length > 0 ? (
        <Grupo titulo={T.listado.familia} abierto={false}>
          <ListaCasillas nombre="familia" sufijo={sufijo} opciones={opciones.familias} elegidos={valor.families ?? []} onCambio={(families) => poner({ families })} />
        </Grupo>
      ) : null}

      {!oculta('concentration') && opciones.concentraciones.length > 0 ? (
        <Grupo titulo={T.listado.concentracion} abierto={false}>
          <Fichas opciones={opciones.concentraciones} elegido={valor.concentration} etiqueta={T.listado.concentracion} onCambio={(concentration) => poner({ concentration })} />
        </Grupo>
      ) : null}

      {!oculta('category') && opciones.categorias.length > 0 ? (
        <Grupo titulo={T.listado.categoria} abierto={false}>
          <Fichas opciones={opciones.categorias} elegido={valor.category} etiqueta={T.listado.categoria} onCambio={(category) => poner({ category })} />
        </Grupo>
      ) : null}

      {limites.max > limites.min ? (
        <Grupo titulo={T.listado.precio}>
          <RangoPrecio
            pais={pais}
            limites={limites}
            valor={{ price_min: valor.price_min, price_max: valor.price_max }}
            sufijo={sufijo}
            onCambio={(r) => {
              const sig: FiltrosCatalogo = { ...valor };
              delete sig.price_min;
              delete sig.price_max;
              onCambio({ ...sig, ...r });
            }}
          />
        </Grupo>
      ) : null}

      <Grupo titulo={T.listado.disponibilidad}>
        <label htmlFor={`disponible${sufijo}`} className="flex min-h-11 cursor-pointer items-center gap-3 text-[0.9375rem]">
          <input
            id={`disponible${sufijo}`}
            type="checkbox"
            checked={valor.availability === 'in_stock'}
            onChange={(e) => poner({ availability: e.target.checked ? 'in_stock' : undefined })}
            className="size-5 shrink-0 accent-ink"
          />
          {T.listado.soloEnStock}
        </label>
      </Grupo>
    </div>
  );
}
