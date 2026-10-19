import type { Metadata } from 'next';
import { BotonCerrarSesion } from '@/components/admin/BotonCerrarSesion';
import { InscripcionMfa } from '@/components/admin/InscripcionMfa';
import { PantallaAcceso } from '@/components/admin/PantallaAcceso';
import { rutaSiguienteSegura } from '@/lib/auth/decision';
import { requerirSesionParcial } from '@/lib/auth/guard';

export const metadata: Metadata = { title: 'Activar verificación en dos pasos' };

type Props = { searchParams: Promise<{ siguiente?: string }> };

export default async function PaginaInscribirMfa({ searchParams }: Props) {
  await requerirSesionParcial();
  const destino = rutaSiguienteSegura((await searchParams).siguiente);

  return (
    <PantallaAcceso
      titulo="Activa la verificación en dos pasos"
      descripcion="El panel exige un código de tu aplicación de autenticación cada vez que ingresas."
    >
      <InscripcionMfa {...(destino !== '/admin' ? { siguiente: destino } : {})} />
      <BotonCerrarSesion />
    </PantallaAcceso>
  );
}
