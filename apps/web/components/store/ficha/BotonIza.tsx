'use client';

import { Icono } from '@izao/ui';
import { abrirIza } from '@/lib/store/navegacion';
import { T } from '@/lib/store/textos';

/** «¿Dudas? Pregúntale a Iza» (§7.6): abre el chat con este producto como contexto (el widget escucha `izao:abrir-iza`). */
export function BotonIza({ slug }: { slug: string }) {
  return (
    <button
      type="button"
      data-testid="boton-iza"
      onClick={() => abrirIza({ producto: slug })}
      className="inline-flex min-h-11 w-fit items-center gap-2 text-[0.9375rem] underline underline-offset-4 hover:bg-surface"
    >
      <Icono nombre="chat" tamano={20} />
      {T.ficha.preguntaIza}
    </button>
  );
}
