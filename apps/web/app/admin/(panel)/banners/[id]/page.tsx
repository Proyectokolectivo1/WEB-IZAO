import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BotonConfirmar } from '@/components/admin/BotonConfirmar';
import { FormularioBanner, type ValoresBanner } from '@/components/admin/FormularioBanner';
import { leerPais } from '@/components/admin/PestanasPais';
import { isoAFechaLocal, leerUbicacion, ETIQUETA_UBICACION } from '@/lib/admin/banners/banners';
import {
  categoriasVisibles,
  destinoEditable,
  leerFocal,
  obtenerBanner,
  variantesDeProducto,
  type MediaMini,
} from '@/lib/admin/banners/servidor';
import { requerirAdmin } from '@/lib/auth/guard';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';
import { buscarProductosBanner, eliminarBanner, guardarBanner, variantesBanner } from '../acciones';

export const metadata: Metadata = { title: 'Banner' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditarBanner({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requerirAdmin({ modulo: 'banners' });
  const { id } = await params;
  const sp = await searchParams;
  const nuevo = id === 'nuevo';
  if (!nuevo && !UUID.test(id)) notFound();

  const cliente = crearClienteServicio();
  const banner = nuevo ? null : await obtenerBanner(cliente, id);
  if (!nuevo && !banner) notFound();

  const pais = banner?.country_code ?? leerPais(sp.pais);
  const ubicacion = banner?.placement ?? leerUbicacion(sp.ubicacion);
  const volverHref = `/admin/banners?pais=${pais}&ubicacion=${ubicacion}`;

  const [categorias, destino, focal] = await Promise.all([
    categoriasVisibles(cliente, pais),
    destinoEditable(cliente, pais, banner?.link_url ?? null),
    leerFocal(cliente, banner?.id ?? null),
  ]);
  const variantes = destino.producto ? await variantesDeProducto(cliente, destino.producto.id, pais) : [];

  const inicial: ValoresBanner = {
    ...(banner ? { id: banner.id } : {}),
    country_code: pais,
    placement: ubicacion,
    category_id: banner?.category_id ?? '',
    alt: banner?.alt ?? '',
    title: banner?.title ?? '',
    subtitle: banner?.subtitle ?? '',
    cta_label: banner?.cta_label ?? '',
    text_position: banner?.text_position ?? 'left',
    text_color: banner?.text_color ?? '',
    starts_at: isoAFechaLocal(banner?.starts_at),
    ends_at: isoAFechaLocal(banner?.ends_at),
    is_active: banner?.is_active ?? true,
    destino_tipo: destino.tipo,
    destino_producto: destino.producto,
    destino_variante_id: destino.varianteId ?? '',
    destino_categoria_id: destino.categoriaId ?? '',
    destino_seccion: destino.seccion,
    destino_url: destino.url,
  };
  const imagen = (m: MediaMini | null, grande = true) => (m ? { id: m.id, ruta: grande ? m.rutaPrevia : m.ruta, alt: m.alt } : null);
  const error = typeof sp.error === 'string' ? sp.error : null;

  return (
    <>
      <p className="adm-migas">
        <Link href={volverHref}>Banners</Link> / {ETIQUETA_UBICACION[ubicacion]} / {nuevo ? 'Nuevo' : (banner?.title ?? banner?.alt)}
      </p>
      <h1>{nuevo ? 'Nuevo banner' : 'Editar banner'}</h1>
      {error ? <p className="adm-alerta" role="alert">{error}</p> : null}
      <FormularioBanner
        key={banner?.id ?? 'nuevo'}
        inicial={inicial}
        categorias={categorias.map((c) => ({ valor: c.id, etiqueta: c.name }))}
        escritorio={imagen(banner?.desktop ?? null)}
        movil={banner?.movil_propia ? imagen(banner.mobile, false) : null}
        focal={focal}
        variantesIniciales={variantes}
        buscarProductos={buscarProductosBanner}
        cargarVariantes={variantesBanner}
        accion={guardarBanner}
        volverHref={volverHref}
      />
      {banner ? (
        <section className="adm-pila" aria-labelledby="h-eliminar-banner">
          <h2 id="h-eliminar-banner">Eliminar banner</h2>
          <BotonConfirmar
            etiqueta="Eliminar este banner"
            mensaje="El banner dejará de mostrarse y no se puede recuperar. Si solo quieres ocultarlo un tiempo, desactívalo."
            etiquetaConfirmar="Sí, eliminar"
            accion={eliminarBanner.bind(null, pais, ubicacion, banner.id)}
          />
        </section>
      ) : null}
    </>
  );
}
