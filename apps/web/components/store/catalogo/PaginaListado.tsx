import { notFound } from 'next/navigation';
import { cargarInicial } from '@/lib/store/listado-servidor';
import { tienda } from '@/lib/store/datos';
import { TAMANO_LOTE, parsearEstado } from '@/lib/store/filtros';
import { hrefListado } from '@/lib/store/lote';
import { SITIO, jsonLd } from '@/lib/store/seo';
import type { CodigoPais, FiltrosCatalogo } from '@/lib/store/types';
import { ListadoCatalogo } from './ListadoCatalogo';

export type ParamsBusqueda = Record<string, string | string[] | undefined>;

interface Props {
  pais: CodigoPais;
  titulo: string;
  descripcion?: string | null;
  /** Ruta del listado sin parámetros. */
  base: string;
  /** Filtros que fija la ruta. */
  fijos?: FiltrosCatalogo;
  searchParams: ParamsBusqueda;
  esBusqueda?: boolean;
}

/** Listado de producto compartido por catálogo, búsqueda y las páginas por categoría, marca, familia y colección. */
export async function PaginaListado({ pais, titulo, descripcion, base, fijos = {}, searchParams, esBusqueda = false }: Props) {
  const estado = parsearEstado(searchParams);
  const consulta = { q: esBusqueda ? estado.q : '', filtros: estado.filtros, orden: estado.orden };
  const repo = tienda();
  const [inicial, opciones] = await Promise.all([cargarInicial(repo, pais, consulta, fijos, estado.pagina), repo.opcionesFiltros(pais)]);

  if (inicial.fueraDeRango) notFound();

  const lista = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: titulo,
    url: `${SITIO}${hrefListado(base, consulta, fijos, estado.pagina)}`,
    mainEntity: {
      '@type': 'ItemList',
      itemListElement: inicial.items.map((p, i) => ({
        '@type': 'ListItem',
        position: (estado.pagina - 1) * TAMANO_LOTE + i + 1,
        url: `${SITIO}/${pais}/perfume/${p.slug}`,
        name: p.name,
      })),
    },
  };

  return (
    <>
      <ListadoCatalogo
        key={`${base}?${JSON.stringify(consulta)}|${estado.pagina}`}
        pais={pais}
        titulo={titulo}
        descripcion={descripcion}
        base={base}
        fijos={fijos}
        consulta={consulta}
        pagina={estado.pagina}
        inicial={{ items: inicial.items, nextCursor: inicial.nextCursor, total: inicial.total }}
        opciones={opciones}
        esBusqueda={esBusqueda}
      />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(lista) }} />
    </>
  );
}
