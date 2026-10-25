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
  error,
}: {
  nombre: string;
  etiqueta: string;
  kind: 'product' | 'banner' | 'site' | 'category' | 'review' | 'warranty' | 'expense';
  inicial?: ImagenInicial | undefined;
  ayuda?: string | undefined;
  recorte45?: boolean;
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
      const r = await fetch('/api/admin/media', { method: 'POST', body: datos });
      const cuerpo = (await r.json().catch(() => ({}))) as Partial<Subida> & { error?: string };
      if (!r.ok || !cuerpo.id) {
        setFalla(cuerpo.error ?? 'No se pudo subir la imagen.');
        return;
      }
      setActual({ id: cuerpo.id, ruta: cuerpo.variants?.['400'] ?? '', alt: cuerpo.alt ?? alt });
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
          accept="image/jpeg,image/png,image/webp"
          disabled={subiendo}
          onChange={(e) => void alElegir(e.target.files?.[0])}
        />
        <p className="adm-suave adm-chico">
          JPG, PNG o WebP hasta 15 MB. {ayuda ?? ''} {subiendo ? 'Subiendo…' : ''}
        </p>
      </div>
      {actual ? (
        <button type="button" className="adm-boton adm-boton-secundario" onClick={() => setActual(null)}>
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
