import { randomUUID } from 'node:crypto';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BotonConfirmar } from '@/components/admin/BotonConfirmar';
import { FormularioProducto } from '@/components/admin/FormularioProducto';
import { productoNuevo } from '@/lib/admin/catalogo/productos';
import { obtenerProductoForm, opcionesFormulario } from '@/lib/admin/catalogo/productos-servidor';
import { requerirAdmin } from '@/lib/auth/guard';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';
import { archivarProductoAccion, duplicarProductoAccion, guardarProductoAccion } from '../acciones';

export const metadata: Metadata = { title: 'Editar producto' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditarProducto({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requerirAdmin({ modulo: 'productos' });
  const { id } = await params;
  const sp = await searchParams;
  const nuevo = id === 'nuevo';
  if (!nuevo && !UUID.test(id)) notFound();

  const cliente = crearClienteServicio();
  const [producto, opciones] = await Promise.all([nuevo ? null : obtenerProductoForm(cliente, id), opcionesFormulario(cliente)]);
  if (!nuevo && !producto) notFound();
  const inicial = producto ?? productoNuevo(randomUUID);

  return (
    <>
      <p className="adm-migas">
        <Link href="/admin/productos">Productos</Link> / {nuevo ? 'Nuevo' : producto?.name}
      </p>
      <h1>{nuevo ? 'Nuevo producto' : 'Editar producto'}</h1>
      {sp.guardado ? <p className="adm-ok" role="status">Cambios guardados.</p> : null}
      {sp.duplicado ? (
        <p className="adm-ok" role="status">
          Copia creada como borrador. Cambia el SKU y vincula las variantes antes de publicarla.
        </p>
      ) : null}
      <FormularioProducto
        key={inicial.id ?? 'nuevo'}
        inicial={inicial}
        opciones={opciones}
        accion={guardarProductoAccion}
        volverHref="/admin/productos"
      />
      {producto?.id ? (
        <section className="adm-ancho-total adm-acciones" aria-label="Otras acciones" style={{ marginTop: '2rem' }}>
          <BotonConfirmar
            etiqueta="Duplicar producto"
            mensaje="Se crea una copia como borrador, oculta en todos los países y sin vínculo de MasterShop."
            etiquetaConfirmar="Sí, duplicar"
            peligro={false}
            accion={duplicarProductoAccion.bind(null, producto.id)}
          />
          {producto.status !== 'archived' ? (
            <BotonConfirmar
              etiqueta="Archivar producto"
              mensaje={`"${producto.name}" dejará de mostrarse en la tienda. Sus pedidos e historial se conservan y puedes reactivarlo cambiando el estado.`}
              etiquetaConfirmar="Sí, archivar"
              accion={archivarProductoAccion.bind(null, producto.id)}
            />
          ) : null}
        </section>
      ) : null}
    </>
  );
}
