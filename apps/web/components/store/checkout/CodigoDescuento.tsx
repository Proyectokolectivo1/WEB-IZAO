'use client';

import { useState } from 'react';
import { Button } from '@izao/ui';
import { TC } from '@/lib/store/textos-checkout';
import type { EstadoCodigo } from '../carrito/useVistaPrevia';

interface Props {
  id: string;
  codigo: EstadoCodigo | null;
  revisando: boolean;
  onAplicar: (texto: string) => Promise<void>;
  onQuitar: () => void;
  /** Aviso extra bajo el campo (p. ej. «no aplica con Addi»). */
  aviso?: string | null;
}

/** Campo de código de descuento con estado anunciado a lectores de pantalla. */
export function CodigoDescuento({ id, codigo, revisando, onAplicar, onQuitar, aviso }: Props) {
  const [escrito, setEscrito] = useState('');
  const mensajeId = `${id}-mensaje`;

  // No es un <form>: en el checkout vive dentro del formulario del pedido y los formularios no se anidan.
  async function enviar() {
    if (revisando || !escrito.trim()) return;
    await onAplicar(escrito);
    setEscrito('');
  }

  return (
    <div role="group" aria-labelledby={`${id}-etiqueta`}>
      <label id={`${id}-etiqueta`} htmlFor={id} className="etiqueta block pb-2">
        {TC.resumen.codigo}
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          value={escrito}
          onChange={(e) => setEscrito(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void enviar();
            }
          }}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={40}
          aria-describedby={mensajeId}
          aria-invalid={codigo?.estado === 'rechazado' || undefined}
          className="min-h-11 min-w-0 flex-1 rounded-md border border-line bg-bg px-3 uppercase focus:bg-surface"
        />
        <Button type="button" variante="secundario" onClick={() => void enviar()} disabled={revisando || !escrito.trim()}>
          {revisando ? TC.resumen.aplicando : TC.resumen.aplicar}
        </Button>
      </div>
      <p id={mensajeId} role="status" className={`min-h-5 pt-2 text-[0.875rem] ${codigo?.estado === 'rechazado' ? 'text-danger' : ''}`}>
        {codigo?.mensaje}
        {codigo?.estado === 'aplicado' ? (
          <button type="button" onClick={onQuitar} className="ml-2 inline-flex min-h-11 items-center underline underline-offset-4">
            {TC.resumen.quitarCodigo}
          </button>
        ) : null}
      </p>
      {aviso ? <p className="pt-1 text-[0.875rem]">{aviso}</p> : null}
    </div>
  );
}
