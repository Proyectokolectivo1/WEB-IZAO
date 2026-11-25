import { ControlPixel } from './ControlPixel';

/**
 * Meta Pixel de la tienda (§23.2). `pixelId` es el del país (`pixelIdDePais`, que lee la credencial `meta_pixel` activa;
 * CO y EC son distintos); sin él no renderiza nada. Solo viaja el id público: el token de la API de Conversiones se queda en
 * el servidor. Va en el layout del país, así que `/admin` (fuera de `[country]`) nunca lo carga.
 *
 * Opt-in estricto: este componente es el único punto donde se condiciona la carga. No pinta ningún `<script>` ni `<img>` en el
 * HTML (tampoco el `<noscript>` de Meta: sin JavaScript no hay consentimiento posible); `ControlPixel` solo arranca el Pixel
 * cuando la persona acepta el marketing en el aviso de cookies.
 */
export function MetaPixel({ pixelId }: { pixelId: string | null }) {
  if (!pixelId) return null;
  return <ControlPixel pixelId={pixelId} />;
}
