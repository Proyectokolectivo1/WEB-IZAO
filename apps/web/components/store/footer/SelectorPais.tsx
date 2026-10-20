'use client';

import { usePathname } from 'next/navigation';
import { PAISES, hreflangDe } from '@/lib/store/pais';
import { T } from '@/lib/store/textos';
import type { CodigoPais } from '@/lib/store/types';

/**
 * Selector de país (§5.1). Cada opción pasa por `/{país}/cambiar-pais`, que guarda la cookie `country`
 * y conserva la ruta si el producto se vende en el otro país; si no, lleva al inicio de ese país.
 */
export function SelectorPais({ pais, id }: { pais: CodigoPais; id: string }) {
  const ruta = usePathname();
  const sinPais = ruta.replace(/^\/(co|ec)/, '') || '/';
  const destino = sinPais;

  return (
    <ul aria-labelledby={id} className="space-y-1">
      {PAISES.map((p) => (
        <li key={p}>
          <a
            href={`/${pais}/cambiar-pais?a=${p}&ruta=${encodeURIComponent(destino)}`}
            hrefLang={hreflangDe(p)}
            aria-current={p === pais ? 'true' : undefined}
            className={`inline-flex min-h-11 items-center text-[0.9375rem] underline-offset-4 hover:underline ${p === pais ? 'underline' : ''}`}
          >
            {T.paises[p]}
          </a>
        </li>
      ))}
    </ul>
  );
}
