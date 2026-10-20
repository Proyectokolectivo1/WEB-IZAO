import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BotonConfirmar } from '@/components/admin/BotonConfirmar';
import { FormularioTaxonomia } from '@/components/admin/FormularioTaxonomia';
import { TAXONOMIAS, esTipoTaxonomia } from '@/lib/admin/catalogo/taxonomias';
import { obtenerTaxonomia } from '@/lib/admin/catalogo/taxonomias-servidor';
import { requerirAdmin } from '@/lib/auth/guard';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';
import { eliminarTaxonomia, guardarTaxonomia } from '../../acciones';

export const metadata: Metadata = { title: 'Editar atributo' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditarAtributo({ params }: { params: Promise<{ tipo: string; id: string }> }) {
  await requerirAdmin({ modulo: 'catalogo_auxiliar' });
  const { tipo, id } = await params;
  if (!esTipoTaxonomia(tipo)) notFound();
  const def = TAXONOMIAS[tipo];
  const nuevo = id === 'nuevo';
  if (!nuevo && !UUID.test(id)) notFound();

  const fila = nuevo ? null : await obtenerTaxonomia(crearClienteServicio(), def, id);
  if (!nuevo && !fila) notFound();

  const volver = `/admin/atributos/${tipo}`;
  return (
    <>
      <p className="adm-migas">
        <Link href={volver}>{def.plural}</Link> / {nuevo ? `Nueva ${def.singular}` : fila?.name}
      </p>
      <h1>{nuevo ? `Nueva ${def.singular}` : `Editar ${def.singular}`}</h1>
      <FormularioTaxonomia
        campos={{
          tieneDescripcion: def.tieneDescripcion,
          tieneImagen: def.tieneImagen,
          tieneOrden: def.tieneOrden,
          ayudaImagen: def.ayudaImagen,
        }}
        inicial={{
          ...(fila ? { id: fila.id } : {}),
          name: fila?.name ?? '',
          slug: fila?.slug ?? '',
          description: fila?.description ?? '',
          sort_order: fila?.sort_order ?? 0,
          imagen: fila?.imagen && fila.image_id ? { id: fila.image_id, ...fila.imagen } : null,
        }}
        accion={guardarTaxonomia.bind(null, tipo)}
        volverHref={volver}
      />
      {fila ? (
        <section className="adm-form-ancho" aria-label="Zona de eliminación">
          <BotonConfirmar
            etiqueta={`Eliminar ${def.singular}`}
            mensaje={`Vas a eliminar "${fila.name}". Si algún producto la usa, no se eliminará.`}
            etiquetaConfirmar="Sí, eliminar"
            accion={eliminarTaxonomia.bind(null, tipo, fila.id)}
          />
        </section>
      ) : null}
    </>
  );
}
