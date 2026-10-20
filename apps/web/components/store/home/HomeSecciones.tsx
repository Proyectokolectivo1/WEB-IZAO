import Link from 'next/link';
import { Icono, IzaoImage, Revelar, clasesBoton, type NombreIcono } from '@izao/ui';
import type { ContenidoHome } from '@/lib/store/repo';
import { T } from '@/lib/store/textos';
import type { Banner, CodigoPais, SeccionHome } from '@/lib/store/types';
import { ImagenResponsiva } from '../ImagenResponsiva';
import { Hero } from './Hero';
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

function Encabezado({ n, titulo, enlaceTodos, pais }: { n: number; titulo: string | null; enlaceTodos?: string; pais?: CodigoPais }) {
  return (
    <div className="mb-8 flex items-end justify-between gap-6 border-t border-ink pt-4">
      <div className="flex items-baseline gap-4">
        <span className="etiqueta text-ink/70 tabular-nums">{T.home.seccion(n)}</span>
        {titulo ? <h2 className="text-3xl md:text-5xl">{titulo}</h2> : null}
      </div>
      {enlaceTodos && pais ? (
        <Link href={`/${pais}${enlaceTodos}`} className="inline-flex min-h-11 items-center text-[0.9375rem] underline underline-offset-4">
          {T.home.verTodos}
        </Link>
      ) : null}
    </div>
  );
}

const CONTENEDOR = 'mx-auto w-full max-w-[96rem] px-4 sm:px-8';

function Seccion({ s, contenido, pais, n, bannersMid }: { s: SeccionHome; contenido: ContenidoHome; pais: CodigoPais; n: number; bannersMid: Banner[] }) {
  const titulo = texto(s.config['title']);
  switch (s.type) {
    case 'hero':
      return <Hero banners={contenido.banners.filter((b) => b.placement === 'hero')} />;

    case 'categories': {
      if (contenido.categorias.length === 0) return null;
      return (
        <section className={`${CONTENEDOR} pt-20`}>
          <Encabezado n={n} titulo={titulo} />
          <ul className="grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
            {contenido.categorias.map((c, k) => (
              <li key={c.id}>
                <Revelar indice={k}>
                  <Link href={`/${pais}/categoria/${c.slug}`} className="group block">
                    <div className="overflow-hidden">
                      <IzaoImage media={c.image} alt="" sizes="(min-width:1536px) 15vw, (min-width:1024px) 22vw, 45vw" className="transition-transform duration-500 ease-izao group-hover:scale-[1.03]" />
                    </div>
                    <span className="mt-3 block font-display text-2xl underline-offset-8 group-hover:underline">{c.name}</span>
                  </Link>
                </Revelar>
              </li>
            ))}
          </ul>
        </section>
      );
    }

    case 'families': {
      if (contenido.familias.length === 0) return null;
      return (
        <section className={`${CONTENEDOR} pt-20`}>
          <Encabezado n={n} titulo={titulo ?? T.home.queAromaQuieresHoy} />
          <ul className="flex flex-wrap gap-3">
            {contenido.familias.map((f) => (
              <li key={f.slug}>
                <Link
                  href={`/${pais}/familia/${f.slug}`}
                  className="inline-flex min-h-12 items-center rounded-md border border-ink px-6 font-display text-xl transition-colors hover:bg-ink hover:text-bg"
                >
                  {f.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      );
    }

    case 'banner': {
      const b = bannersMid[0];
      if (!b) return null;
      const contenidoBanner = (
        <div className="relative aspect-[4/5] overflow-hidden md:aspect-[12/5]">
          <ImagenResponsiva escritorio={b.desktop} movil={b.mobile} alt={b.alt} />
          {b.title || b.cta_label ? (
            <div className="absolute inset-0 flex flex-col justify-center gap-3 px-6 md:px-16" style={{ color: b.text_color && /^#[0-9a-f]{3,6}$/i.test(b.text_color) ? b.text_color : undefined }}>
              {b.subtitle ? <p className="etiqueta">{b.subtitle}</p> : null}
              {b.title ? <h2 className="max-w-lg text-4xl md:text-5xl">{b.title}</h2> : null}
              {b.cta_label ? <span className={`${clasesBoton({ tamano: 'lg' })} w-fit`}>{b.cta_label}</span> : null}
            </div>
          ) : null}
        </div>
      );
      return <section className={`${CONTENEDOR} pt-20`}>{b.link_url ? <Link href={b.link_url} aria-label={b.alt}>{contenidoBanner}</Link> : contenidoBanner}</section>;
    }

    case 'collection_tabs': {
      if (contenido.colecciones.length === 0) return null;
      return (
        <section className={`${CONTENEDOR} pt-20`}>
          <Encabezado n={n} titulo={titulo} />
          <PestanasColecciones pais={pais} colecciones={contenido.colecciones} />
        </section>
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
        <section className="mt-20 bg-surface">
          <div className={`${CONTENEDOR} grid items-center gap-8 py-14 md:grid-cols-2 md:gap-16`}>
            <div className="flex flex-col items-start gap-5">
              <span className="etiqueta text-ink/70 tabular-nums">{T.home.seccion(n)}</span>
              <h2 className="text-4xl md:text-5xl">{t}</h2>
              {cuerpo ? <p className="max-w-prose text-lg">{cuerpo}</p> : null}
              {cta && url ? (
                <Link href={url} className={clasesBoton({ tamano: 'lg' })}>
                  {cta}
                </Link>
              ) : null}
            </div>
            {imagen ? <IzaoImage media={imagen} alt="" sizes="(min-width:768px) 45vw, 100vw" proporcion={4 / 3} /> : null}
          </div>
        </section>
      );
    }

    case 'benefits': {
      const items = leerBeneficios(s.config);
      if (items.length === 0) return null;
      return (
        <section className={`${CONTENEDOR} pt-20`}>
          <Encabezado n={n} titulo={titulo} />
          <ul className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {items.map((b) => (
              <li key={b.titulo} className="flex flex-col gap-3 border-t border-line pt-5">
                <Icono nombre={b.icono} tamano={28} />
                <p className="font-display text-2xl">{b.titulo}</p>
                {b.texto ? <p className="text-[0.9375rem]">{b.texto}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      );
    }

    case 'reviews': {
      if (contenido.resenas.length === 0) return null;
      return (
        <section className={`${CONTENEDOR} pt-20`}>
          <Encabezado n={n} titulo={titulo ?? T.home.resenas} />
          <ul className="sin-scroll-visible -mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 sm:-mx-8 sm:px-8" tabIndex={0} aria-label={titulo ?? T.home.resenas}>
            {contenido.resenas.map((r) => (
              <li key={r.id} className="w-[80%] shrink-0 snap-start border border-line p-6 sm:w-[26rem]">
                <p aria-label={`${r.rating} de 5`} className="flex gap-0.5 pb-3">
                  {Array.from({ length: 5 }, (_, k) => (
                    <Icono key={k} nombre="estrella" tamano={16} className={k < r.rating ? 'fill-ink' : ''} />
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
        </section>
      );
    }
  }
}

export function HomeSecciones({ contenido, pais }: { contenido: ContenidoHome; pais: CodigoPais }) {
  const bannersMid = contenido.banners.filter((b) => b.placement === 'mid');
  let n = 0;
  return (
    <>
      {contenido.secciones.map((s) => {
        if (s.type !== 'hero') n += 1;
        return <Seccion key={s.id} s={s} contenido={contenido} pais={pais} n={n} bannersMid={bannersMid} />;
      })}
    </>
  );
}
