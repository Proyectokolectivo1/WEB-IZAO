import { RUTA_ENTRADA_PANEL, TEXTOS_SUBIDA, type FalloSubida } from '@/lib/admin/mensaje-subida';

/**
 * Aviso de fallo de una subida (rojo, accesible). Si se perdió la sesión ofrece entrar de nuevo en otra pestaña para no
 * perder lo que ya se escribió en el formulario.
 */
export function AvisoSubida({ fallo }: { fallo: FalloSubida | string | null | undefined }) {
  if (!fallo) return null;
  const texto = typeof fallo === 'string' ? fallo : fallo.texto;
  const requiereLogin = typeof fallo === 'string' ? false : fallo.requiereLogin;
  return (
    <p className="adm-error-campo" role="alert">
      {texto}
      {requiereLogin ? (
        <>
          {' '}
          <a href={RUTA_ENTRADA_PANEL} target="_blank" rel="noopener noreferrer">
            {TEXTOS_SUBIDA.entrarAlPanel}
          </a>
        </>
      ) : null}
    </p>
  );
}
