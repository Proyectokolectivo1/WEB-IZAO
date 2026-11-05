import type { Metadata } from 'next';
import Link from 'next/link';
import { PestanasPais, leerPais } from '@/components/admin/PestanasPais';
import { ETIQUETA_TIPO, ORIGEN_CONTENIDO, TIPOS_SECCION } from '@/lib/admin/home/home';
import { listarSecciones } from '@/lib/admin/home/servidor';
import { requerirAdmin } from '@/lib/auth/guard';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';
import { alternarSeccion, moverSeccion } from './acciones';

export const metadata: Metadata = { title: 'Home' };

export default async function PaginaHome({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requerirAdmin({ modulo: 'home', accion: 'home.gestionar' });
  const sp = await searchParams;
  const pais = leerPais(sp.pais);
  const secciones = await listarSecciones(crearClienteServicio(), pais);

  return (
    <>
      <h1>Home</h1>
      <p className="adm-suave">
        Orden y activación de las secciones de la página de inicio de cada país. Sube o baja una sección con las flechas;
        desactívala para ocultarla sin perder su contenido. La barra de anuncios y el pie de página no se mueven.
      </p>
      {sp.guardado ? <p className="adm-ok" role="status">Sección guardada.</p> : null}
      {sp.eliminado ? <p className="adm-ok" role="status">Sección eliminada.</p> : null}
      {sp.error ? (
        <p className="adm-alerta" role="alert">
          No se pudo completar el cambio. Recarga la página e inténtalo de nuevo.
        </p>
      ) : null}
      <PestanasPais base="/admin/home" actual={pais} />

      {secciones.length === 0 ? (
        <p className="adm-vacio">Este país aún no tiene secciones. Agrega la primera abajo.</p>
      ) : (
        <ol className="adm-lista-simple">
          {secciones.map((s, i) => (
            <li key={s.id} className="adm-tarjeta">
              <div className="adm-fila">
                <p>
                  <span className="adm-suave">{String(i + 1).padStart(2, '0')}</span>{' '}
                  <strong>{ETIQUETA_TIPO[s.type]}</strong>{' '}
                  {typeof s.config.title === 'string' && s.config.title ? <span className="adm-suave">«{s.config.title}»</span> : null}{' '}
                  <span className={s.is_active ? 'adm-insignia adm-insignia-ok' : 'adm-insignia'}>{s.is_active ? 'Visible' : 'Oculta'}</span>
                </p>
                <p className="adm-suave adm-chico">
                  Contenido: {ORIGEN_CONTENIDO[s.type]}
                  {s.type === 'hero' || s.type === 'banner' ? (
                    <>
                      {' · '}
                      <Link href={`/admin/banners?pais=${pais}&ubicacion=${s.type === 'hero' ? 'hero' : 'mid'}`}>Editar banners</Link>
                    </>
                  ) : null}
                </p>
              </div>
              <div className="adm-acciones">
                <form action={moverSeccion.bind(null, s.id, 'arriba', pais)}>
                  <button type="submit" className="adm-boton adm-boton-secundario" disabled={i === 0} aria-label={`Subir ${ETIQUETA_TIPO[s.type]}`}>
                    Subir
                  </button>
                </form>
                <form action={moverSeccion.bind(null, s.id, 'abajo', pais)}>
                  <button type="submit" className="adm-boton adm-boton-secundario" disabled={i === secciones.length - 1} aria-label={`Bajar ${ETIQUETA_TIPO[s.type]}`}>
                    Bajar
                  </button>
                </form>
                <form action={alternarSeccion.bind(null, s.id, !s.is_active, pais)}>
                  <button type="submit" className="adm-boton adm-boton-secundario">
                    {s.is_active ? 'Ocultar' : 'Mostrar'}
                  </button>
                </form>
                <Link href={`/admin/home/${s.id}?pais=${pais}`} className="adm-enlace-boton">
                  Editar
                </Link>
              </div>
            </li>
          ))}
        </ol>
      )}

      <section aria-labelledby="h-agregar">
        <h2 id="h-agregar">Agregar una sección</h2>
        <ul className="adm-lista-simple">
          {TIPOS_SECCION.map((t) => (
            <li key={t}>
              <Link href={`/admin/home/nuevo?pais=${pais}&tipo=${t}`}>{ETIQUETA_TIPO[t]}</Link>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
