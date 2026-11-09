import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BotonConfirmar } from '@/components/admin/BotonConfirmar';
import { FormularioInfluencer } from '@/components/admin/FormularioInfluencer';
import { leerPais } from '@/components/admin/PestanasPais';
import { enlaceReferido } from '@/lib/admin/descuentos/influencers';
import { codigosPorInfluencer, obtenerInfluencer } from '@/lib/admin/descuentos/influencers-servidor';
import { requerirAdmin } from '@/lib/auth/guard';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';
import { eliminarInfluencer, guardarInfluencer } from '../acciones';

export const metadata: Metadata = { title: 'Influencer' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORIGEN = process.env.SITE_URL ?? 'https://izaoperfumeria.com';

export default async function EditarInfluencer({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requerirAdmin({ modulo: 'influencers' });
  const { id } = await params;
  const sp = await searchParams;
  const nuevo = id === 'nuevo';
  if (!nuevo && !UUID.test(id)) notFound();

  const cliente = crearClienteServicio();
  const ficha = nuevo ? null : await obtenerInfluencer(cliente, id);
  if (!nuevo && !ficha) notFound();
  const codigos = ficha ? ((await codigosPorInfluencer(cliente, [ficha.id])).get(ficha.id) ?? []) : [];
  const pais = ficha?.country_code ?? leerPais(sp.pais);

  return (
    <>
      <p className="adm-migas">
        <Link href={`/admin/influencers?pais=${pais}`}>Influencers</Link> / {ficha ? ficha.name : 'Nuevo'}
      </p>
      <h1>{ficha ? ficha.name : 'Nuevo influencer'}</h1>
      {sp.guardado ? <p className="adm-ok" role="status">Cambios guardados.</p> : null}
      <FormularioInfluencer
        key={ficha?.id ?? 'nuevo'}
        paisBloqueado={codigos.length > 0}
        accion={guardarInfluencer}
        volverHref={`/admin/influencers?pais=${pais}`}
        inicial={{
          ...(ficha ? { id: ficha.id } : {}),
          name: ficha?.name ?? '',
          handle: ficha?.handle ?? '',
          country_code: pais,
          phone: ficha?.phone ?? '',
          email: ficha?.email ?? '',
          commission_pct: ficha?.commission_pct === null || ficha?.commission_pct === undefined ? '' : String(ficha.commission_pct),
          notes: ficha?.notes ?? '',
          is_active: ficha?.is_active ?? true,
        }}
      />

      {ficha ? (
        <>
          <section aria-labelledby="h-codigos">
            <h2 id="h-codigos">Códigos y enlaces de referido</h2>
            <p className="adm-suave">
              Quien entra por el enlace queda con una cookie de 30 días y el código se aplica solo en el carrito.
            </p>
            {codigos.length === 0 ? (
              <p className="adm-vacio">Este influencer aún no tiene códigos.</p>
            ) : (
              <div className="adm-tabla-caja">
                <table className="adm-tabla adm-tabla-apilada">
                  <caption className="adm-suave">Códigos de {ficha.name}</caption>
                  <thead>
                    <tr>
                      <th scope="col">Código</th>
                      <th scope="col">Usos</th>
                      <th scope="col">Enlace de referido</th>
                    </tr>
                  </thead>
                  <tbody>
                    {codigos.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <Link href={`/admin/descuentos/${c.id}`}>{c.code}</Link>
                          {c.is_active ? null : <span className="adm-insignia"> Inactivo</span>}
                        </td>
                        <td data-etiqueta="Usos">{c.usage_count}</td>
                        <td data-etiqueta="Enlace de referido">
                          <code className="adm-copiable">{enlaceReferido(ORIGEN, ficha.country_code, c.code)}</code>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p>
              <Link
                className="adm-enlace-boton adm-boton-secundario"
                href={`/admin/descuentos/nuevo?pais=${ficha.country_code}&influencer=${ficha.id}`}
              >
                Crear un código para este influencer
              </Link>{' '}
              <Link
                className="adm-enlace-boton adm-boton-secundario"
                href={`/admin/influencers/reporte?pais=${ficha.country_code}`}
              >
                Ver su reporte
              </Link>
            </p>
          </section>
          <section aria-labelledby="h-acciones">
            <h2 id="h-acciones">Acciones</h2>
            <BotonConfirmar
              etiqueta="Eliminar"
              mensaje="Se borra la ficha. Solo es posible si no tiene pedidos atribuidos; sus códigos quedan sin influencer. Si ya vendió, desactívalo."
              etiquetaConfirmar="Sí, eliminar"
              accion={eliminarInfluencer.bind(null, ficha.id)}
            />
          </section>
        </>
      ) : null}
    </>
  );
}
