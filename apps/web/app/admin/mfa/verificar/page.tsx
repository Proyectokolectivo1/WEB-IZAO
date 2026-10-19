import type { Metadata } from 'next';
import { BotonCerrarSesion } from '@/components/admin/BotonCerrarSesion';
import { PantallaAcceso } from '@/components/admin/PantallaAcceso';
import { VerificacionMfa } from '@/components/admin/VerificacionMfa';
import { rutaSiguienteSegura } from '@/lib/auth/decision';
import { requerirSesionParcial } from '@/lib/auth/guard';

export const metadata: Metadata = { title: 'Verificar código' };

type Props = { searchParams: Promise<{ siguiente?: string }> };

export default async function PaginaVerificarMfa({ searchParams }: Props) {
  await requerirSesionParcial();
  const destino = rutaSiguienteSegura((await searchParams).siguiente);

  return (
    <PantallaAcceso
      titulo="Verifica tu identidad"
      descripcion="Escribe el código de 6 dígitos de tu aplicación de autenticación."
    >
      <VerificacionMfa {...(destino !== '/admin' ? { siguiente: destino } : {})} />
      <BotonCerrarSesion />
    </PantallaAcceso>
  );
}
