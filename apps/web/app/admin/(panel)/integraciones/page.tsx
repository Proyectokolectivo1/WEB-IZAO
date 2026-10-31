import type { Metadata } from 'next';
import Link from 'next/link';
import { BotonAccion } from '@/components/admin/BotonAccion';
import { BotonConfirmar } from '@/components/admin/BotonConfirmar';
import {
  ETIQUETA_AMBIENTE,
  PROVEEDORES,
  ambitosDe,
  paisDb,
  type AmbienteIntegracion,
  type PaisIntegracion,
} from '@/lib/admin/integraciones/catalogo';
import {
  listarCredenciales,
  listarWebhooksMasterShop,
  type FilaCredencialPublica,
} from '@/lib/admin/integraciones/credenciales-servidor';
import { modoIntegraciones } from '@/lib/admin/integraciones/sondas';
import { requerirAdmin } from '@/lib/auth/guard';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';
import { activarCredencial, desactivarCredencial, probarConexion, registrarWebhooks } from './acciones';

export const metadata: Metadata = { title: 'Integraciones' };

const NOMBRE_PAIS: Record<PaisIntegracion, string> = { CO: 'Colombia', EC: 'Ecuador' };
const fecha = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Bogota' });

function EstadoPrueba({ f }: { f: FilaCredencialPublica }) {
  if (f.last_test_ok === null || !f.last_test_at) return <span className="adm-suave">Sin probar</span>;
  return (
    <span>
      <span className={f.last_test_ok ? 'adm-insignia adm-insignia-ok' : 'adm-insignia adm-insignia-aviso'}>
        {f.last_test_ok ? 'Conexión correcta' : 'Falló la prueba'}
      </span>{' '}
      <span className="adm-suave adm-chico">{fecha.format(new Date(f.last_test_at))}</span>
      {f.last_test_message ? (
        <span className="adm-suave adm-chico" style={{ display: 'block' }}>
          {f.last_test_message}
        </span>
      ) : null}
    </span>
  );
}

