import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FormularioContrasena, FormularioEditarUsuario, FormularioNuevoUsuario } from '@/components/admin/FormularioUsuario';
import { fechaHoraBogota } from '@/lib/admin/formato';
import { obtenerUsuario } from '@/lib/admin/usuarios/servidor';
import { esIdUsuario } from '@/lib/admin/usuarios/usuarios';
import { requerirAdmin } from '@/lib/auth/guard';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';
import { crearUsuario, editarUsuario, restablecerContrasena } from '../acciones';

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
        {u.correo ?? 'Sin cuenta de acceso'} · último ingreso: {fechaHoraBogota(u.ultimoIngreso)}
      </p>
      {sp.creado ? (
        <p className="adm-ok" role="status">
          Usuario creado. Entrégale la contraseña por un canal seguro.
        </p>
      ) : null}
      {sp.guardado ? <p className="adm-ok" role="status">Cambios guardados.</p> : null}
      {sp.contrasena ? <p className="adm-ok" role="status">Contraseña cambiada.</p> : null}

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

    </>
  );
}
