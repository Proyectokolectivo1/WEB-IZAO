'use client';

import { useState, useTransition } from 'react';

type Respuesta = { ok: boolean; mensaje: string; token?: string | undefined };

/**
 * Muestra el token recién creado UNA sola vez. Vive solo en el estado de este componente: al recargar o navegar
 * desaparece, y en el servidor solo queda su hash.
 */
function TokenUnaVez({ token, mensaje, alCerrar }: { token: string; mensaje: string; alCerrar: () => void }) {
  const [copiado, setCopiado] = useState<boolean | null>(null);
  return (
    <div className="adm-alerta" role="alert">
      <p>
        <strong>{mensaje}</strong>
      </p>
      <p>
        <code className="adm-secreto" style={{ overflowWrap: 'anywhere' }}>
          {token}
        </code>
      </p>
      <div className="adm-acciones">
        <button
          type="button"
          className="adm-boton"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(token);
              setCopiado(true);
            } catch {
              setCopiado(false);
            }
          }}
        >
          Copiar token
        </button>
        <button type="button" className="adm-boton adm-boton-secundario" onClick={alCerrar}>
          Ya lo guardé
        </button>
      </div>
      {copiado === true ? <p role="status">Token copiado.</p> : null}
      {copiado === false ? <p role="status">No se pudo copiar automáticamente: selecciónalo y cópialo a mano.</p> : null}
      <p className="adm-suave adm-chico">Pégalo en el PC de despacho cuando el instalador lo pida. Si lo pierdes, genera uno nuevo.</p>
    </div>
  );
}

/** Alta de un agente (solo administrador). */
export function NuevoAgente({ crear }: { crear: (nombre: string) => Promise<Respuesta> }) {
  const [nombre, setNombre] = useState('');
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [token, setToken] = useState<{ valor: string; mensaje: string } | null>(null);
  const [pendiente, iniciar] = useTransition();

  return (
    <section className="adm-form-ancho" aria-labelledby="h-nuevo-agente">
      <h2 id="h-nuevo-agente">Crear agente</h2>
      {token ? (
        <TokenUnaVez token={token.valor} mensaje={token.mensaje} alCerrar={() => setToken(null)} />
      ) : (
        <form
          className="adm-busqueda"
          onSubmit={(e) => {
            e.preventDefault();
            iniciar(async () => {
              const r = await crear(nombre);
              if (r.ok && r.token) {
                setToken({ valor: r.token, mensaje: r.mensaje });
                setNombre('');
                setAviso(null);
              } else {
                setAviso({ ok: r.ok, texto: r.mensaje });
              }
            });
          }}
        >
          <div className="adm-campo">
            <label htmlFor="nombre-agente" className="adm-etiqueta">
              Nombre del agente
            </label>
            <input
              id="nombre-agente"
              className="adm-input"
              value={nombre}
              maxLength={80}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="PC de despacho"
              autoComplete="off"
            />
          </div>
          <button type="submit" className="adm-boton" disabled={pendiente || nombre.trim().length < 2}>
            {pendiente ? 'Creando…' : 'Crear agente'}
          </button>
        </form>
      )}
      {aviso ? (
        <p className={aviso.ok ? 'adm-ok' : 'adm-alerta'} role={aviso.ok ? 'status' : 'alert'}>
          {aviso.texto}
        </p>
      ) : null}
    </section>
  );
}

/** Activar/desactivar y rotar token de un agente (solo administrador). */
export function AccionesAgente({
  activo,
  cambiarEstado,
  rotar,
}: {
  activo: boolean;
  cambiarEstado: (activo: boolean) => Promise<Respuesta>;
  rotar: () => Promise<Respuesta>;
}) {
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [token, setToken] = useState<{ valor: string; mensaje: string } | null>(null);
  const [confirmar, setConfirmar] = useState<'desactivar' | 'rotar' | null>(null);
  const [pendiente, iniciar] = useTransition();

  function ejecutar(fn: () => Promise<Respuesta>) {
    iniciar(async () => {
      const r = await fn();
      setConfirmar(null);
      if (r.ok && r.token) setToken({ valor: r.token, mensaje: r.mensaje });
      else setAviso({ ok: r.ok, texto: r.mensaje });
    });
  }

  return (
    <div>
      {token ? <TokenUnaVez token={token.valor} mensaje={token.mensaje} alCerrar={() => setToken(null)} /> : null}
      {confirmar ? (
        <div className="adm-alerta" role="alertdialog" aria-label="Confirmar acción sobre el agente">
          <p>
            {confirmar === 'rotar'
              ? 'El token actual dejará de funcionar en cuanto lo cambies y el agente no podrá imprimir hasta que le pongas el nuevo.'
              : 'Un agente desactivado deja de recibir trabajos de impresión.'}
          </p>
          <div className="adm-acciones">
            <button
              type="button"
              className="adm-boton adm-boton-peligro"
              disabled={pendiente}
              onClick={() => ejecutar(confirmar === 'rotar' ? rotar : () => cambiarEstado(false))}
            >
              {pendiente ? 'Procesando…' : confirmar === 'rotar' ? 'Sí, generar token nuevo' : 'Sí, desactivar'}
            </button>
            <button type="button" className="adm-boton adm-boton-secundario" disabled={pendiente} onClick={() => setConfirmar(null)}>
              Volver
            </button>
          </div>
        </div>
      ) : (
        <div className="adm-acciones">
          {activo ? (
            <button type="button" className="adm-boton adm-boton-secundario" onClick={() => setConfirmar('desactivar')}>
              Desactivar agente
            </button>
          ) : (
            <button type="button" className="adm-boton" disabled={pendiente} onClick={() => ejecutar(() => cambiarEstado(true))}>
              {pendiente ? 'Procesando…' : 'Activar agente'}
            </button>
          )}
          <button type="button" className="adm-boton adm-boton-secundario" onClick={() => setConfirmar('rotar')}>
            Generar token nuevo
          </button>
        </div>
      )}
      {aviso ? (
        <p className={aviso.ok ? 'adm-ok' : 'adm-alerta'} role={aviso.ok ? 'status' : 'alert'}>
          {aviso.texto}
        </p>
      ) : null}
    </div>
  );
}
