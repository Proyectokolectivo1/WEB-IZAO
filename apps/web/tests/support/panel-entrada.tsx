/**
 * Entrada que esbuild empaqueta para las pruebas del panel adaptable (`e2e/panel-responsive.spec.ts`): monta en el
 * navegador el `CascaronAdmin` REAL (y las pantallas de acceso reales) con una página de ejemplo dentro.
 * `window.__PANEL__` la pone la prueba: `{ pagina, html }`.
 */
import { createRoot } from 'react-dom/client';
import { CascaronAdmin } from '@/components/admin/CascaronAdmin';
import { FormularioLogin } from '@/components/admin/FormularioLogin';
import { PantallaAcceso } from '@/components/admin/PantallaAcceso';
import { modulosVisibles } from '@/lib/auth/permissions';

declare global {
  interface Window {
    __PANEL__?: { pagina: string; html: string };
  }
}

const { pagina, html } = window.__PANEL__ ?? { pagina: 'login', html: '' };

function App() {
  if (pagina === 'login') {
    return (
      <PantallaAcceso titulo="Entrar al panel" descripcion="Usa el correo y la contraseña de tu cuenta.">
        <FormularioLogin claveCaptcha={null} />
      </PantallaAcceso>
    );
  }
  return (
    <CascaronAdmin
      items={modulosVisibles('admin')}
      nombre="Dueña de Izao"
      rol="Administrador"
      cerrarSesion={
        <form>
          <button type="submit" className="adm-boton adm-boton-secundario">
            Cerrar sesión
          </button>
        </form>
      }
    >
      <div style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: html }} />
    </CascaronAdmin>
  );
}

const raiz = document.getElementById('raiz');
if (raiz) createRoot(raiz).render(<div className="adm"><App /></div>);
