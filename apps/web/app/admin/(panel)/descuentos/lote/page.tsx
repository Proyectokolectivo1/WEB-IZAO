import type { Metadata } from 'next';
import Link from 'next/link';
import { FormularioCodigo } from '@/components/admin/FormularioCodigo';
import { leerPais } from '@/components/admin/PestanasPais';
import { CODIGO_NUEVO } from '@/lib/admin/descuentos/codigos';
import { listarCategoriasOpciones, listarInfluencersOpciones } from '@/lib/admin/descuentos/codigos-servidor';
import { requerirAdmin } from '@/lib/auth/guard';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';
import { crearLote } from '../acciones';

export const metadata: Metadata = { title: 'Generar lote de códigos' };

export default async function GenerarLote({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requerirAdmin({ modulo: 'descuentos' });
  const pais = leerPais((await searchParams).pais);
  const cliente = crearClienteServicio();
  const [categorias, influencers] = await Promise.all([listarCategoriasOpciones(cliente), listarInfluencersOpciones(cliente)]);

  return (
    <>
      <p className="adm-migas">
        <Link href={`/admin/descuentos?pais=${pais}`}>Descuentos</Link> / Generar lote
      </p>
      <h1>Generar lote de códigos</h1>
      <p className="adm-suave">
        Crea varios códigos únicos con la misma regla, útiles para campañas, sorteos o el pop-up. Después los descargas en
        Excel desde la lista.
      </p>
      <FormularioCodigo
        modo="lote"
        inicial={{ ...CODIGO_NUEVO, country_code: pais }}
        categorias={categorias.map((c) => ({ id: c.id, etiqueta: c.name }))}
        influencers={influencers
          .filter((i) => i.is_active)
          .map((i) => ({ id: i.id, etiqueta: i.handle ? `${i.name} (@${i.handle})` : i.name, pais: i.country_code }))}
        accion={crearLote}
        volverHref={`/admin/descuentos?pais=${pais}`}
      />
    </>
  );
}
