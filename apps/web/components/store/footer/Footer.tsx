import Link from 'next/link';
import { Icono, IzaoImage } from '@izao/ui';
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
    <footer className="mt-24 rounded-t-panel bg-ink text-bg">
      {wa ? (
        <div className="mx-auto max-w-[96rem] px-4 pt-12 sm:px-8 md:pt-16">
          <div className="textura-calida flex flex-col gap-6 rounded-card bg-bg/10 p-6 md:flex-row md:items-center md:justify-between md:p-10">
            <p className="max-w-xl font-display text-3xl leading-tight md:text-4xl">{T.footer.invitacion}</p>
            <a
              href={`https://wa.me/${wa}`}
              rel="noopener"
              className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-control bg-bg px-7 text-[0.9375rem] font-semibold text-ink transition-colors hover:bg-surface"
            >
              <Icono nombre="chat" tamano={20} />
              {T.footer.escribenos}
            </a>
          </div>
        </div>
      ) : null}
      <div className="mx-auto grid max-w-[96rem] gap-12 px-4 py-12 sm:px-8 md:grid-cols-12 md:py-14">
        <div className="md:col-span-5">
          <p className="font-display text-4xl leading-none">{ajustes.nombreTienda}</p>
          <p className="max-w-xs pt-4 text-[1.0625rem] text-bg/90">{T.footer.lema}</p>
          <address className="space-y-1 pt-4 text-[0.9375rem] not-italic text-bg/90">
            {correo ? <p>{correo}</p> : null}
            {telefono ? <p>{telefono}</p> : null}
            {horario ? <p>{horario}</p> : null}
            {direccion ? <p>{direccion}</p> : null}
          </address>
        </div>

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
            <li>
              <Link href={`/${pais}/garantias`} className={`${enlace} text-[0.9375rem]`}>
                {T.footer.garantias}
              </Link>
            </li>
          </ul>
        </nav>

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
              <IzaoImage media={medios.media} alt={medios.title ?? T.footer.medios} sizes="224px" proporcion={5} redondeo="none" />
            </div>
          ) : null}
        </div>
      </div>
    </footer>
  );
}
