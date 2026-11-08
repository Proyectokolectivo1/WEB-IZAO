import type { ReactNode } from 'react';
import { BotonCerrarSesion } from '@/components/admin/BotonCerrarSesion';
import { CascaronAdmin } from '@/components/admin/CascaronAdmin';
import { requerirAdmin } from '@/lib/auth/guard';
import { ETIQUETA_ROL, modulosVisibles } from '@/lib/auth/permissions';

/**
 * Estructura del panel autenticado. Cada página vuelve a verificar su módulo
 * con `requerirAdmin({ modulo })`: este layout solo exige sesión completa.
 * El menú (columna fija en escritorio, hoja en celular y tablet) vive en `CascaronAdmin`.
 */
export default async function LayoutPanel({ children }: { children: ReactNode }) {
  const admin = await requerirAdmin();
  const modulos = modulosVisibles(admin.rol);

  return (
    <CascaronAdmin items={modulos} nombre={admin.nombre} rol={ETIQUETA_ROL[admin.rol]} cerrarSesion={<BotonCerrarSesion />}>
      {children}
    </CascaronAdmin>
  );
}
