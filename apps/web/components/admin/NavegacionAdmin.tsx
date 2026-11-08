'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export type ItemNavegacion = { id: string; etiqueta: string; ruta: string };

export function NavegacionAdmin({ items }: { items: ItemNavegacion[] }) {
  const actual = usePathname() ?? '';
  return (
    <nav aria-label="Módulos del panel">
      <ul className="adm-nav">
        {items.map((item) => {
          const activo =
            item.ruta === '/admin' ? actual === '/admin' : actual.startsWith(item.ruta);
          return (
            <li key={item.id}>
              <Link href={item.ruta} aria-current={activo ? 'page' : undefined}>
                {item.etiqueta}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
