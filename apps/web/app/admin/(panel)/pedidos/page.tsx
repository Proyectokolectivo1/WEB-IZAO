import type { Metadata } from 'next';
import { EnConstruccion } from '@/components/admin/EnConstruccion';
import { requerirAdmin } from '@/lib/auth/guard';

export const metadata: Metadata = { title: 'Pedidos' };

export default async function PaginaPedidos() {
  await requerirAdmin({ modulo: 'pedidos', accion: 'pedidos.ver' });
  return <EnConstruccion titulo="Pedidos" />;
}
