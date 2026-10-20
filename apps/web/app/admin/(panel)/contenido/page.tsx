import type { Metadata } from 'next';
import Link from 'next/link';
import { requerirAdmin } from '@/lib/auth/guard';

export const metadata: Metadata = { title: 'Contenido' };

export default async function Contenido() {
  await requerirAdmin({ modulo: 'contenido' });
  return (
    <>
      <h1>Contenido</h1>
      <div className="adm-rejilla">
        <Link href="/admin/contenido/paginas" className="adm-atajo">
          <strong>Páginas y políticas</strong>
          <span className="adm-suave adm-chico">Quiénes somos, envíos, datos, términos y devoluciones, por país.</span>
        </Link>
      </div>
    </>
  );
}
