import Link from 'next/link';
import { clasesBoton } from '@izao/ui';
import { T } from '@/lib/store/textos';

/**
 * 404 fuera de cualquier país (rutas sin prefijo `/co` o `/ec`). Sin esta página, Next pinta la suya con
 * una fuente fija del sistema; así hereda las variables del tema (`--font-display` / `--font-body`) del layout raíz.
 */
export default function NoEncontradaGlobal() {
  return (
    <main className="mx-auto flex min-h-[60dvh] max-w-3xl flex-col items-start justify-center gap-5 px-6 py-20">
      <p className="etiqueta text-ink/70">404</p>
      <h1 className="text-5xl">{T.errores.noExiste}</h1>
      <p className="text-lg">{T.errores.noExisteAyuda}</p>
      <Link href="/" className={clasesBoton({ variante: 'secundario' })}>
        {T.marca.irInicio}
      </Link>
    </main>
  );
}
