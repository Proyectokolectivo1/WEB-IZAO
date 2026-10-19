import type { ReactNode } from 'react';
import { BotonCerrarSesion } from '@/components/admin/BotonCerrarSesion';
import { NavegacionAdmin } from '@/components/admin/NavegacionAdmin';
import { requerirAdmin } from '@/lib/auth/guard';
import { ETIQUETA_ROL, modulosVisibles } from '@/lib/auth/permissions';

/**
 * Estructura del panel autenticado. Cada página vuelve a verificar su módulo
 * con `requerirAdmin({ modulo })`: este layout solo exige sesión completa.
 */
export default async function LayoutPanel({ children }: { children: ReactNode }) {
  const admin = await requerirAdmin();
  const modulos = modulosVisibles(admin.rol);

  return (
    <div className="adm-panel">
      <a href="#contenido" className="adm-saltar">
        Saltar al contenido
      </a>
      <aside className="adm-lateral">
        <p className="adm-marca">Izao Perfumería</p>
        <NavegacionAdmin items={modulos} />
      </aside>
      <div className="adm-principal">
        <header className="adm-barra">
          <div className="adm-usuario">
            <strong>{admin.nombre}</strong>
            <small>{ETIQUETA_ROL[admin.rol]}</small>
          </div>
          <BotonCerrarSesion />
        </header>
        <main id="contenido" className="adm-contenido">
          {children}
        </main>
      </div>
    </div>
  );
}
