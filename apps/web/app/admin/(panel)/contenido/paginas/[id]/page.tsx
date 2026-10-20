import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BotonConfirmar } from '@/components/admin/BotonConfirmar';
import { FormularioPagina } from '@/components/admin/FormularioPagina';
import { leerPais } from '@/components/admin/PestanasPais';
import { obtenerPagina, publicadasUnicas } from '@/lib/admin/contenido/paginas-servidor';
import { requerirAdmin } from '@/lib/auth/guard';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';
import { eliminarPagina, guardarPagina } from '../acciones';

export const metadata: Metadata = { title: 'Editar página' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditarPagina({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requerirAdmin({ modulo: 'contenido' });
  const { id } = await params;
  const sp = await searchParams;
  const nueva = id === 'nueva';
  if (!nueva && !UUID.test(id)) notFound();

  const cliente = crearClienteServicio();
  const [pagina, publicadas] = await Promise.all([nueva ? null : obtenerPagina(cliente, id), publicadasUnicas(cliente)]);
  if (!nueva && !pagina) notFound();

  return (
    <>
      <p className="adm-migas">
        <Link href="/admin/contenido">Contenido</Link> / <Link href="/admin/contenido/paginas">Páginas y políticas</Link> /{' '}
        {nueva ? 'Nueva' : pagina?.title}
      </p>
      <h1>{nueva ? 'Nueva página' : 'Editar página'}</h1>
      <FormularioPagina
        accion={guardarPagina}
        volverHref="/admin/contenido/paginas"
        publicadas={publicadas.map((p) => ({ id: p.id, pais: p.country_code, tipo: p.kind, titulo: p.title }))}
        inicial={{
          ...(pagina ? { id: pagina.id } : {}),
          country_code: pagina?.country_code ?? leerPais(sp.pais),
          kind: pagina?.kind ?? 'general',
          slug: pagina?.slug ?? '',
          title: pagina?.title ?? '',
          content_html: pagina?.content_html ?? '',
          seo_title: pagina?.seo_title ?? '',
          seo_description: pagina?.seo_description ?? '',
          status: pagina?.status ?? 'draft',
          version: pagina?.version ?? null,
          actualizada: pagina?.updated_at ?? null,
        }}
      />
      {pagina ? (
        <section className="adm-form-ancho" aria-label="Zona de eliminación">
          <BotonConfirmar
            etiqueta="Eliminar página"
            mensaje={`Vas a eliminar "${pagina.title}". Solo se pueden eliminar páginas en borrador.`}
            etiquetaConfirmar="Sí, eliminar"
            accion={eliminarPagina.bind(null, pagina.id, pagina.country_code)}
          />
        </section>
      ) : null}
    </>
  );
}
