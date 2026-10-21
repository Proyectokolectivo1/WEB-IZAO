'use client';

import { useId, useRef, useState, useTransition } from 'react';

type Respuesta = { ok: boolean; mensaje: string };
type Aviso = { ok: boolean; texto: string } | null;

function AvisoAccion({ aviso }: { aviso: Aviso }) {
  if (!aviso) return null;
  return (
    <p className={aviso.ok ? 'adm-ok' : 'adm-alerta'} role={aviso.ok ? 'status' : 'alert'}>
      {aviso.texto}
    </p>
  );
}

/** Botón de una acción de un clic (reintentar envío, reimprimir etiqueta). Muestra el resultado debajo. */
export function AccionSimple({
  etiqueta,
  accion,
  deshabilitada = false,
  motivo,
  secundaria = true,
}: {
  etiqueta: string;
  accion: () => Promise<Respuesta>;
  deshabilitada?: boolean;
  /** Por qué está deshabilitada (se muestra como ayuda). */
  motivo?: string | null;
  secundaria?: boolean;
}) {
  const [aviso, setAviso] = useState<Aviso>(null);
  const [pendiente, iniciar] = useTransition();
  return (
    <div>
      <button
        type="button"
        className={`adm-boton ${secundaria ? 'adm-boton-secundario' : ''}`.trim()}
        disabled={deshabilitada || pendiente}
        onClick={() =>
          iniciar(async () => {
            const r = await accion();
            setAviso({ ok: r.ok, texto: r.mensaje });
          })
        }
      >
        {pendiente ? 'Procesando…' : etiqueta}
      </button>
      {deshabilitada && motivo ? <p className="adm-suave adm-chico">{motivo}</p> : null}
      <AvisoAccion aviso={aviso} />
    </div>
  );
}

/**
 * Acción irreversible que pide un texto (motivo al cancelar, referencia al marcar pagado) y una confirmación
 * explícita en dos pasos.
 */
export function AccionConTexto({
  etiqueta,
  advertencia,
  etiquetaCampo,
  etiquetaConfirmar,
  accion,
  peligro = false,
  minimo = 3,
  maximo = 300,
}: {
  etiqueta: string;
  advertencia: string;
  etiquetaCampo: string;
  etiquetaConfirmar: string;
  accion: (texto: string) => Promise<Respuesta>;
  peligro?: boolean;
  minimo?: number;
  maximo?: number;
}) {
  const id = useId();
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState('');
  const [aviso, setAviso] = useState<Aviso>(null);
  const [pendiente, iniciar] = useTransition();
  const campo = useRef<HTMLInputElement>(null);

  if (!abierto) {
    return (
      <div>
        <button
          type="button"
          className={`adm-boton ${peligro ? 'adm-boton-peligro' : 'adm-boton-secundario'}`.trim()}
          onClick={() => {
            setAbierto(true);
            setTimeout(() => campo.current?.focus(), 0);
          }}
        >
          {etiqueta}
        </button>
        {aviso ? <AvisoAccion aviso={aviso} /> : null}
      </div>
    );
  }
  const valido = texto.trim().length >= minimo;
  return (
    <div className="adm-alerta" role="alertdialog" aria-label={etiqueta}>
      <p>{advertencia}</p>
      <div className="adm-campo">
        <label htmlFor={id} className="adm-etiqueta">
          {etiquetaCampo}
        </label>
        <input
          id={id}
          ref={campo}
          className="adm-input"
          value={texto}
          maxLength={maximo}
          onChange={(e) => setTexto(e.target.value)}
          autoComplete="off"
        />
      </div>
      <AvisoAccion aviso={aviso && !aviso.ok ? aviso : null} />
      <div className="adm-acciones" style={{ marginTop: '0.75rem' }}>
        <button
          type="button"
          className={`adm-boton ${peligro ? 'adm-boton-peligro' : ''}`.trim()}
          disabled={pendiente || !valido}
          onClick={() =>
            iniciar(async () => {
              const r = await accion(texto.trim());
              setAviso({ ok: r.ok, texto: r.mensaje });
              if (r.ok) {
                setAbierto(false);
                setTexto('');
              }
            })
          }
        >
          {pendiente ? 'Procesando…' : etiquetaConfirmar}
        </button>
        <button type="button" className="adm-boton adm-boton-secundario" disabled={pendiente} onClick={() => setAbierto(false)}>
          Volver
        </button>
      </div>
    </div>
  );
}

/** Nota interna del pedido: texto libre, queda en la línea de tiempo con quién y cuándo. */
export function FormularioNota({ accion }: { accion: (texto: string) => Promise<Respuesta> }) {
  const id = useId();
  const [texto, setTexto] = useState('');
  const [aviso, setAviso] = useState<Aviso>(null);
  const [pendiente, iniciar] = useTransition();
  return (
    <form
      className="adm-form-ancho"
      onSubmit={(e) => {
        e.preventDefault();
        iniciar(async () => {
          const r = await accion(texto);
          setAviso({ ok: r.ok, texto: r.mensaje });
          if (r.ok) setTexto('');
        });
      }}
    >
      <div className="adm-campo">
        <label htmlFor={id} className="adm-etiqueta">
          Nueva nota interna
        </label>
        <textarea id={id} className="adm-textarea" value={texto} maxLength={1000} rows={3} onChange={(e) => setTexto(e.target.value)} />
        <p className="adm-suave adm-chico">Solo la ve el equipo. Máximo 1000 caracteres.</p>
      </div>
      <button type="submit" className="adm-boton" disabled={pendiente || texto.trim() === ''}>
        {pendiente ? 'Guardando…' : 'Guardar nota'}
      </button>
      <AvisoAccion aviso={aviso} />
    </form>
  );
}
