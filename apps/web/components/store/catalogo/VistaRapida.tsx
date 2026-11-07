'use client';

import Link from 'next/link';
import { useState } from 'react';
import { IzaoImage, Sheet } from '@izao/ui';
import { T } from '@/lib/store/textos';
import type { CodigoPais } from '@/lib/store/types';
import { EsqueletoVistaRapida } from '../skeletons/Esqueletos';
import { PanelCompra } from './PanelCompra';
import { useFicha } from './useFicha';

interface Props {
  pais: CodigoPais;
  slug: string;
  abierto: boolean;
  onCerrar: () => void;
}

/** Vista rápida (§7.5): modal en escritorio, hoja inferior en móvil. Foco atrapado y `Esc` cierran. */
export function VistaRapida({ pais, slug, abierto, onCerrar }: Props) {
  const { ficha, estado } = useFicha(pais, slug, abierto);
  const [activa, setActiva] = useState(0);
  const imagenes = ficha ? (ficha.images.length ? ficha.images.map((i) => i.media) : ficha.img_primary ? [ficha.img_primary] : []) : [];

  return (
    <Sheet abierto={abierto} onCerrar={onCerrar} titulo={ficha?.name ?? T.tarjeta.vistaRapida} lado="responsivo" testId="vista-rapida">
      <div aria-busy={estado === 'cargando' || estado === 'inactivo'} className="grid gap-6 p-5 md:grid-cols-2 md:gap-10 md:p-8">
        {estado === 'cargando' || estado === 'inactivo' ? (
          <EsqueletoVistaRapida />
        ) : estado === 'error' || !ficha ? (
          <p className="md:col-span-2">{T.errores.generico}</p>
        ) : (
          <>
            <div>
              <IzaoImage
                media={imagenes[activa] ?? null}
                alt={imagenes[activa]?.alt ?? ficha.name}
                sizes="(min-width:768px) 30rem, 100vw"
              />
              {imagenes.length > 1 ? (
                <ul className="mt-2 grid grid-cols-5 gap-2" aria-label={T.ficha.galeria}>
                  {imagenes.slice(0, 5).map((m, k) => (
                    <li key={k}>
                      <button
                        type="button"
                        onClick={() => setActiva(k)}
                        aria-label={T.ficha.imagenN(k + 1, imagenes.length)}
                        aria-current={k === activa}
                        className={`block w-full overflow-hidden rounded-control border ${k === activa ? 'border-ink' : 'border-transparent'}`}
                      >
                        <IzaoImage media={m} alt="" sizes="80px" redondeo="control" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <div className="flex flex-col gap-5">
              <div>
                {ficha.brand_name ? <p className="etiqueta text-ink/70">{ficha.brand_name}</p> : null}
                <h3 className="pt-1 text-3xl md:text-4xl">{ficha.name}</h3>
                {ficha.concentration_name ? <p className="pt-1 text-[0.9375rem]">{ficha.concentration_name}</p> : null}
              </div>
              <PanelCompra ficha={ficha} pais={pais} alAgregar={onCerrar} />
              <Link href={`/${pais}/perfume/${ficha.slug}`} onClick={onCerrar} className="w-fit text-[0.9375rem] underline underline-offset-4">
                {T.ficha.verDetalle}
              </Link>
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}
