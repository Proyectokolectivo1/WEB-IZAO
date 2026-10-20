import { redirect } from 'next/navigation';
import { requerirAdmin } from '@/lib/auth/guard';

export default async function PaginaAtributos() {
  await requerirAdmin({ modulo: 'catalogo_auxiliar' });
  redirect('/admin/atributos/marcas');
}
