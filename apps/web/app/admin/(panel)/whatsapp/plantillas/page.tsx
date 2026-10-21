import type { Metadata } from 'next';
import Link from 'next/link';
import { PestanasPais, leerPais } from '@/components/admin/PestanasPais';
import {
  CLAVES_PLANTILLA,
  ETIQUETA_CLAVE,
  ETIQUETA_ESTADO_META,
  type EstadoMeta,
} from '@/lib/admin/whatsapp/etiquetas';
import { listarPlantillas } from '@/lib/admin/whatsapp/plantillas-servidor';
import { requerirAdmin } from '@/lib/auth/guard';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';
import { crearDesdeTextoPorDefecto } from './acciones';

export const metadata: Metadata = { title: 'Plantillas de WhatsApp' };

const fecha = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Bogota' });

function claseEstado(estado: string): string {
  if (estado === 'approved') return 'adm-insignia adm-insignia-ok';
  if (estado === 'rejected' || estado === 'paused') return 'adm-insignia adm-insignia-aviso';
  return 'adm-insignia';
}

export default async function ListaPlantillas({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requerirAdmin({ modulo: 'whatsapp' });
  const pais = leerPais((await searchParams).pais);
  const filas = await listarPlantillas(crearClienteServicio(), pais);

  return (
    <>
      <div className="adm-cabecera">
        <h1>Plantillas de WhatsApp</h1>
      </div>
      <p className="adm-suave">
        Son los mensajes de cobro y recordatorio del abono de contra entrega. Meta debe aprobar cada versión antes de usarla:
        se edita un borrador, se envía a revisión y, al aprobarse, el sistema la activa sola.
      </p>
      <PestanasPais base="/admin/whatsapp/plantillas" actual={pais} />
      {CLAVES_PLANTILLA.map((clave) => {
        const versiones = filas.filter((f) => f.key === clave);
        return (
          <section key={clave} aria-labelledby={`h-${clave}`}>
            <h2 id={`h-${clave}`}>{ETIQUETA_CLAVE[clave]}</h2>
            {versiones.length === 0 ? (
              <form action={crearDesdeTextoPorDefecto} className="adm-vacio">
                <input type="hidden" name="pais" value={pais} />
                <input type="hidden" name="clave" value={clave} />
                <p>Aún no hay plantilla de este tipo para este país.</p>
                <button type="submit" className="adm-boton adm-boton-secundario">
                  Crear con el texto por defecto
                </button>
              </form>
            ) : (
              <div className="adm-tabla-caja">
                <table className="adm-tabla">
                  <caption className="adm-suave">Versiones de {ETIQUETA_CLAVE[clave]}</caption>
                  <thead>
                    <tr>
                      <th scope="col">Versión</th>
                      <th scope="col">Nombre en Meta</th>
                      <th scope="col">Estado</th>
                      <th scope="col">En uso</th>
                      <th scope="col">Actualizada</th>
                    </tr>
                  </thead>
                  <tbody>
                    {versiones.map((f) => (
                      <tr key={f.id}>
                        <td>
                          <Link href={`/admin/whatsapp/plantillas/${f.id}`}>Versión {f.version}</Link>
                        </td>
                        <td className="adm-suave">{f.meta_template_name}</td>
                        <td>
                          <span className={claseEstado(f.meta_status)}>
                            {ETIQUETA_ESTADO_META[f.meta_status as EstadoMeta] ?? f.meta_status}
                          </span>
                          {f.meta_status === 'rejected' && f.meta_rejection_reason ? (
                            <p className="adm-chico adm-suave">Motivo: {f.meta_rejection_reason}</p>
                          ) : null}
                        </td>
                        <td>{f.is_active ? <span className="adm-insignia adm-insignia-ok">Sí</span> : 'No'}</td>
                        <td className="adm-suave">{fecha.format(new Date(f.updated_at))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
    </>
  );
}
