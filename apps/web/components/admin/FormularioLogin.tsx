'use client';

import { useActionState, useEffect } from 'react';
import { iniciarSesion } from '@/app/admin/login/actions';
import type { EstadoFormulario } from '@/lib/auth/esquemas';
import { useTurnstile } from '@/components/store/useTurnstile';
import { CampoTexto } from './CampoTexto';

const INICIAL: EstadoFormulario = {};

/**
 * `claveCaptcha` es la clave de sitio PÚBLICA de Turnstile (null = sin widget). Si Supabase tiene el CAPTCHA apagado
 * ignora el token; si lo tiene encendido lo exige. Cada token vale una sola vez: se pide otro tras cada intento.
 */
export function FormularioLogin({ siguiente, claveCaptcha = null }: { siguiente?: string; claveCaptcha?: string | null }) {
  const [estado, accion, pendiente] = useActionState(iniciarSesion, INICIAL);
  const { contenedor, token, reiniciar } = useTurnstile(claveCaptcha);

  useEffect(() => {
    if (estado !== INICIAL) reiniciar();
  }, [estado, reiniciar]);

  const enviar = (datos: FormData) => {
    datos.set('captchaToken', token.current ?? '');
    accion(datos);
  };

  return (
    <form action={enviar} className="adm-form" noValidate>
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
      {claveCaptcha ? <div ref={contenedor} className="adm-captcha" data-testid="captcha-login" /> : null}
      <button type="submit" className="adm-boton" disabled={pendiente}>
        {pendiente ? 'Ingresando…' : 'Ingresar'}
      </button>
    </form>
  );
}
