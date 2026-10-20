import Link from 'next/link';
import { NOMBRE_PAIS, PAISES_CATALOGO, type PaisCatalogo } from '@/lib/admin/catalogo/categorias';

/** Selector de país por enlaces: el país queda en la URL (`?pais=CO`). */
export function PestanasPais({ base, actual }: { base: string; actual: PaisCatalogo }) {
  return (
    <ul className="adm-pestanas" aria-label="País">
      {PAISES_CATALOGO.map((p) => (
        <li key={p}>
          <Link href={`${base}?pais=${p}`} aria-current={p === actual ? 'page' : undefined}>
            {NOMBRE_PAIS[p]}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Lee `?pais=` con valor seguro (CO por defecto). */
export function leerPais(valor: string | string[] | undefined): PaisCatalogo {
  const v = Array.isArray(valor) ? valor[0] : valor;
  return v === 'EC' ? 'EC' : 'CO';
}
