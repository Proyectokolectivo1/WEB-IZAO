import { Suspense } from 'react';
import { guionPixel, urlNoscript } from '@/lib/store/analitica/guion-pixel';
import { NavegacionPixel } from './NavegacionPixel';

/**
 * Meta Pixel de la tienda (§23.2). `pixelId` es el del país (`pixelIdDePais`, que lee la credencial `meta_pixel` activa;
 * CO y EC son distintos); sin él no renderiza nada. Pinta el guion con ese id y el `PageView` de las navegaciones del App
 * Router. Solo viaja el id público: el token de la API de Conversiones se queda en el servidor. Va en el layout del país,
 * así que `/admin` (fuera de `[country]`) nunca lo carga.
 *
 * Aún no existe aviso de cookies en la tienda (la especificación §23.2 pide uno con carga tras aceptar): mientras no
 * exista, el Pixel carga directamente. Cuando se agregue, este componente es el único punto donde condicionar la carga.
 */
export function MetaPixel({ pixelId }: { pixelId: string | null }) {
  if (!pixelId) return null;
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: guionPixel(pixelId) }} />
      {/* Sin JavaScript, el mismo PageView por imagen (código base de Meta), con el Pixel ID del país. */}
      <noscript>
        <img height="1" width="1" alt="" style={{ display: 'none' }} src={urlNoscript(pixelId)} />
      </noscript>
      <Suspense fallback={null}>
        <NavegacionPixel pixelId={pixelId} />
      </Suspense>
    </>
  );
}
