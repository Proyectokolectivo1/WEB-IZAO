import type { Metadata } from 'next';
import Link from 'next/link';
import { FormularioCarrusel } from '@/components/admin/FormularioCarrusel';
import { leerPais, PestanasPais } from '@/components/admin/PestanasPais';
import {
  AYUDA_UBICACION,
  destinoDeUrl,
  ETIQUETA_UBICACION,
  ETIQUETA_VIGENCIA,
  estadoVigencia,
  leerUbicacion,
  NOMBRE_PAIS_BANNER,
  SECCIONES_TIENDA,
  UBICACIONES,
  type Destino,
} from '@/lib/admin/banners/banners';
import { conteoPorUbicacion, leerAjustesCarrusel, listarBanners } from '@/lib/admin/banners/servidor';
import { fechaHoraBogota } from '@/lib/admin/formato';
import { requerirAdmin } from '@/lib/auth/guard';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';
import { alternarBanner, guardarAjustesCarrusel, moverBanner } from './acciones';

export const metadata: Metadata = { title: 'Banners' };

function textoDestino(d: Destino): string {
  switch (d.tipo) {
    case 'ninguno':
      return 'Sin enlace';
    case 'producto':
      return `Lleva al producto «${d.slug}»${d.sku ? ` (variante ${d.sku})` : ''}`;
    case 'categoria':
      return `Lleva a la categoría «${d.slug}»`;
    case 'seccion':
      return `Lleva a la sección «${SECCIONES_TIENDA.find((s) => s.clave === d.clave)?.etiqueta ?? d.clave}»`;
    case 'url':
      return `Lleva a ${d.url}`;
  }
}

export default async function ListaBanners({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requerirAdmin({ modulo: 'banners' });
  const sp = await searchParams;
  const pais = leerPais(sp.pais);
  const ubicacion = leerUbicacion(sp.ubicacion);
  const cliente = crearClienteServicio();
  const [filas, conteos, carrusel] = await Promise.all([
    listarBanners(cliente, pais, ubicacion),
    conteoPorUbicacion(cliente, pais),
    ubicacion === 'hero' ? leerAjustesCarrusel(cliente, pais) : Promise.resolve(null),
  ]);
  const error = typeof sp.error === 'string' ? sp.error : null;
  const nuevo = `/admin/banners/nuevo?pais=${pais}&ubicacion=${ubicacion}`;

  return (
    <>
      <div className="adm-cabecera">
        <h1>Banners</h1>
        <div className="adm-acciones">
          <Link href={nuevo} className="adm-enlace-boton">
            Nuevo banner
          </Link>
        </div>
      </div>
      <p className="adm-suave">
        Cada país tiene sus propios banners. Lo que actives aquí aparece en la tienda en pocos minutos; el orden de esta lista
        es el del carrusel.
      </p>
      <PestanasPais base="/admin/banners" actual={pais} />
      <ul className="adm-pestanas ban-pestanas" aria-label="Ubicación">
        {UBICACIONES.map((u) => (
          <li key={u}>
            <Link href={`/admin/banners?pais=${pais}&ubicacion=${u}`} aria-current={u === ubicacion ? 'page' : undefined}>
              {ETIQUETA_UBICACION[u]} ({conteos[u]})
            </Link>
          </li>
        ))}
        <li>
          <Link href={`/admin/banners/cinta?pais=${pais}`}>Cinta superior</Link>
        </li>
      </ul>
      <p className="adm-suave adm-chico">{AYUDA_UBICACION[ubicacion]}</p>
      {carrusel ? (
        <FormularioCarrusel key={`${pais}-${carrusel.segundos}-${carrusel.enCatalogo}`} pais={pais} segundos={carrusel.segundos} enCatalogo={carrusel.enCatalogo} accion={guardarAjustesCarrusel} />
      ) : null}
      {sp.guardado ? <p className="adm-ok" role="status">Banner guardado.</p> : null}
      {sp.eliminado ? <p className="adm-ok" role="status">Banner eliminado.</p> : null}
      {error ? <p className="adm-alerta" role="alert">{error}</p> : null}

      {filas.length === 0 ? (
        <p className="adm-vacio">
          Aún no hay banners ({ETIQUETA_UBICACION[ubicacion].toLowerCase()}) para {NOMBRE_PAIS_BANNER[pais]}.{' '}
          <Link href={nuevo}>Crear el primero</Link>
        </p>
      ) : (
        <ol className="ban-lista" aria-label={`${ETIQUETA_UBICACION[ubicacion]} de ${NOMBRE_PAIS_BANNER[pais]}, en orden`}>
          {filas.map((f, i) => {
            const estado = estadoVigencia(f);
            return (
              <li key={f.id} className="ban-tarjeta" data-estado={estado}>
                <div className="ban-miniaturas">
                  {f.desktop ? (
                    <img className="ban-min-escritorio" src={`/media/${f.desktop.ruta}`} alt={f.movil_propia ? `Escritorio: ${f.alt}` : f.alt} loading="lazy" />
                  ) : null}
                  {f.mobile && f.movil_propia ? (
                    <img className="ban-min-movil" src={`/media/${f.mobile.ruta}`} alt={`Móvil: ${f.alt}`} loading="lazy" />
                  ) : null}
                </div>
                <div className="ban-info">
                  <h2>
                    <Link href={`/admin/banners/${f.id}`}>{f.title ?? f.alt}</Link>
                  </h2>
                  <p className="ban-meta">
                    <span
                      className={`adm-insignia ${estado === 'vigente' ? 'adm-insignia-ok' : estado === 'programado' ? 'adm-insignia-aviso' : ''}`.trim()}
                    >
                      {ETIQUETA_VIGENCIA[estado]}
                    </span>{' '}
                    Posición {i + 1}
                  </p>
                  <p className="ban-meta">{textoDestino(destinoDeUrl(f.link_url))}</p>
                  {f.starts_at || f.ends_at ? (
                    <p className="ban-meta">
                      {f.starts_at ? `Desde ${fechaHoraBogota(f.starts_at)}` : 'Sin fecha de inicio'}
                      {' · '}
                      {f.ends_at ? `hasta ${fechaHoraBogota(f.ends_at)}` : 'sin fecha de fin'}
                    </p>
                  ) : null}
                </div>
                <div className="ban-controles">
                  <span className="ban-orden">
                    <form action={moverBanner.bind(null, pais, ubicacion, f.id, 'arriba')}>
                      <button type="submit" className="adm-boton adm-boton-secundario" disabled={i === 0} aria-label={`Subir «${f.title ?? f.alt}»`}>
                        ↑
                      </button>
                    </form>
                    <form action={moverBanner.bind(null, pais, ubicacion, f.id, 'abajo')}>
                      <button
                        type="submit"
                        className="adm-boton adm-boton-secundario"
                        disabled={i === filas.length - 1}
                        aria-label={`Bajar «${f.title ?? f.alt}»`}
                      >
                        ↓
                      </button>
                    </form>
                  </span>
                  <form action={alternarBanner.bind(null, pais, ubicacion, f.id, !f.is_active)}>
                    <button type="submit" className="adm-boton adm-boton-secundario">
                      {f.is_active ? 'Desactivar' : 'Activar'}
                    </button>
                  </form>
                  <Link href={`/admin/banners/${f.id}`} className="adm-enlace-boton adm-boton-secundario">
                    Editar
                  </Link>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}
