import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BotonConfirmar } from '@/components/admin/BotonConfirmar';
import { FormularioSeccionHome } from '@/components/admin/FormularioSeccionHome';
import { leerPais } from '@/components/admin/PestanasPais';
import { ETIQUETA_TIPO, esTipoSeccion, valoresDeConfig } from '@/lib/admin/home/home';
import { obtenerSeccion } from '@/lib/admin/home/servidor';
import { requerirAdmin } from '@/lib/auth/guard';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';
import { eliminarSeccion, guardarSeccion } from '../acciones';

export const metadata: Metadata = { title: 'Sección del home' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditarSeccionHome({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requerirAdmin({ modulo: 'home', accion: 'home.gestionar' });
  const { id } = await params;
  const sp = await searchParams;
  const nuevo = id === 'nuevo';
  if (!nuevo && !UUID.test(id)) notFound();

  const seccion = nuevo ? null : await obtenerSeccion(crearClienteServicio(), id);
  if (!nuevo && !seccion) notFound();
  const tipoPedido = Array.isArray(sp.tipo) ? sp.tipo[0] : sp.tipo;
  const tipo = seccion?.type ?? (esTipoSeccion(tipoPedido) ? tipoPedido : null);
  if (!tipo) notFound();
  const pais = seccion?.country_code ?? leerPais(sp.pais);
  const v = valoresDeConfig(seccion?.config ?? {});

  return (
    <>
      <p className="adm-migas">
        <Link href={`/admin/home?pais=${pais}`}>Home</Link> / {ETIQUETA_TIPO[tipo]}
      </p>
      <h1>{seccion ? ETIQUETA_TIPO[tipo] : `Nueva sección: ${ETIQUETA_TIPO[tipo].toLowerCase()}`}</h1>
      <FormularioSeccionHome
        key={seccion?.id ?? `nuevo-${tipo}`}
        accion={guardarSeccion}
        pais={pais}
        inicial={{
          ...(seccion ? { id: seccion.id } : {}),
          type: tipo,
          is_active: seccion?.is_active ?? true,
          title: v.title,
          body: v.body,
          cta_label: v.cta_label,
          cta_url: v.cta_url,
          beneficios: v.beneficios,
        }}
      />
      {seccion ? (
        <section aria-labelledby="h-acciones">
          <h2 id="h-acciones">Acciones</h2>
          <BotonConfirmar
            etiqueta="Eliminar sección"
            mensaje="Se quita esta sección del home de este país. Para ocultarla sin perder su contenido, usa «Ocultar» en la lista."
            etiquetaConfirmar="Sí, eliminar"
            accion={eliminarSeccion.bind(null, seccion.id, pais)}
          />
        </section>
      ) : null}
    </>
  );
}
