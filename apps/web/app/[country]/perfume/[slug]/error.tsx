'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Button, clasesBoton } from '@izao/ui';
import { T } from '@/lib/store/textos';

export default function ErrorFicha({ reset }: { error: Error; reset: () => void }) {
  const { country } = useParams<{ country: string }>();
  return (
    <div role="alert" className="mx-auto flex min-h-[50dvh] max-w-3xl flex-col items-start justify-center gap-5 px-6 py-20">
      <h1 className="text-4xl">{T.errores.generico}</h1>
      <div className="flex flex-wrap gap-3">
        <Button onClick={reset}>{T.listado.reintentar}</Button>
        <Link href={`/${country === 'ec' ? 'ec' : 'co'}/catalogo`} className={clasesBoton({ variante: 'secundario' })}>
          {T.ficha.verAromas}
        </Link>
      </div>
    </div>
  );
}
