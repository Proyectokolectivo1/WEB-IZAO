'use client';

import { useActionState } from 'react';
import { iniciarSesion } from '@/app/admin/login/actions';
import type { EstadoFormulario } from '@/lib/auth/esquemas';
import { CampoTexto } from './CampoTexto';

const INICIAL: EstadoFormulario = {};

export function FormularioLogin({ siguiente }: { siguiente?: string }) {
  const [estado, accion, pendiente] = useActionState(iniciarSesion, INICIAL);

  return (
    <form action={accion} className="adm-form" noValidate>
      {estado.error ? (
        <p role="alert" className="adm-alerta">
          {estado.error}
        </p>
      ) : null}
      {siguiente ? <input type="hidden" name="siguiente" value={siguiente} /> : null}
      <CampoTexto
        id="correo"
        name="correo"
        type="email"
        etiqueta="Correo"
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        required
        error={estado.campos?.correo}
      />
      <CampoTexto
        id="contrasena"
        name="contrasena"
        type="password"
        etiqueta="Contraseña"
        autoComplete="current-password"
        required
        error={estado.campos?.contrasena}
      />
      <button type="submit" className="adm-boton" disabled={pendiente}>
        {pendiente ? 'Ingresando…' : 'Ingresar'}
      </button>
    </form>
  );
}
