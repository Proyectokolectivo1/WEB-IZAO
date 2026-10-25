'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { ESTADO_INICIAL, type ResultadoAccion } from '@/lib/admin/crud/comun';
import { MIN_CONTRASENA } from '@/lib/admin/usuarios/usuarios';
import { ETIQUETA_ROL, ROLES } from '@/lib/auth/permissions';
import { CampoSelect } from './CampoSelect';
import { CampoTexto } from './CampoTexto';

type Accion = (previo: ResultadoAccion, datos: FormData) => Promise<ResultadoAccion>;

const OPCIONES_ROL = ROLES.map((r) => ({ valor: r, etiqueta: ETIQUETA_ROL[r] }));

function Aviso({ estado }: { estado: ResultadoAccion }) {
  return !estado.ok && estado.mensaje ? (
    <p className="adm-alerta" role="alert">
      {estado.mensaje}
    </p>
  ) : null;
}

/** Alta de un usuario del panel. Las contraseñas no se muestran ni se conservan si el envío falla. */
export function FormularioNuevoUsuario({ accion }: { accion: Accion }) {
  const [estado, enviar, pendiente] = useActionState(accion, ESTADO_INICIAL);
  const errores = estado.ok ? {} : (estado.errores ?? {});
  return (
    <form action={enviar} className="adm-form adm-form-ancho" noValidate autoComplete="off">
      <Aviso estado={estado} />
      <CampoTexto id="nombre" name="nombre" etiqueta="Nombre" maxLength={80} required error={errores.nombre} />
      <CampoTexto id="correo" name="correo" etiqueta="Correo" type="email" maxLength={254} required autoComplete="off" error={errores.correo} />
      <CampoSelect id="rol" name="rol" etiqueta="Rol" opciones={OPCIONES_ROL} defaultValue="operator" ayuda="El operador solo ve Pedidos, Garantías y el Agente de impresión." error={errores.rol} />
      <CampoTexto
        id="contrasena"
        name="contrasena"
        etiqueta="Contraseña inicial"
        type="password"
        autoComplete="new-password"
        required
        ayuda={`Mínimo ${MIN_CONTRASENA} caracteres. Entrégasela a la persona por un canal seguro; la verificación en dos pasos la activa ella al entrar (tiene 24 horas).`}
        error={errores.contrasena}
      />
      <CampoTexto id="confirmar" name="confirmar" etiqueta="Repite la contraseña" type="password" autoComplete="new-password" required error={errores.confirmar} />
      <div className="adm-acciones">
        <button type="submit" className="adm-boton" disabled={pendiente}>
          {pendiente ? 'Creando…' : 'Crear usuario'}
        </button>
        <Link href="/admin/usuarios" className="adm-enlace-boton adm-boton-secundario">
          Cancelar
        </Link>
      </div>
    </form>
  );
}

export function FormularioEditarUsuario({
  inicial,
  accion,
  esYo,
}: {
  inicial: { id: string; nombre: string; rol: string; activo: boolean };
  accion: Accion;
  /** Es la cuenta de quien está en sesión: no puede quitarse el rol ni desactivarse. */
  esYo: boolean;
}) {
  const [estado, enviar, pendiente] = useActionState(accion, ESTADO_INICIAL);
  const errores = estado.ok ? {} : (estado.errores ?? {});
  return (
    <form action={enviar} className="adm-form adm-form-ancho" noValidate>
      <input type="hidden" name="id" value={inicial.id} />
      <Aviso estado={estado} />
      <CampoTexto id="nombre" name="nombre" etiqueta="Nombre" defaultValue={inicial.nombre} maxLength={80} required error={errores.nombre} />
      <CampoSelect id="rol" name="rol" etiqueta="Rol" opciones={OPCIONES_ROL} defaultValue={inicial.rol} error={errores.rol} />
      <label className="adm-check">
        <input type="checkbox" name="activo" defaultChecked={inicial.activo} />
        Activo (puede entrar al panel)
      </label>
      {esYo ? <p className="adm-suave adm-chico">Esta es tu cuenta: no puedes quitarte el rol de administrador ni desactivarla.</p> : null}
      <div className="adm-acciones">
        <button type="submit" className="adm-boton" disabled={pendiente}>
          {pendiente ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </form>
  );
}

export function FormularioContrasena({ id, accion }: { id: string; accion: Accion }) {
  const [estado, enviar, pendiente] = useActionState(accion, ESTADO_INICIAL);
  const errores = estado.ok ? {} : (estado.errores ?? {});
  return (
    <form action={enviar} className="adm-form adm-form-ancho" noValidate autoComplete="off">
      <input type="hidden" name="id" value={id} />
      <Aviso estado={estado} />
      <CampoTexto
        id="nueva-contrasena"
        name="contrasena"
        etiqueta="Nueva contraseña"
        type="password"
        autoComplete="new-password"
        required
        ayuda={`Mínimo ${MIN_CONTRASENA} caracteres.`}
        error={errores.contrasena}
      />
      <CampoTexto id="nueva-confirmar" name="confirmar" etiqueta="Repite la contraseña" type="password" autoComplete="new-password" required error={errores.confirmar} />
      <div className="adm-acciones">
        <button type="submit" className="adm-boton adm-boton-secundario" disabled={pendiente}>
          {pendiente ? 'Guardando…' : 'Cambiar contraseña'}
        </button>
      </div>
    </form>
  );
}
