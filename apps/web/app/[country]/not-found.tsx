import Link from 'next/link';
import { clasesBoton } from '@izao/ui';
import { T } from '@/lib/store/textos';

export default function NoEncontrada() {
  return (
    <div className="mx-auto flex min-h-[50dvh] max-w-3xl flex-col items-start justify-center gap-5 px-6 py-20">
      <p className="etiqueta text-ink/70">404</p>
      <h1 className="text-5xl">{T.errores.noExiste}</h1>
      <p className="text-lg">{T.errores.noExisteAyuda}</p>
      <Link href="/" className={clasesBoton({ variante: 'secundario' })}>
        {T.marca.irInicio}
      </Link>
    </div>
  );
}
