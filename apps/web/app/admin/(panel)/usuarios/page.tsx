import type { Metadata } from 'next';
import Link from 'next/link';
import { fechaHoraBogota } from '@/lib/admin/formato';
import { listarUsuarios } from '@/lib/admin/usuarios/servidor';
import { ETIQUETA_ROL_USUARIO } from '@/lib/admin/usuarios/usuarios';
import { requerirAdmin } from '@/lib/auth/guard';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';

export const metadata: Metadata = { title: 'Usuarios' };

export default async function PaginaUsuarios() {
  const admin = await requerirAdmin({ modulo: 'usuarios', accion: 'usuarios.gestionar' });
  const usuarios = await listarUsuarios(crearClienteServicio());

  return (
    <>
      <div className="adm-cabecera">
        <h1>Usuarios</h1>
        <Link href="/admin/usuarios/nuevo" className="adm-enlace-boton">
          Nuevo usuario
        </Link>
      </div>
      <p className="adm-suave">
        Administradores y operadores del panel. Todos entran con contraseña y verificación en dos pasos.
      </p>
      <div className="adm-tabla-caja">
        <table className="adm-tabla">
          <caption className="adm-suave">Usuarios del panel</caption>
          <thead>
            <tr>
              <th scope="col">Nombre</th>
              <th scope="col">Correo</th>
              <th scope="col">Rol</th>
              <th scope="col">Estado</th>
              <th scope="col">Verificación en 2 pasos</th>
              <th scope="col">Último ingreso</th>
            </tr>
          </thead>
          <tbody>
            {usuarios.map((u) => (
              <tr key={u.id}>
                <td>
                  <Link href={`/admin/usuarios/${u.id}`}>{u.nombre}</Link>
                  {u.id === admin.userId ? <span className="adm-suave"> (tú)</span> : null}
                </td>
                <td>{u.correo ?? <span className="adm-suave">Sin cuenta de acceso</span>}</td>
                <td>{ETIQUETA_ROL_USUARIO[u.rol]}</td>
                <td>
                  <span className={u.activo ? 'adm-insignia adm-insignia-ok' : 'adm-insignia'}>{u.activo ? 'Activo' : 'Desactivado'}</span>
                </td>
                <td>{u.mfaActivo ? 'Activa' : <span className="adm-insignia adm-insignia-aviso">Pendiente</span>}</td>
                <td className="adm-suave">{fechaHoraBogota(u.ultimoIngreso)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
