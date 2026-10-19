import { cerrarSesion } from '@/app/admin/acciones';

export function BotonCerrarSesion() {
  return (
    <form action={cerrarSesion}>
      <button type="submit" className="adm-boton adm-boton-secundario">
        Cerrar sesión
      </button>
    </form>
  );
}
