import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BotonConfirmar } from '@/components/admin/BotonConfirmar';
import { FormularioCategoria } from '@/components/admin/FormularioCategoria';
import { listarCategorias, obtenerCategoria } from '@/lib/admin/catalogo/categorias-servidor';
import { requerirAdmin } from '@/lib/auth/guard';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';
import { eliminarCategoria, guardarCategoria } from '../acciones';

export const metadata: Metadata = { title: 'Editar categoría' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditarCategoria({ params }: { params: Promise<{ id: string }> }) {
  await requerirAdmin({ modulo: 'categorias' });
  const { id } = await params;
  const nueva = id === 'nueva';
  if (!nueva && !UUID.test(id)) notFound();

  const cliente = crearClienteServicio();
  const [cat, todas] = await Promise.all([nueva ? null : obtenerCategoria(cliente, id), listarCategorias(cliente)]);
  if (!nueva && !cat) notFound();

  const padres = todas
    .filter((c) => !c.parent_id && c.id !== cat?.id)
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'es'))
    .map((c) => ({ valor: c.id, etiqueta: c.name }));

  return (
    <>
      <p className="adm-migas">
        <Link href="/admin/categorias">Categorías</Link> / {nueva ? 'Nueva' : cat?.name}
      </p>
      <h1>{nueva ? 'Nueva categoría' : 'Editar categoría'}</h1>
      <FormularioCategoria
        padres={padres}
        accion={guardarCategoria}
        volverHref="/admin/categorias"
        inicial={{
          ...(cat ? { id: cat.id } : {}),
          name: cat?.name ?? '',
          slug: cat?.slug ?? '',
          parent_id: cat?.parent_id ?? '',
          description: cat?.description ?? '',
          seo_title: cat?.seo_title ?? '',
          seo_description: cat?.seo_description ?? '',
          sort_order: cat?.sort_order ?? 0,
          show_in_menu: cat?.show_in_menu ?? true,
          paises: cat?.paises ?? { CO: { is_visible: true, sort_order: 0 }, EC: { is_visible: true, sort_order: 0 } },
          imagen: cat?.imagen ?? null,
          banner: cat?.banner ?? null,
          tieneHijos: cat?.tieneHijos ?? false,
        }}
      />
      {cat ? (
        <section className="adm-form-ancho" aria-label="Zona de eliminación">
          <BotonConfirmar
            etiqueta="Eliminar categoría"
            mensaje={`Vas a eliminar "${cat.name}". Solo se elimina si no tiene subcategorías, productos ni banners.`}
            etiquetaConfirmar="Sí, eliminar"
            accion={eliminarCategoria.bind(null, cat.id)}
          />
        </section>
      ) : null}
    </>
  );
}
