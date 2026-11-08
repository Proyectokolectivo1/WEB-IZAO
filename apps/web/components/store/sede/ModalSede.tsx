'use client';

import { useId, useState } from 'react';
import { Icono, Sheet } from '@izao/ui';
import { recordarSede, type OpcionSede } from '@/lib/store/sede';
import { TP } from '@/lib/store/textos-pais';
import type { CodigoPais } from '@/lib/store/types';
import { Bandera } from './Bandera';

interface Props {
  abierto: boolean;
  onCerrar: () => void;
  /** `false` en la primera visita: hay que elegir. */
  cerrable: boolean;
  /** País de la página que se está viendo. */
  paisActual: CodigoPais;
  /** País ya elegido antes (al abrir la ventana a mano), para marcarlo. */
  paisElegido: CodigoPais | null;
  opciones: OpcionSede[];
}

/** Elección de sede (§5.1): dos países, cada uno con moneda y una línea de envío y de pago. Se baja en reposo. */
export default function ModalSede({ abierto, onCerrar, cerrable, paisActual, paisElegido, opciones }: Props) {
  const idBajada = useId();
  const [pendiente, setPendiente] = useState<CodigoPais | null>(null);

  const elegir = (pais: CodigoPais) => {
    if (pendiente) return;
    recordarSede(pais);
    if (pais === paisActual) {
      onCerrar();
      return;
    }
    setPendiente(pais);
    // Misma ruta del otro país si se vende allá; si no, el inicio (lo decide `/{país}/cambiar-pais`).
    const ruta = location.pathname.replace(/^\/(co|ec)(?=\/|$)/, '') || '/';
    location.assign(`/${paisActual}/cambiar-pais?a=${pais}&ruta=${encodeURIComponent(ruta)}`);
  };

  const marcado = paisElegido ?? paisActual;

  return (
    <Sheet
      abierto={abierto}
      onCerrar={onCerrar}
      titulo={TP.sede.titulo}
      lado="centrado"
      cabecera={false}
      cerrable={cerrable}
      etiquetaCerrar={TP.sede.cerrar}
      focoInicial="panel"
      describedBy={idBajada}
      testId="modal-sede"
      className="overflow-hidden"
    >
      <div className="textura-calida px-5 pb-6 pt-9 md:px-10 md:pb-10 md:pt-12">
        <p className="etiqueta text-ink/75">{TP.sede.rotulo}</p>
        <p aria-hidden="true" className="mt-3 max-w-[16ch] font-display text-[2rem] leading-[1.08] md:max-w-none md:text-5xl">
          {TP.sede.titulo}
        </p>
        <p id={idBajada} className="mt-3 max-w-md text-[1.0625rem] leading-snug text-ink/80">
          {TP.sede.bajada}
        </p>

        <div role="group" aria-label={TP.sede.ariaGrupo} className="mt-7 grid gap-3 md:mt-9 md:grid-cols-2 md:gap-5">
          {opciones.map((o) => {
            const actual = o.pais === marcado;
            return (
              <button
                key={o.pais}
                type="button"
                data-testid={`sede-${o.pais}`}
                onClick={() => elegir(o.pais)}
                disabled={pendiente !== null}
                aria-current={actual ? 'true' : undefined}
                className={`group elevar fondo-tono tono-0 relative flex min-h-11 items-start gap-4 rounded-card p-4 text-left disabled:cursor-wait md:flex-col md:gap-5 md:p-6 ${
                  actual ? 'outline outline-2 -outline-offset-2 outline-ink' : ''
                }`}
              >
                <Bandera pais={o.pais} className="w-14 shrink-0 shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-ink)_14%,transparent)] md:w-20" />
                <span className="block min-w-0 flex-1">
                  <span className="block font-display text-[1.75rem] leading-none md:text-4xl">{o.nombre}</span>
                  <span className="etiqueta mt-2 block text-ink/75">{o.moneda}</span>
                  <span className="mt-4 flex items-start gap-2.5 text-[0.9375rem] leading-snug">
                    <Icono nombre="camion" tamano={18} className="mt-0.5 shrink-0" />
                    {o.envio}
                  </span>
                  <span className="mt-2 flex items-start gap-2.5 text-[0.9375rem] leading-snug">
                    <Icono nombre="tarjeta" tamano={18} className="mt-0.5 shrink-0" />
                    {o.pago}
                  </span>
                  <span className="mt-4 hidden text-[0.9375rem] font-semibold underline-offset-4 group-hover:underline md:block">
                    {actual && paisElegido ? TP.sede.estasAqui : TP.sede.entrar(o.nombre)}
                  </span>
                </span>
                {actual && paisElegido ? <span className="solo-lectores">{TP.sede.estasAqui}</span> : null}
              </button>
            );
          })}
        </div>

        <p className="mt-6 text-[0.875rem] text-ink/75">{TP.sede.nota}</p>
        <p aria-live="polite" className="solo-lectores">
          {pendiente ? TP.sede.llevando(TP.sede.paises[pendiente].nombre) : ''}
        </p>
      </div>
    </Sheet>
  );
}
