/**
 * Entrada que esbuild empaqueta para `e2e/admin-producto-eliminar.spec.ts`: monta en el navegador la fila de la lista
 * de productos con los botones REALES (`BotonConfirmar`) y el texto REAL de la confirmación (`MENSAJE_ELIMINAR`). El
 * panel completo exige sesión de administrador, que el Supabase falso no simula, así que la Server Action se reemplaza
 * por una función que registra la llamada y devuelve lo que decide `window.__ELIMINAR__.resultado` (lo que en producción
 * decide la base: `eliminado`, `archivado` por tener pedidos, o un error).
 */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BotonConfirmar } from '@/components/admin/BotonConfirmar';
import { MENSAJE_ELIMINAR } from '@/lib/admin/catalogo/productos';
import type { ResultadoAccion } from '@/lib/admin/crud/comun';

declare global {
  interface Window {
    __ELIMINAR__?: {
      nombre: string;
      estado: 'active' | 'archived';
      resultado: 'eliminado' | 'archivado' | 'error';
      llamadas: string[];
    };
  }
}

const cfg = window.__ELIMINAR__ ?? { nombre: 'Producto', estado: 'active' as const, resultado: 'eliminado' as const, llamadas: [] };

function Fila() {
  const [aviso, setAviso] = useState('');
  const [presente, setPresente] = useState(true);
  const [estado, setEstado] = useState(cfg.estado);

  const eliminar = async (): Promise<ResultadoAccion> => {
    cfg.llamadas.push('eliminar');
    if (cfg.resultado === 'error') return { ok: false, mensaje: 'No se pudo eliminar el producto. Inténtalo de nuevo.' };
    if (cfg.resultado === 'archivado') {
      setEstado('archived');
      setAviso('El producto tiene pedidos, así que no se borró: quedó archivado y ya no se muestra en la tienda.');
    } else {
      setPresente(false);
      setAviso('Producto eliminado.');
    }
    return { ok: true };
  };
  const restaurar = async (): Promise<ResultadoAccion> => {
    cfg.llamadas.push('restaurar');
    setEstado('active');
    return { ok: true };
  };

  return (
    <>
      {aviso ? (
        <p className="adm-ok" role="status">
          {aviso}
        </p>
      ) : null}
      <table className="adm-tabla">
        <thead>
          <tr>
            <th scope="col">Producto</th>
            <th scope="col">Estado</th>
            <th scope="col">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {presente ? (
            <tr>
              <td>{cfg.nombre}</td>
              <td>{estado === 'archived' ? 'Archivado' : 'Activo'}</td>
              <td>
                <div className="adm-acciones">
                  {estado === 'archived' ? (
                    <BotonConfirmar
                      etiqueta="Restaurar"
                      mensaje={`«${cfg.nombre}» vuelve como borrador, oculto en todos los países.`}
                      etiquetaConfirmar="Sí, restaurar"
                      peligro={false}
                      accion={restaurar}
                    />
                  ) : null}
                  <BotonConfirmar etiqueta="Eliminar" mensaje={MENSAJE_ELIMINAR(cfg.nombre)} etiquetaConfirmar="Sí, eliminar" accion={eliminar} />
                </div>
              </td>
            </tr>
          ) : (
            <tr>
              <td colSpan={3}>Aún no hay productos.</td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}

const raiz = document.getElementById('raiz');
if (raiz) {
  createRoot(raiz).render(
    <div className="adm">
      <Fila />
    </div>,
  );
}
