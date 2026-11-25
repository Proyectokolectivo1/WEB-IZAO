'use client';

import Link from 'next/link';
import { useId, useState } from 'react';
import { clasesBoton, Sheet } from '@izao/ui';
import type { Elecciones } from '@/lib/store/consentimiento';
import { TCK, type TextosCookies } from '@/lib/store/textos-cookies';

interface Props {
  abierto: boolean;
  onCerrar: () => void;
  onGuardar: (elecciones: Elecciones) => void;
  textos: TextosCookies;
  /** Decisión vigente (o, sin decisión, todo apagado). */
  inicial: Elecciones;
  enlacePolitica: string | null;
}

function Interruptor({ id, titulo, texto, marcado, onCambio }: { id: string; titulo: string; texto: string; marcado: boolean; onCambio: (v: boolean) => void }) {
  return (
    <li className="flex items-start justify-between gap-4 py-4">
      <div className="min-w-0">
        <label htmlFor={id} className="block cursor-pointer text-[1.0625rem] font-semibold">
          {titulo}
        </label>
        <p id={`${id}-d`} className="pt-1 text-[0.9375rem] leading-snug text-ink/85">
          {texto}
        </p>
      </div>
      <span className="relative mt-0.5 shrink-0">
        <input
          id={id}
          type="checkbox"
          role="switch"
          checked={marcado}
          aria-describedby={`${id}-d`}
          onChange={(e) => onCambio(e.target.checked)}
          className="peer absolute inset-0 z-10 size-full cursor-pointer opacity-0"
        />
        {/* Pista con borde de tinta (contraste de componente de 3:1 o más, apagada y encendida). */}
        <span
          aria-hidden="true"
          className="relative block h-7 w-12 rounded-full border-2 border-ink bg-transparent transition-colors peer-checked:bg-ink peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink motion-reduce:transition-none"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-1 top-1 size-5 rounded-full bg-ink transition-transform peer-checked:translate-x-5 peer-checked:bg-bg motion-reduce:transition-none"
        />
      </span>
    </li>
  );
}

/** Ventana de preferencias (se baja en reposo): necesarias siempre activas; analítica y publicidad con interruptor. */
export default function PreferenciasCookies({ abierto, onCerrar, onGuardar, textos, inicial, enlacePolitica }: Props) {
  const id = useId();
  const [analitica, setAnalitica] = useState(inicial.analitica);
  const [marketing, setMarketing] = useState(inicial.marketing);
  const idBajada = `${id}-bajada`;

  return (
    <Sheet
      abierto={abierto}
      onCerrar={onCerrar}
      titulo={textos.preferenciasTitulo}
      lado="centrado"
      etiquetaCerrar={TCK.ui.cerrar}
      describedBy={idBajada}
      testId="preferencias-cookies"
    >
      <div className="overflow-y-auto px-5 pb-6 pt-4 md:px-8">
        <p id={idBajada} className="text-[1rem] leading-snug text-ink/85">
          {textos.preferenciasTexto}
          {enlacePolitica ? (
            <>
              {' '}
              <Link href={enlacePolitica} onClick={onCerrar} className="underline underline-offset-4">
                {TCK.aviso.enlace}
              </Link>
              .
            </>
          ) : null}
        </p>
        <ul className="mt-2 divide-y divide-ink/10">
          <li className="flex items-start justify-between gap-4 py-4">
            <div className="min-w-0">
              <p className="text-[1.0625rem] font-semibold">{textos.necesariasTitulo}</p>
              <p className="pt-1 text-[0.9375rem] leading-snug text-ink/85">{textos.necesariasTexto}</p>
            </div>
            <span className="mt-0.5 shrink-0 text-[0.875rem] font-semibold">{TCK.ui.siempreActivas}</span>
          </li>
          <Interruptor id={`${id}-analitica`} titulo={textos.analiticaTitulo} texto={textos.analiticaTexto} marcado={analitica} onCambio={setAnalitica} />
          <Interruptor id={`${id}-marketing`} titulo={textos.marketingTitulo} texto={textos.marketingTexto} marcado={marketing} onCambio={setMarketing} />
        </ul>
        <div className="flex flex-col gap-2 pt-4 sm:flex-row">
          <button type="button" className={clasesBoton({ variante: 'primario', className: 'flex-1' })} onClick={() => onGuardar({ analitica, marketing })}>
            {TCK.ui.guardar}
          </button>
          <button type="button" className={clasesBoton({ variante: 'primario', className: 'flex-1' })} onClick={() => onGuardar({ analitica: true, marketing: true })}>
            {TCK.ui.aceptarTodas}
          </button>
          <button type="button" className={clasesBoton({ variante: 'primario', className: 'flex-1' })} onClick={() => onGuardar({ analitica: false, marketing: false })}>
            {TCK.ui.rechazarTodas}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
