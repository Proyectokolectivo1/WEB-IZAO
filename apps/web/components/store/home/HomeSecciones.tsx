import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';
import { Icono, IzaoImage, Revelar, clasesBoton, type NombreIcono } from '@izao/ui';
import type { ContenidoHome } from '@/lib/store/repo';
import { T } from '@/lib/store/textos';
import type { Banner, CodigoPais, SeccionHome } from '@/lib/store/types';
import { bannersDe, segundosCarrusel } from '@/lib/store/banners';
import { CarruselBanners } from '../CarruselBanners';
import { BannerFijo } from './BannerFijo';
import { PestanasColecciones } from './PestanasColecciones';

const ICONOS_VALIDOS: readonly NombreIcono[] = ['camion', 'caja', 'escudo', 'tarjeta', 'chat', 'reloj', 'check', 'estrella', 'gota', 'flor', 'hoja'];

const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const enlace = (v: unknown): string | null => {
  const t = texto(v);
  return t && (t.startsWith('/') || /^https?:\/\//.test(t)) && !t.startsWith('//') ? t : null;
};

export function leerBeneficios(config: Record<string, unknown>) {
  const items = Array.isArray(config['items']) ? (config['items'] as Record<string, unknown>[]) : [];
  return items
    .map((it) => ({
      icono: (ICONOS_VALIDOS as readonly string[]).includes(String(it['icon'])) ? (it['icon'] as NombreIcono) : ('check' as NombreIcono),
      titulo: texto(it['title']),
      texto: texto(it['text']),
    }))
    .filter((b) => b.titulo);
}

/** Ícono suave de cada familia olfativa según su nombre; si no se reconoce, rota entre tres. */
function iconoFamilia(slug: string, k: number): NombreIcono {
  if (/flor|rosa|jazmin|blanc/.test(slug)) return 'flor';
  if (/madera|amader|verde|herb|arom|fougere|chipre|musg|tierra/.test(slug)) return 'hoja';
  if (/citr|fresc|acuat|marin|fruta|frut|agua/.test(slug)) return 'gota';
  if (/orient|ambar|dulce|gourmand|vainill|especi/.test(slug)) return 'estrella';
  return (['flor', 'hoja', 'gota'] as const)[k % 3]!;
}

/**
 * Encabezado de sección: rótulo corto, título y bajada. Sin números ni filetes: el ritmo lo dan el aire y las bandas de fondo.
 * Los tres textos salen de la configuración de la sección en el panel (`title`, `kicker`, `subtitle`); T trae solo los del seed.
 */
function Encabezado({
  kicker,
  titulo,
  bajada,
  enlaceTodos,
  pais,
}: {
  kicker?: string | null;
  titulo: string | null;
  bajada?: string | null;
  enlaceTodos?: string;
  pais?: CodigoPais;
}) {
  return (
    <div className="mb-9 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 md:mb-12">
      <div className="max-w-2xl">
        {kicker ? (
          <p className="etiqueta flex items-center gap-3 text-ink/70">
            <span aria-hidden="true" className="h-0.5 w-8 rounded-full bg-accent" />
            {kicker}
          </p>
        ) : null}
        {titulo ? <h2 className="mt-3 text-[2.125rem] leading-[1.05] md:text-5xl">{titulo}</h2> : null}
        {bajada ? <p className="mt-3 max-w-prose text-[1.0625rem] text-ink/80">{bajada}</p> : null}
      </div>
      {enlaceTodos && pais ? (
        <Link href={`/${pais}${enlaceTodos}`} className="inline-flex min-h-11 items-center text-[0.9375rem] underline underline-offset-4">
          {T.home.verTodos}
        </Link>
      ) : null}
    </div>
  );
}

/** Anclas de las secciones del home: el panel las ofrece como destino de un banner (`/co#seccion-reviews`). */
const ID_SECCION = {
  hero: 'seccion-hero',
  categories: 'seccion-categories',
  families: 'seccion-families',
  banner: 'seccion-banner',
  collection_tabs: 'seccion-collection_tabs',
  advice: 'seccion-advice',
  benefits: 'seccion-benefits',
  reviews: 'seccion-reviews',
} as const;

const CONTENEDOR = 'mx-auto w-full max-w-[96rem] px-4 sm:px-8';

/** Sección sobre el fondo de la página, con aire arriba. */
function Plana({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <section id={id} className={`${CONTENEDOR} scroll-mt-24 pt-16 md:pt-24`}>
      {children}
    </section>
  );
}

/** Sección sobre una banda de color a todo el ancho: da ritmo sin líneas. */
function Banda({ id, tono, children }: { id?: string; tono: 'banda-suave' | 'banda-acento'; children: ReactNode }) {
  return (
    <section id={id} className={`mt-16 md:mt-24 scroll-mt-24 ${tono}`}>
      <div className={`${CONTENEDOR} py-14 md:py-20`}>{children}</div>
    </section>
  );
}

function BannersMid({ banners, pais, id }: { banners: Banner[]; pais: CodigoPais; id?: string }) {
  return (
    <section id={id} className={`${CONTENEDOR} flex scroll-mt-24 flex-col gap-4 pt-16 md:pt-24`}>
      {banners.map((b) => (
        <BannerFijo key={b.id} banner={b} ubicacion="mid" pais={pais} />
      ))}
    </section>
  );
}

function Seccion({ s, contenido, pais, bannersMid }: { s: SeccionHome; contenido: ContenidoHome; pais: CodigoPais; bannersMid: Banner[] }) {
  const titulo = texto(s.config['title']);
  const kicker = texto(s.config['kicker']) ?? T.home.kicker[s.type] ?? null;
  const bajada = texto(s.config['subtitle']) ?? T.home.bajada[s.type] ?? null;
  switch (s.type) {
    case 'hero':
      return <CarruselBanners id={ID_SECCION.hero} banners={bannersDe(contenido.banners, 'hero')} pais={pais} segundos={segundosCarrusel(s.config)} />;

    case 'categories': {
      if (contenido.categorias.length === 0) return null;
      return (
        <Plana id={ID_SECCION.categories}>
          <Encabezado kicker={kicker} titulo={titulo ?? T.home.categorias} bajada={bajada} />
          <ul className="grid grid-cols-2 items-start gap-x-4 gap-y-9 pb-8 md:grid-cols-3 md:gap-x-6 lg:grid-cols-4 2xl:grid-cols-6">
            {contenido.categorias.map((c, k) => (
              <li key={c.id} className="even:mt-8">
                <Revelar indice={k}>
                  <Link href={`/${pais}/categoria/${c.slug}`} className="group block">
                    {/* Arco: la silueta de un frasco. Con foto, la foto; sin ella, un fondo cálido con textura, ondas y la inicial. */}
                    <div
                      className={`tono-${k % 4} fondo-tono ondas sombra-tierna elevar relative aspect-[4/5] overflow-hidden rounded-t-[999px] rounded-b-card`}
                    >
                      {c.image ? (
                        <IzaoImage
                          media={c.image}
                          alt=""
                          sizes="(min-width:1536px) 15vw, (min-width:1024px) 22vw, 45vw"
                          redondeo="none"
                          className="absolute inset-0 h-full object-cover transition-transform duration-500 ease-izao motion-reduce:transform-none group-hover:scale-[1.04]"
                        />
                      ) : (
                        <>
                          <span aria-hidden="true" className="textura-calida absolute inset-0" />
                          <span
                            aria-hidden="true"
                            className="absolute inset-x-0 top-[34%] -translate-y-1/2 text-center font-display text-[7rem] leading-none text-ink/15 transition-transform duration-500 ease-izao motion-reduce:transform-none group-hover:scale-105 md:text-[8rem]"
                          >
                            {c.name.trim().charAt(0).toUpperCase()}
                          </span>
                        </>
                      )}
                    </div>
                    <span className="mt-4 block font-display text-[1.625rem] leading-tight md:text-3xl">{c.name}</span>
                    <span className="mt-1 inline-flex items-center gap-1.5 text-[0.875rem] text-ink/75">
                      {T.home.verCategoria}
                      <span aria-hidden="true" className="transition-transform duration-300 ease-izao motion-reduce:transform-none group-hover:translate-x-1">
                        →
                      </span>
                    </span>
                  </Link>
                </Revelar>
              </li>
            ))}
          </ul>
        </Plana>
      );
    }

    case 'families': {
      if (contenido.familias.length === 0) return null;
      return (
        <Banda id={ID_SECCION.families} tono="banda-suave">
          <Encabezado kicker={kicker} titulo={titulo ?? T.home.queAromaQuieresHoy} bajada={bajada} />
          <ul className="flex flex-wrap gap-3 md:gap-4">
            {contenido.familias.map((f, k) => (
              <li key={f.slug}>
                <Link
                  href={`/${pais}/familia/${f.slug}`}
                  className={`tono-${k % 4} fondo-tono group elevar inline-flex min-h-14 items-center gap-3 rounded-full py-1.5 pl-1.5 pr-6 font-display text-[1.375rem]`}
                >
                  <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-full bg-bg/75">
                    {f.image ? (
                      <IzaoImage media={f.image} alt="" sizes="44px" proporcion={1} redondeo="none" className="h-full object-cover" />
                    ) : (
                      <Icono nombre={iconoFamilia(f.slug, k)} tamano={22} />
                    )}
                  </span>
                  {f.name}
                </Link>
              </li>
            ))}
          </ul>
        </Banda>
      );
    }

    case 'banner': {
      if (bannersMid.length === 0) return null;
      return <BannersMid id={ID_SECCION.banner} banners={bannersMid} pais={pais} />;
    }

    case 'collection_tabs': {
      if (contenido.colecciones.length === 0) return null;
      return (
        <Plana id={ID_SECCION.collection_tabs}>
          <Encabezado kicker={titulo ? kicker : null} titulo={titulo ?? kicker} />
          <PestanasColecciones pais={pais} colecciones={contenido.colecciones} />
        </Plana>
      );
    }

    case 'advice': {
      const t = texto(s.config['title']);
      if (!t) return null;
      const cuerpo = texto(s.config['body']);
      const cta = texto(s.config['cta_label']);
      const url = enlace(s.config['cta_url']);
      const imagen = contenido.espacios.find((e) => e.key === 'asesoria')?.media ?? null;
      return (
        <Plana id={ID_SECCION.advice}>
          <div className="textura-calida grid items-center gap-8 rounded-panel bg-surface px-6 py-12 md:grid-cols-2 md:gap-16 md:px-14 md:py-14">
            <div className="flex flex-col items-start gap-5">
              {kicker ? (
                <p className="etiqueta flex items-center gap-3 text-ink/70">
                  <span aria-hidden="true" className="h-0.5 w-8 rounded-full bg-accent" />
                  {kicker}
                </p>
              ) : null}
              <h2 className="text-4xl md:text-5xl">{t}</h2>
              {cuerpo ? <p className="max-w-prose text-lg">{cuerpo}</p> : null}
              {cta && url ? (
                <Link href={url} className={clasesBoton({ tamano: 'lg' })}>
                  {cta}
                </Link>
              ) : null}
            </div>
            {imagen ? <IzaoImage media={imagen} alt="" sizes="(min-width:768px) 45vw, 100vw" proporcion={4 / 3} redondeo="card" /> : null}
          </div>
        </Plana>
      );
    }

    case 'benefits': {
      const items = leerBeneficios(s.config);
      if (items.length === 0) return null;
      return (
        <Banda id={ID_SECCION.benefits} tono="banda-acento">
          <Encabezado kicker={kicker} titulo={titulo} />
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:gap-5">
            {items.map((b) => (
              <li key={b.titulo} className="sombra-tierna flex gap-4 rounded-card bg-bg/80 p-5 lg:flex-col lg:p-6">
                <span className="grid size-12 shrink-0 place-items-center rounded-full bg-surface">
                  <Icono nombre={b.icono} tamano={26} />
                </span>
                <div>
                  <p className="font-display text-2xl leading-tight">{b.titulo}</p>
                  {b.texto ? <p className="mt-1.5 text-[0.9375rem]">{b.texto}</p> : null}
                </div>
              </li>
            ))}
          </ul>
        </Banda>
      );
    }

    case 'reviews': {
      if (contenido.resenas.length === 0) return null;
      return (
        <Plana id={ID_SECCION.reviews}>
          <Encabezado kicker={kicker} titulo={titulo ?? T.home.resenas} />
          <ul className="sin-scroll-visible -mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-6 sm:-mx-8 sm:px-8" tabIndex={0} aria-label={titulo ?? T.home.resenas}>
            {contenido.resenas.map((r, k) => (
              <li key={r.id} className={`tono-${(k + 1) % 2 ? 0 : 1} fondo-tono sombra-tierna relative w-[82%] shrink-0 snap-start rounded-card p-6 sm:w-[26rem]`}>
                <span aria-hidden="true" className="absolute right-5 top-1 font-display text-7xl leading-none text-ink/15">
                  “
                </span>
                <p aria-label={T.home.calificacion(r.rating)} className="flex gap-0.5 pb-3">
                  {Array.from({ length: 5 }, (_, i) => (
                    <Icono key={i} nombre="estrella" tamano={16} className={i < r.rating ? 'fill-ink' : ''} />
                  ))}
                </p>
                {r.body ? <p className="font-display text-xl leading-snug">{r.body}</p> : null}
                <p className="pt-4 text-[0.875rem]">
                  {r.author_name}
                  {r.city ? `, ${r.city}` : ''}
                </p>
              </li>
            ))}
          </ul>
        </Plana>
      );
    }
  }
}

export function HomeSecciones({ contenido, pais }: { contenido: ContenidoHome; pais: CodigoPais }) {
  const bannersMid = bannersDe(contenido.banners, 'mid');
  const bannersHero = bannersDe(contenido.banners, 'hero');
  // Los banners que crea el panel salen aunque la página de inicio no tenga la sección correspondiente:
  // el carrusel `hero` siempre va arriba y los `mid` después de las colecciones (o al final).
  const hayHero = contenido.secciones.some((s) => s.type === 'hero');
  const hayMid = contenido.secciones.some((s) => s.type === 'banner');
  const indiceColecciones = contenido.secciones.findIndex((s) => s.type === 'collection_tabs');
  return (
    <>
      {!hayHero && bannersHero.length > 0 ? <CarruselBanners id={ID_SECCION.hero} banners={bannersHero} pais={pais} segundos={segundosCarrusel(null)} /> : null}
      {contenido.secciones.map((s, k) => (
        <Fragment key={s.id}>
          <Seccion s={s} contenido={contenido} pais={pais} bannersMid={bannersMid} />
          {!hayMid && bannersMid.length > 0 && k === indiceColecciones ? <BannersMid banners={bannersMid} pais={pais} /> : null}
        </Fragment>
      ))}
      {!hayMid && bannersMid.length > 0 && indiceColecciones < 0 ? <BannersMid banners={bannersMid} pais={pais} /> : null}
    </>
  );
}
