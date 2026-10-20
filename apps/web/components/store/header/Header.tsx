import Link from 'next/link';
import { rutasDeMedio } from '@izao/ui';
import { T } from '@/lib/store/textos';
import type { AjustesTienda, Anuncio, CategoriaMenu, CodigoPais } from '@/lib/store/types';
import { AnuncioBarra } from './AnuncioBarra';
import { BarraSuperior } from './BarraSuperior';
import { BotonBolso } from './BotonBolso';
import { Buscador } from './Buscador';
import { MenuEscritorio } from './MenuEscritorio';
import { MenuMovil } from './MenuMovil';

interface Props {
  pais: CodigoPais;
  ajustes: AjustesTienda;
  anuncios: Anuncio[];
  categorias: CategoriaMenu[];
  populares: string[];
}

export function Header({ pais, ajustes, anuncios, categorias, populares }: Props) {
  const logo = rutasDeMedio(ajustes.logo);
  return (
    <header>
      <a
        href="#contenido"
        className="solo-lectores focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-md focus:bg-ink focus:px-4 focus:py-3 focus:text-bg"
      >
        {T.header.saltarContenido}
      </a>
      <BarraSuperior>
        <AnuncioBarra anuncios={anuncios} segundos={ajustes.rotacionAnunciosSegundos} />
        <div className="relative border-b border-line">
          <div className="mx-auto grid h-16 max-w-[96rem] grid-cols-[1fr_auto_1fr] items-center gap-2 px-2 sm:px-4 lg:h-20 lg:grid-cols-[auto_1fr_auto] lg:gap-8 lg:px-8">
            <div className="flex items-center lg:hidden">
              <MenuMovil pais={pais} categorias={categorias} />
            </div>
            <Link href={`/${pais}`} aria-label={`${ajustes.nombreTienda}. ${T.marca.irInicio}`} className="justify-self-center lg:justify-self-start">
              {logo ? (
                <img
                  src={logo.src}
                  srcSet={logo.srcSet}
                  sizes="160px"
                  alt=""
                  width={ajustes.logo?.width ?? 160}
                  height={ajustes.logo?.height ?? 40}
                  className="h-8 w-auto lg:h-10"
                  fetchPriority="high"
                />
              ) : (
                <span className="font-display text-[1.625rem] leading-none lg:text-3xl">{ajustes.nombreTienda}</span>
              )}
            </Link>
            <div className="hidden lg:block lg:justify-self-center">
              <MenuEscritorio pais={pais} categorias={categorias} />
            </div>
            <div className="flex items-center justify-end gap-1">
              <Buscador pais={pais} populares={populares} />
              <BotonBolso />
            </div>
          </div>
        </div>
      </BarraSuperior>
    </header>
  );
}
