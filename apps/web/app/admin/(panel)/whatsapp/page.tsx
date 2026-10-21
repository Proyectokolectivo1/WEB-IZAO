import { redirect } from 'next/navigation';
import { requerirAdmin } from '@/lib/auth/guard';

export default async function PaginaWhatsApp() {
  await requerirAdmin({ modulo: 'whatsapp' });
  redirect('/admin/whatsapp/plantillas');
}
