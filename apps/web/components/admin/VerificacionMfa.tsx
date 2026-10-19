'use client';

import { useActionState } from 'react';
import { verificarMfa } from '@/app/admin/mfa/actions';
import type { EstadoFormulario } from '@/lib/auth/esquemas';
import { CampoTexto } from './CampoTexto';

const INICIAL: EstadoFormulario = {};

export function VerificacionMfa({ siguiente }: { siguiente?: string }) {
  const [estado, accion, pendiente] = useActionState(verificarMfa, INICIAL);

  return (
    <form action={accion} className="adm-form" noValidate>
      {estado.error ? (
        <p role="alert" className="adm-alerta">
          {estado.error}
        </p>
      ) : null}
      {siguiente ? <input type="hidden" name="siguiente" value={siguiente} /> : null}
      <CampoTexto
        id="codigo"
        name="codigo"
        etiqueta="Código de 6 dígitos"
        className="adm-codigo"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        pattern="[0-9]{6}"
        autoFocus
        required
        error={estado.campos?.codigo}
      />
      <button type="submit" className="adm-boton" disabled={pendiente}>
        {pendiente ? 'Verificando…' : 'Verificar'}
      </button>
    </form>
  );
}
