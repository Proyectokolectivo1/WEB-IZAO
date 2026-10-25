import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BotonConfirmar } from '@/components/admin/BotonConfirmar';
import { FormularioGasto } from '@/components/admin/FormularioGasto';
import { leerPais } from '@/components/admin/PestanasPais';
import { comprobanteDeGasto, listarCategoriasGasto, obtenerGasto } from '@/lib/admin/gastos/servidor';
import { hoyBogota } from '@/lib/admin/metricas/filtros';
import { MONEDA_PAIS, montoATexto } from '@/lib/admin/pagos/ajustes';
import { requerirAdmin } from '@/lib/auth/guard';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';
import { eliminarGasto, guardarGasto } from '../acciones';

export const metadata: Metadata = { title: 'Gasto' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditarGasto({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requerirAdmin({ modulo: 'gastos', accion: 'gastos.gestionar' });
  const { id } = await params;
  const sp = await searchParams;
  const nuevo = id === 'nuevo';
  if (!nuevo && !UUID.test(id)) notFound();

  const cliente = crearClienteServicio();
  const [gasto, categorias] = await Promise.all([nuevo ? null : obtenerGasto(cliente, id), listarCategoriasGasto(cliente)]);
  if (!nuevo && !gasto) notFound();
  const comprobante = await comprobanteDeGasto(cliente, gasto?.attachment_media_id ?? null);
  const pais = gasto?.country_code ?? leerPais(sp.pais);
  const hoy = hoyBogota(new Date());
  const volver = `/admin/gastos?pais=${pais}`;

  return (
    <>
      <p className="adm-migas">
        <Link href={volver}>Gastos</Link> / {gasto ? gasto.date : 'Nuevo'}
      </p>
      <h1>{gasto ? 'Gasto' : 'Registrar gasto'}</h1>
      {gasto && gasto.source !== 'manual' ? (
        <p className="adm-aviso" role="status">
          Este gasto lo trae una sincronización automática ({gasto.source === 'meta_ads' ? 'Meta Ads' : 'billetera de MasterShop'}) y
          no se edita a mano.
        </p>
      ) : (
        <>
          <FormularioGasto
            key={gasto?.id ?? 'nuevo'}
            accion={guardarGasto}
            volverHref={volver}
            hoy={hoy}
            categorias={categorias}
            comprobante={comprobante}
            inicial={{
              ...(gasto ? { id: gasto.id } : {}),
              country_code: pais,
              category_id: gasto?.category_id ?? '',
              date: gasto?.date ?? hoy,
              amount: gasto ? montoATexto(gasto.amount, MONEDA_PAIS[pais]) : '',
              description: gasto?.description ?? '',
            }}
          />
          {gasto ? (
            <section aria-labelledby="h-acciones">
              <h2 id="h-acciones">Acciones</h2>
              <BotonConfirmar
                etiqueta="Eliminar gasto"
                mensaje="Se borra este gasto y deja de restar de la utilidad neta. Queda registrado en la auditoría."
                etiquetaConfirmar="Sí, eliminar"
                accion={eliminarGasto.bind(null, gasto.id, gasto.country_code)}
              />
            </section>
          ) : null}
        </>
      )}
    </>
  );
}
