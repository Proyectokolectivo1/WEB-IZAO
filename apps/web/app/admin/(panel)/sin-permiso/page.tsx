import type { Metadata } from 'next';
import Link from 'next/link';
import { requerirAdmin } from '@/lib/auth/guard';

export const metadata: Metadata = { title: 'Sin permiso' };

export default async function PaginaSinPermiso() {
  await requerirAdmin();
  return (
    <>
      <h1>No tienes permiso para esta sección</h1>
      <p className="adm-suave">
        Tu rol no incluye este módulo. Si lo necesitas, pídele acceso al administrador.
      </p>
      <p>
        <Link href="/admin">Volver al inicio</Link>
      </p>
    </>
  );
}
