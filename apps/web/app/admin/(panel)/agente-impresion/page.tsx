import type { Metadata } from 'next';
import { EnConstruccion } from '@/components/admin/EnConstruccion';
import { requerirAdmin } from '@/lib/auth/guard';

export const metadata: Metadata = { title: 'Agente de impresión' };

export default async function PaginaAgenteImpresion() {
  await requerirAdmin({ modulo: 'agente', accion: 'agente.ver_estado' });
  return <EnConstruccion titulo="Agente de impresión" />;
}