export default async function PaginaIntegraciones() {
  await requerirAdmin({ modulo: 'integraciones' });
  const cliente = crearClienteServicio();
  const filas = await listarCredenciales(cliente);
  const modo = modoIntegraciones();
  const msActiva = filas.find((f) => f.provider === 'mastershop' && f.country_code === 'CO' && f.is_active);
  const webhooks = msActiva ? await listarWebhooksMasterShop(cliente, msActiva.environment) : [];

  return (
    <>
      <div className="adm-cabecera">
        <h1>Integraciones</h1>
      </div>
      <p className="adm-suave">
        Las credenciales se guardan cifradas. Aquí solo se ve una versión enmascarada: para cambiar un secreto escribe el
        nuevo valor; si lo dejas en blanco se conserva el guardado. Solo puede haber una credencial activa por proveedor y
        país.
      </p>
      {modo === 'mock' ? (
        <p className="adm-aviso" role="status">
          Modo de pruebas: &quot;Probar conexión&quot; solo revisa el formato y no contacta a los proveedores.
        </p>
      ) : null}

      {PROVEEDORES.map((p) => (
        <section key={p.id} aria-labelledby={`h-${p.id}`}>
          <h2 id={`h-${p.id}`}>{p.nombre}</h2>
          <p className="adm-suave">{p.descripcion}</p>
          {ambitosDe(p).map((pais) => {
            const delPais = filas.filter((f) => f.provider === p.id && f.country_code === paisDb(pais));
            const nombreAmbito = pais === 'global' ? 'Todo el sitio' : NOMBRE_PAIS[pais];
            return (
              <div key={pais} className="adm-tarjeta">
                <h3>{nombreAmbito}</h3>
                <div className="adm-tabla-caja">
                  <table className="adm-tabla">
                    <caption className="adm-suave">
                      Credenciales de {p.nombre} en {nombreAmbito}
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Ambiente</th>
                        <th scope="col">Guardado</th>
                        <th scope="col">Estado</th>
                        <th scope="col">Última prueba</th>
                        <th scope="col">Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.esquema.environments.map((amb: AmbienteIntegracion) => {
                        const f = delPais.find((x) => x.environment === amb);
                        const href = `/admin/integraciones/${p.id}?pais=${pais}&ambiente=${amb}`;
                        return (
                          <tr key={amb}>
                            <th scope="row">{ETIQUETA_AMBIENTE[amb]}</th>
                            <td className="adm-chico">
                              {f ? (
                                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                                  {p.esquema.fields
                                    .filter((c) => f.masked_preview[c.key])
                                    .map((c) => (
                                      <li key={c.key}>
                                        <span className="adm-suave">{c.label}: </span>
                                        <code>{f.masked_preview[c.key]}</code>
                                      </li>
                                    ))}
                                </ul>
                              ) : (
                                <span className="adm-suave">Sin credenciales</span>
                              )}
                            </td>
                            <td>
                              {f ? (
                                f.is_active ? (
                                  <span className="adm-insignia adm-insignia-ok">Activa</span>
                                ) : (
                                  <span className="adm-insignia">Inactiva</span>
                                )
                              ) : (
                                '—'
                              )}
                            </td>
                            <td>{f ? <EstadoPrueba f={f} /> : '—'}</td>
                            <td>
                              <div className="adm-acciones" style={{ flexWrap: 'wrap' }}>
                                <Link href={href} className="adm-enlace-boton">
                                  {f ? 'Editar' : 'Agregar'}
                                </Link>
                                {f ? (
                                  <>
                                    <BotonAccion
                                      etiqueta="Probar conexión"
                                      procesando="Probando…"
                                      accion={probarConexion.bind(null, f.id)}
                                    />
                                    {f.is_active ? (
                                      <BotonConfirmar
                                        etiqueta="Desactivar"
                                        mensaje={`${p.nombre} dejará de funcionar en ${nombreAmbito} hasta que actives otra credencial. ¿Desactivar?`}
                                        etiquetaConfirmar="Sí, desactivar"
                                        accion={desactivarCredencial.bind(null, f.id)}
                                      />
                                    ) : (
                                      <BotonAccion
                                        etiqueta="Activar"
                                        procesando="Activando…"
                                        accion={activarCredencial.bind(null, f.id)}
                                        secundario={false}
                                      />
                                    )}
                                  </>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </section>
      ))}

      <section aria-labelledby="h-webhooks-ms">
        <h2 id="h-webhooks-ms">Webhooks de MasterShop</h2>
        <p className="adm-suave">
          MasterShop avisa a la tienda cuando se crea un pedido o cambia su estado. Se registran con la credencial activa
          de Colombia; los que ya estaban registrados no se duplican.
        </p>
        {msActiva ? (
          <>
            <div className="adm-tabla-caja">
              <table className="adm-tabla">
                <caption className="adm-suave">Webhooks registrados ({ETIQUETA_AMBIENTE[msActiva.environment]})</caption>
                <thead>
                  <tr>
                    <th scope="col">Evento</th>
                    <th scope="col">Estado</th>
                    <th scope="col">Registrado</th>
                  </tr>
                </thead>
                <tbody>
                  {webhooks.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="adm-suave">
                        Aún no hay webhooks registrados.
                      </td>
                    </tr>
                  ) : (
                    webhooks.map((w) => (
                      <tr key={w.event_id}>
                        <td>{w.event_name}</td>
                        <td>
                          {w.is_enabled ? (
                            <span className="adm-insignia adm-insignia-ok">Habilitado</span>
                          ) : (
                            <span className="adm-insignia">Deshabilitado</span>
                          )}
                        </td>
                        <td className="adm-suave">{fecha.format(new Date(w.registered_at))}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <BotonAccion
              etiqueta="Registrar webhooks"
              procesando="Registrando…"
              accion={registrarWebhooks.bind(null, msActiva.id)}
              secundario={false}
            />
          </>
        ) : (
          <p className="adm-vacio">Guarda y activa primero las credenciales de MasterShop para registrar los webhooks.</p>
        )}
      </section>
    </>
  );
}
