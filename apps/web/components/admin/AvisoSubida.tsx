import {
  RUTA_ENTRADA_PANEL,
  TEXTOS_SUBIDA,
  mensajeAltListo,
  mensajeAltPendiente,
  type FalloSubida,
} from '@/lib/admin/mensaje-subida';

/**
 * Archivo(s) elegido(s) que esperan su texto alternativo. No es un error: aviso neutro en una región `aria-live` que
 * siempre está en la página (así los lectores de pantalla anuncian el cambio) y botones «Subir ahora» / «Descartar».
 */
export function AvisoAltPendiente({
  archivos,
  altListo,
  subiendo,
  alSubir,
  alDescartar,
}: {
  archivos: readonly string[];
  altListo: boolean;
  subiendo: boolean;
  alSubir: () => void;
  alDescartar: () => void;
}) {
  const hay = archivos.length > 0;
  return (
    <div className="adm-pendiente-zona">
      <div role="status" aria-live="polite" className={hay ? 'adm-aviso adm-pendiente' : undefined} data-pendiente={hay ? 'si' : undefined}>
        {hay ? (
          <>
            <strong>{altListo ? mensajeAltListo(archivos) : mensajeAltPendiente(archivos)}</strong>
            {altListo ? null : <> {TEXTOS_SUBIDA.altGuia}</>}
          </>
        ) : null}
      </div>
      {hay ? (
        <div className="adm-acciones">
          <button type="button" className="adm-boton" disabled={subiendo} onClick={alSubir}>
            {TEXTOS_SUBIDA.subirAhora}
          </button>
          <button type="button" className="adm-boton adm-boton-secundario" disabled={subiendo} onClick={alDescartar}>
            {TEXTOS_SUBIDA.descartarPendiente}
          </button>
        </div>
      ) : null}
    </div>
  );
}

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
