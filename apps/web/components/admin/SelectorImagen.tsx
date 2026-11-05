'use client';

import { useId, useState } from 'react';

export type ImagenInicial = { id: string; ruta: string; alt: string } | null;

type Subida = { id: string; variants: Record<string, string>; alt: string };

/**
 * Sube una imagen a `POST /api/admin/media` y deja su id en un campo oculto.
 * El texto alternativo es obligatorio (accesibilidad y SEO, §27.1).
 */
export function SelectorImagen({
  nombre,
  etiqueta,
  kind,
  inicial,
  ayuda,
  recorte45 = false,
  variante,
  alCambiar,
  error,
}: {
  nombre: string;
  etiqueta: string;
  kind: 'product' | 'banner' | 'site' | 'category' | 'review' | 'warranty' | 'expense';
  inicial?: ImagenInicial | undefined;
  ayuda?: string | undefined;
  recorte45?: boolean;
  /** Solo banners: el servidor procesa escritorio y móvil con anchos distintos. */
  variante?: 'desktop' | 'movil';
  /** Avisa a la vista previa del formulario cuando cambia la imagen elegida. */
  alCambiar?: (imagen: ImagenInicial) => void;
  error?: string | undefined;
}) {
  const id = useId();
  const [actual, setActual] = useState<ImagenInicial>(inicial ?? null);
  const [alt, setAlt] = useState(inicial?.alt ?? '');
  const [subiendo, setSubiendo] = useState(false);
  const [falla, setFalla] = useState<string | null>(null);

  async function alElegir(archivo: File | undefined) {
    if (!archivo) return;
    setFalla(null);
    if (alt.trim().length < 3) {
      setFalla('Primero describe la imagen (texto alternativo de al menos 3 caracteres).');
      return;
    }
    setSubiendo(true);
    try {
      const datos = new FormData();
      datos.set('file', archivo);
      datos.set('kind', kind);
      datos.set('alt', alt.trim());
      datos.set('recorte45', String(recorte45));
      if (variante) datos.set('variante', variante);
      const r = await fetch('/api/admin/media', { method: 'POST', body: datos });
      const cuerpo = (await r.json().catch(() => ({}))) as Partial<Subida> & { error?: string };
      if (!r.ok || !cuerpo.id) {
        setFalla(cuerpo.error ?? 'No se pudo subir la imagen.');
        return;
      }
      // Miniatura: la variante más chica que exista (los banners no tienen 400 en escritorio).
      const ancho = Object.keys(cuerpo.variants ?? {}).map(Number).sort((a, b) => a - b)[0];
      const nueva = { id: cuerpo.id, ruta: ancho ? (cuerpo.variants?.[String(ancho)] ?? '') : '', alt: cuerpo.alt ?? alt };
      setActual(nueva);
      alCambiar?.(nueva);
    } catch {
      setFalla('No se pudo subir la imagen. Revisa tu conexión.');
    } finally {
      setSubiendo(false);
    }
  }

  const mensaje = falla ?? error;
  return (
    <fieldset className="adm-fieldset">
      <legend>{etiqueta}</legend>
      <input type="hidden" name={nombre} value={actual?.id ?? ''} />
      {actual?.ruta ? (
        <img className="adm-miniatura" src={`/media/${actual.ruta}`} alt={actual.alt} />
      ) : (
        <p className="adm-suave adm-chico">Sin imagen.</p>
      )}
      <div className="adm-campo">
        <label htmlFor={`${id}-alt`} className="adm-etiqueta">
          Texto alternativo
        </label>
        <input
          id={`${id}-alt`}
          className="adm-input"
          value={alt}
          maxLength={200}
          onChange={(e) => setAlt(e.target.value)}
          placeholder="Describe lo que se ve en la imagen"
        />
      </div>
      <div className="adm-campo">
        <label htmlFor={`${id}-archivo`} className="adm-etiqueta">
          {actual ? 'Reemplazar imagen' : 'Subir imagen'}
        </label>
        <input
          id={`${id}-archivo`}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif"
          disabled={subiendo}
          onChange={(e) => void alElegir(e.target.files?.[0])}
        />
        <p className="adm-suave adm-chico">
          JPG, PNG, WebP o AVIF; se convierte a WebP al subir. {ayuda ?? ''} {subiendo ? 'Subiendo…' : ''}
        </p>
      </div>
      {actual ? (
        <button type="button" className="adm-boton adm-boton-secundario" onClick={() => {
            setActual(null);
            alCambiar?.(null);
          }}
        >
          Quitar imagen
        </button>
      ) : null}
      {mensaje ? (
        <p className="adm-error-campo" role="alert">
          {mensaje}
        </p>
      ) : null}
    </fieldset>
  );
}
