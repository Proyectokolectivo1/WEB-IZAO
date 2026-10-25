import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BotonConfirmar } from '@/components/admin/BotonConfirmar';
import { FormularioContrasena, FormularioEditarUsuario, FormularioNuevoUsuario } from '@/components/admin/FormularioUsuario';
import { fechaHoraBogota } from '@/lib/admin/formato';
import { obtenerUsuario } from '@/lib/admin/usuarios/servidor';
import { esIdUsuario } from '@/lib/admin/usuarios/usuarios';
import { requerirAdmin } from '@/lib/auth/guard';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';
import { crearUsuario, editarUsuario, reiniciarMfa, restablecerContrasena } from '../acciones';

export const metadata: Metadata = { title: 'Usuario' };

export default async function DetalleUsuario({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const admin = await requerirAdmin({ modulo: 'usuarios', accion: 'usuarios.gestionar' });
  const { id } = await params;
  const sp = await searchParams;

  if (id === 'nuevo') {
    return (
      <>
        <p className="adm-migas">
          <Link href="/admin/usuarios">Usuarios</Link> / Nuevo
        </p>
        <h1>Nuevo usuario</h1>
        <FormularioNuevoUsuario accion={crearUsuario} />
      </>
    );
  }
  if (!esIdUsuario(id)) notFound();
  const u = await obtenerUsuario(crearClienteServicio(), id);
  if (!u) notFound();

  return (
    <>
      <p className="adm-migas">
        <Link href="/admin/usuarios">Usuarios</Link> / {u.nombre}
      </p>
      <h1>{u.nombre}</h1>
      <p className="adm-suave">
        {u.correo ?? 'Sin cuenta de acceso'} · último ingreso: {fechaHoraBogota(u.ultimoIngreso)} · verificación en dos pasos:{' '}
        {u.mfaActivo ? 'activa' : 'pendiente'}
      </p>
      {sp.creado ? (
        <p className="adm-ok" role="status">
          Usuario creado. Entrégale la contraseña por un canal seguro: debe entrar y activar su verificación en dos pasos en las próximas 24 horas.
        </p>
      ) : null}
      {sp.guardado ? <p className="adm-ok" role="status">Cambios guardados.</p> : null}
      {sp.contrasena ? <p className="adm-ok" role="status">Contraseña cambiada.</p> : null}
      {sp.mfa ? (
        <p className="adm-ok" role="status">
          Verificación en dos pasos reiniciada. La persona tiene 24 horas para activarla de nuevo al entrar.
        </p>
      ) : null}

      <section aria-labelledby="h-datos">
        <h2 id="h-datos">Datos y acceso</h2>
        <FormularioEditarUsuario
          key={`${u.id}-${u.rol}-${u.activo}-${u.nombre}`}
          accion={editarUsuario}
          esYo={u.id === admin.userId}
          inicial={{ id: u.id, nombre: u.nombre, rol: u.rol, activo: u.activo }}
        />
      </section>

      <section aria-labelledby="h-clave">
        <h2 id="h-clave">Cambiar contraseña</h2>
        <FormularioContrasena id={u.id} accion={restablecerContrasena} />
      </section>

      <section aria-labelledby="h-mfa">
        <h2 id="h-mfa">Verificación en dos pasos</h2>
        <p className="adm-suave">
          Si la persona perdió su celular, reinicia la verificación: se borran sus autenticadores y tiene 24 horas para activar uno
          nuevo al entrar. Mientras tanto no podrá usar el panel con el anterior.
        </p>
        <BotonConfirmar
          etiqueta="Reiniciar verificación"
          mensaje="Se borran los autenticadores de esta persona y se abre una ventana de 24 horas para activar uno nuevo. Hazlo solo si sabes que es ella quien lo pide."
          etiquetaConfirmar="Sí, reiniciar"
          accion={reiniciarMfa.bind(null, u.id)}
        />
      </section>
    </>
  );
}
