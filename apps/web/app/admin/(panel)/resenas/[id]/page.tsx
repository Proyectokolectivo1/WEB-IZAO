import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BotonConfirmar } from '@/components/admin/BotonConfirmar';
import { FormularioResena } from '@/components/admin/FormularioResena';
import { fechaHoraBogota } from '@/lib/admin/formato';
import { ETIQUETA_ESTADO_RESENA, ETIQUETA_FUENTE } from '@/lib/admin/resenas/resenas';
import { obtenerResena } from '@/lib/admin/resenas/servidor';
import { requerirAdmin } from '@/lib/auth/guard';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';
import { eliminarResena, guardarResena } from '../acciones';

export const metadata: Metadata = { title: 'Reseña' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function DetalleResena({ params }: { params: Promise<{ id: string }> }) {
  await requerirAdmin({ modulo: 'resenas', accion: 'resenas.gestionar' });
  const { id } = await params;
  const nuevo = id === 'nuevo';
  if (!nuevo && !UUID.test(id)) notFound();
  const r = nuevo ? null : await obtenerResena(crearClienteServicio(), id);
  if (!nuevo && !r) notFound();

  return (
    <>
      <p className="adm-migas">
        <Link href="/admin/resenas">Reseñas</Link> / {r ? r.author_name : 'Nueva'}
      </p>
      <h1>{r ? 'Reseña' : 'Escribir una reseña'}</h1>
      {r && r.source !== 'admin' ? (
        <>
          <p className="adm-aviso" role="status">
            Es una reseña de un cliente: no se edita, solo se aprueba o se rechaza desde la bandeja.
          </p>
          <p>
            <strong>{'★'.repeat(r.rating)}</strong> {r.author_name}
            {r.city ? ` · ${r.city}` : ''}
          </p>
          <p style={{ whiteSpace: 'pre-wrap' }}>{r.body ?? 'Sin texto'}</p>
          <p className="adm-suave adm-chico">
            {ETIQUETA_ESTADO_RESENA[r.status]} · {ETIQUETA_FUENTE[r.source]} · {r.products ? r.products.name : 'Reseña de la tienda'} ·{' '}
            {fechaHoraBogota(r.created_at)}
          </p>
        </>
      ) : (
        <FormularioResena
          key={r?.id ?? 'nueva'}
          accion={guardarResena}
          inicial={{
            ...(r ? { id: r.id } : {}),
            country_code: r?.country_code ?? 'CO',
            product_slug: r?.products?.slug ?? '',
            author_name: r?.author_name ?? '',
            city: r?.city ?? '',
            rating: String(r?.rating ?? 5),
            body: r?.body ?? '',
            status: r?.status ?? 'approved',
            featured_home: r?.featured_home ?? false,
          }}
        />
      )}
      {r ? (
        <section aria-labelledby="h-acciones">
          <h2 id="h-acciones">Acciones</h2>
          <BotonConfirmar
            etiqueta="Eliminar reseña"
            mensaje="Se borra la reseña para siempre (queda registrada en la auditoría). Si solo quieres ocultarla, recházala."
            etiquetaConfirmar="Sí, eliminar"
            accion={eliminarResena.bind(null, r.id)}
          />
        </section>
      ) : null}
    </>
  );
}
