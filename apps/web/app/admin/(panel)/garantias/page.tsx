import type { Metadata } from 'next';
import { EnConstruccion } from '@/components/admin/EnConstruccion';
import { requerirAdmin } from '@/lib/auth/guard';

export const metadata: Metadata = { title: 'Garantías' };

export default async function PaginaGarantias() {
  await requerirAdmin({ modulo: 'garantias', accion: 'garantias.gestionar' });
  return <EnConstruccion titulo="Garantías" />;
}
