'use client';

import { useActionState, useState, useTransition } from 'react';
import { confirmarInscripcionMfa, iniciarInscripcionMfa } from '@/app/admin/mfa/actions';
import type { EstadoFormulario } from '@/lib/auth/esquemas';
import { CampoTexto } from './CampoTexto';

const INICIAL: EstadoFormulario = {};

type Factor = { factorId: string; qr: string; secreto: string };

export function InscripcionMfa({ siguiente }: { siguiente?: string }) {
  const [factor, setFactor] = useState<Factor | null>(null);
  const [errorInicio, setErrorInicio] = useState<string | null>(null);
  const [generando, iniciarTransicion] = useTransition();
  const [estado, accion, pendiente] = useActionState(confirmarInscripcionMfa, INICIAL);

  function generar() {
    setErrorInicio(null);
    iniciarTransicion(async () => {
      const resultado = await iniciarInscripcionMfa();
      if (resultado.ok) {
        setFactor({ factorId: resultado.factorId, qr: resultado.qr, secreto: resultado.secreto });
      } else {
        setErrorInicio(resultado.error);
      }
    });
  }

  if (!factor) {
    return (
      <div className="adm-form">
        {errorInicio ? (
          <p role="alert" className="adm-alerta">
            {errorInicio}
          </p>
        ) : null}
        <ol className="adm-pasos">
          <li>
            Instala una aplicación de autenticación en tu teléfono (por ejemplo, Google
            Authenticator, Microsoft Authenticator o Aegis).
          </li>
          <li>Genera el código QR y escanéalo con la aplicación.</li>
          <li>Escribe aquí el código de 6 dígitos que muestre.</li>
        </ol>
        <button type="button" className="adm-boton" onClick={generar} disabled={generando}>
          {generando ? 'Generando…' : 'Generar código QR'}
        </button>
      </div>
    );
  }

  return (
    <form action={accion} className="adm-form" noValidate>
      {estado.error ? (
        <p role="alert" className="adm-alerta">
          {estado.error}
        </p>
      ) : null}
      <input type="hidden" name="factorId" value={factor.factorId} />
      {siguiente ? <input type="hidden" name="siguiente" value={siguiente} /> : null}
      {/* QR en data URI generado por Supabase: no hay nada que optimizar. */}
      <img
        className="adm-qr"
        src={factor.qr}
        alt="Código QR para vincular la aplicación de autenticación"
        width={192}
        height={192}
      />
      <div className="adm-pila">
        <p className="adm-suave adm-chico">
          Si no puedes escanear el código, escribe esta clave en la aplicación:
        </p>
        <p className="adm-secreto">{factor.secreto}</p>
      </div>
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
        {pendiente ? 'Confirmando…' : 'Confirmar y entrar'}
      </button>
    </form>
  );
}
