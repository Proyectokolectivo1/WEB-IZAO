'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { clasesBoton } from '@izao/ui';
import { T } from '@/lib/store/textos';

export default function FichaNoEncontrada() {
  const { country } = useParams<{ country: string }>();
  return (
    <div className="mx-auto flex min-h-[50dvh] max-w-3xl flex-col items-start justify-center gap-5 px-6 py-20">
      <p className="etiqueta text-ink/70">404</p>
      <h1 className="text-5xl">{T.ficha.noEncontrado}</h1>
      <p className="text-lg">{T.ficha.noEncontradoAyuda}</p>
      <Link href={`/${country === 'ec' ? 'ec' : 'co'}/catalogo`} className={clasesBoton({ variante: 'secundario' })}>
        {T.ficha.verAromas}
      </Link>
    </div>
  );
}
