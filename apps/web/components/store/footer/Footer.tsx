import Link from 'next/link';
import { IzaoImage } from '@izao/ui';
import { T } from '@/lib/store/textos';
import { SelectorPais } from './SelectorPais';
import type { AjustesTienda, CodigoPais, EspacioContenido, PaginaListada } from '@/lib/store/types';

interface Props {
  pais: CodigoPais;
  ajustes: AjustesTienda;
  paginas: PaginaListada[];
  espacios: EspacioContenido[];
}

/** Valores con marcadores sin resolver ([COMPLETAR], [NIT]…) nunca se muestran al público. */
const util = (v: string | undefined): string | null => (v && !/\[[^\]]*\]/.test(v) && v.trim() ? v.trim() : null);

export function Footer({ pais, ajustes, paginas, espacios }: Props) {
  const medios = espacios.find((e) => e.key === 'medios_de_pago');
  const wa = ajustes.whatsappAsesor?.replace(/\D/g, '') ?? '';
  const correo = util(ajustes.legal['correo']);
  const telefono = util(ajustes.legal['telefono']);
  const horario = util(ajustes.legal['horario']);
  const direccion = util(ajustes.legal['direccion']);
  const razon = util(ajustes.legal['razon_social']);
  const redes = Object.entries(ajustes.redes).filter(([, url]) => /^https?:\/\//.test(url));
  const enlace = 'inline-flex min-h-11 items-center underline-offset-4 hover:underline';

  return (
    <footer className="mt-24 bg-ink text-bg">
      <div className="mx-auto grid max-w-[96rem] gap-12 px-4 py-14 sm:px-8 md:grid-cols-12">
        <div className="md:col-span-5">
          <p className="font-display text-4xl leading-none">{ajustes.nombreTienda}</p>
          {wa ? (
            <p className="pt-6">
              <a href={`https://wa.me/${wa}`} className={`${enlace} text-[1.0625rem]`} rel="noopener">
                {T.footer.escribenos}
              </a>
            </p>
          ) : null}
          <address className="space-y-1 pt-4 text-[0.9375rem] not-italic text-bg/90">
            {correo ? <p>{correo}</p> : null}
            {telefono ? <p>{telefono}</p> : null}
            {horario ? <p>{horario}</p> : null}
            {direccion ? <p>{direccion}</p> : null}
          </address>
        </div>

        {paginas.length > 0 ? (
          <nav aria-label={T.footer.politicas} className="md:col-span-4">
            <p className="etiqueta pb-3 text-bg/80">{T.footer.politicas}</p>
            <ul>
              {paginas.map((p) => (
                <li key={p.slug}>
                  <Link href={`/${pais}/pagina/${p.slug}`} className={`${enlace} text-[0.9375rem]`}>
                    {p.title}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}

        <div className="md:col-span-3">
          <p className="etiqueta pb-3 text-bg/80" id="selector-pais">
            {T.footer.cambiarPais}
          </p>
          <SelectorPais pais={pais} id="selector-pais" />
          {redes.length > 0 ? (
            <ul className="flex flex-wrap gap-x-4 pt-6">
              {redes.map(([nombre, url]) => (
                <li key={nombre}>
                  <a href={url} rel="noopener noreferrer" className={`${enlace} text-[0.9375rem] capitalize`}>
                    {nombre}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>

      <div className="border-t border-bg/20">
        <div className="mx-auto flex max-w-[96rem] flex-col gap-4 px-4 py-6 text-[0.8125rem] sm:px-8 md:flex-row md:items-center md:justify-between">
          <p>
            {T.footer.derechos(new Date().getFullYear(), razon ?? ajustes.nombreTienda)}
          </p>
          {medios?.media ? (
            <div className="w-56">
              <p className="solo-lectores">{T.footer.medios}</p>
              <IzaoImage media={medios.media} alt={medios.title ?? T.footer.medios} sizes="224px" proporcion={5} />
            </div>
          ) : null}
        </div>
      </div>
    </footer>
  );
}
