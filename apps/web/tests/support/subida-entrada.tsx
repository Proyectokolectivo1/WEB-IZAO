/**
 * Entrada que esbuild empaqueta para `e2e/admin-subida-mensaje.spec.ts`: monta en el navegador el `SelectorImagen` REAL
 * (el panel completo exige sesión con MFA, que el Supabase falso no simula).
 */
import { createRoot } from 'react-dom/client';
import { SelectorImagen } from '@/components/admin/SelectorImagen';

const raiz = document.getElementById('raiz');
if (raiz) {
  createRoot(raiz).render(
    <div className="adm">
      <SelectorImagen nombre="image_id" etiqueta="Imagen de la categoría" kind="category" sugerencia="Árabes" />
    </div>,
  );
}
