import type { Metadata } from 'next';
import Link from 'next/link';
import { BotonConfirmar } from '@/components/admin/BotonConfirmar';
import { fechaHoraBogota } from '@/lib/admin/formato';
import { estadoColas } from '@/lib/admin/sistema/colas';
import { erroresRecientes, volumenDeDatos } from '@/lib/admin/sistema/servidor';
import { requerirAdmin } from '@/lib/auth/guard';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';
import { reintentarJob } from './acciones';

export const metadata: Metadata = { title: 'Sistema' };

const numero = new Intl.NumberFormat('es-CO');

export default async function PaginaSistema({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requerirAdmin({ modulo: 'sistema' });
  const sp = await searchParams;
  const cliente = crearClienteServicio();
  const [colas, errores, volumen] = await Promise.all([estadoColas(), erroresRecientes(cliente), volumenDeDatos(cliente)]);

  return (
    <>
      <div className="adm-cabecera">
        <h1>Sistema</h1>
        <Link href="/admin/sistema/auditoria" className="adm-enlace-boton adm-boton-secundario">
          Ver la auditoría
        </Link>
      </div>
      {sp.reintentado ? <p className="adm-ok" role="status">Job reintentado. En unos segundos debería procesarse.</p> : null}

      <section aria-labelledby="h-colas">
        <h2 id="h-colas">Colas</h2>
        {colas.disponible ? (
          <>
            <div className="adm-tabla-caja">
              <table className="adm-tabla adm-tabla-apilada">
                <caption className="adm-suave">Trabajos en segundo plano por cola</caption>
                <thead>
                  <tr>
                    <th scope="col">Cola</th>
                    <th scope="col">En espera</th>
                    <th scope="col">En proceso</th>
                    <th scope="col">Programados</th>
                    <th scope="col">Fallidos</th>
                    <th scope="col">Completados</th>
                  </tr>
                </thead>
                <tbody>
                  {colas.colas.map((c) => (
                    <tr key={c.nombre}>
                      <th scope="row">{c.etiqueta}</th>
                      <td data-etiqueta="En espera">{c.conteos.waiting}</td>
                      <td data-etiqueta="En proceso">{c.conteos.active}</td>
                      <td data-etiqueta="Programados">{c.conteos.delayed}</td>
                      <td data-etiqueta="Fallidos">{c.conteos.failed > 0 ? <span className="adm-insignia adm-insignia-aviso">{c.conteos.failed}</span> : 0}</td>
                      <td data-etiqueta="Completados" className="adm-suave">{c.conteos.completed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {colas.colas.flatMap((c) => c.fallidos.map((j) => ({ c, j }))).length === 0 ? (
              <p className="adm-suave">No hay trabajos fallidos.</p>
            ) : (
              <>
                <h3>Trabajos fallidos</h3>
                <ul className="adm-lista-simple">
                  {colas.colas.flatMap((c) =>
                    c.fallidos.map((j) => (
                      <li key={`${c.nombre}-${j.id}`} className="adm-tarjeta">
                        <p>
                          <strong>{c.etiqueta}</strong> · {j.job}{' '}
                          <span className="adm-suave adm-chico">
                            · {j.intentos} intento(s){j.cuando ? ` · ${fechaHoraBogota(j.cuando)}` : ''}
                          </span>
                        </p>
                        <p className="adm-suave adm-chico">{j.motivo}</p>
                        <BotonConfirmar
                          etiqueta="Reintentar"
                          mensaje="Se vuelve a ejecutar este trabajo. Es seguro: los trabajos de Izao no duplican efectos."
                          etiquetaConfirmar="Sí, reintentar"
                          peligro={false}
                          accion={reintentarJob.bind(null, c.nombre, j.id)}
                        />
                      </li>
                    )),
                  )}
                </ul>
              </>
            )}
          </>
        ) : (
          <p className="adm-alerta" role="alert">
            {colas.motivo}
          </p>
        )}
      </section>

      <section aria-labelledby="h-errores">
        <h2 id="h-errores">Errores recientes</h2>
        <p>
          Pedidos con error de transportadora:{' '}
          <Link href="/admin/pedidos?estado=error_transportadora">
            <strong>{errores.pedidosErrorTransportadora}</strong>
          </Link>
        </p>

        <h3>Webhooks sin procesar</h3>
        {errores.webhooks.length === 0 ? (
          <p className="adm-vacio">Ninguno.</p>
        ) : (
          <ul className="adm-lista-simple">
            {errores.webhooks.map((w) => (
              <li key={w.id}>
                <strong>{w.provider}</strong> <span className="adm-suave adm-chico">· {fechaHoraBogota(w.created_at)}</span>
                <p className="adm-suave adm-chico">{w.error.slice(0, 200)}</p>
              </li>
            ))}
          </ul>
        )}

        <h3>Impresiones fallidas</h3>
        {errores.impresiones.length === 0 ? (
          <p className="adm-vacio">Ninguna.</p>
        ) : (
          <ul className="adm-lista-simple">
            {errores.impresiones.map((i) => (
              <li key={i.id}>
                {i.type} <span className="adm-suave adm-chico">· {i.attempts} intento(s) · {fechaHoraBogota(i.created_at)}</span>
                <p className="adm-suave adm-chico">{(i.error ?? 'Sin detalle').slice(0, 200)}</p>
              </li>
            ))}
          </ul>
        )}

        <h3>Mensajes de WhatsApp fallidos</h3>
        {errores.whatsapp.length === 0 ? (
          <p className="adm-vacio">Ninguno.</p>
        ) : (
          <ul className="adm-lista-simple">
            {errores.whatsapp.map((m) => (
              <li key={m.id}>
                {m.order_id ? <Link href={`/admin/pedidos/${m.order_id}`}>Ver pedido</Link> : 'Sin pedido'}{' '}
                <span className="adm-suave adm-chico">· {fechaHoraBogota(m.created_at)} · {m.error_code ?? 'sin código'}</span>
                {m.error_text ? <p className="adm-suave adm-chico">{m.error_text.slice(0, 200)}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="h-volumen">
        <h2 id="h-volumen">Volumen de datos</h2>
        <p className="adm-suave">
          Filas aproximadas de las tablas que más crecen. El plan gratuito de Supabase limita la base a 500 MB; el tamaño exacto y
          los respaldos se revisan en Supabase y en el servidor (ver el manual de operación).
        </p>
        <div className="adm-tabla-caja">
          <table className="adm-tabla">
            <caption className="adm-visualmente-oculto">Filas por tabla</caption>
            <thead>
              <tr>
                <th scope="col">Tabla</th>
                <th scope="col">Filas</th>
              </tr>
            </thead>
            <tbody>
              {volumen.map((v) => (
                <tr key={v.tabla}>
                  <th scope="row">{v.etiqueta}</th>
                  <td>{numero.format(v.filas)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
