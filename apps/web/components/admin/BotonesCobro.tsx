'use client';

import { useState, useTransition } from 'react';

type Respuesta = { ok: true; mensaje?: string; url?: string } | { ok: false; mensaje: string };

/**
 * "Copiar link de cobro" y "Reenviar cobro" del detalle del pedido. El link se pide al servidor al pulsar
 * (queda auditado); el navegador nunca recibe el token antes de eso.
 */
export function BotonesCobro({
  puedeCopiar,
  puedeReenviar,
  motivo,
  copiar,
  reenviar,
}: {
  puedeCopiar: boolean;
  puedeReenviar: boolean;
  motivo: string | null;
  copiar: () => Promise<Respuesta>;
  reenviar: () => Promise<Respuesta>;
}) {
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pendiente, iniciar] = useTransition();

  function pedirCopia() {
    iniciar(async () => {
      const r = await copiar();
      if (!r.ok || !r.url) {
        setAviso({ ok: false, texto: r.ok ? 'No se recibió el link.' : r.mensaje });
        return;
      }
      try {
        await navigator.clipboard.writeText(r.url);
        setAviso({ ok: true, texto: 'Link de cobro copiado.' });
      } catch {
        // Sin permiso del portapapeles (p. ej. HTTP o navegador estricto): se muestra para copiarlo a mano.
        setAviso({ ok: true, texto: `Copia el link: ${r.url}` });
      }
    });
  }

  function pedirReenvio() {
    iniciar(async () => {
      const r = await reenviar();
      setAviso({ ok: r.ok, texto: r.mensaje ?? (r.ok ? 'Listo.' : 'No se pudo completar la acción.') });
    });
  }

  return (
    <div>
      <div className="adm-acciones">
        <button type="button" className="adm-boton adm-boton-secundario" disabled={!puedeCopiar || pendiente} onClick={pedirCopia}>
          Copiar link de cobro
        </button>
        <button type="button" className="adm-boton" disabled={!puedeReenviar || pendiente} onClick={pedirReenvio}>
          {pendiente ? 'Procesando…' : 'Reenviar cobro'}
        </button>
      </div>
      {motivo && !puedeReenviar ? <p className="adm-suave adm-chico">{motivo}</p> : null}
      {motivo === null && !puedeCopiar ? (
        <p className="adm-suave adm-chico">Aún no hay un link vigente. "Reenviar cobro" pide al sistema que lo genere y lo envíe.</p>
      ) : null}
      {aviso ? (
        <p className={aviso.ok ? 'adm-ok' : 'adm-alerta'} role={aviso.ok ? 'status' : 'alert'} style={{ overflowWrap: 'anywhere' }}>
          {aviso.texto}
        </p>
      ) : null}
    </div>
  );
}
