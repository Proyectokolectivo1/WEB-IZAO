'use client';

import { useId, useState } from 'react';
import { enviarSubida, type FalloSubida } from '@/lib/admin/mensaje-subida';
import { AvisoSubida } from './AvisoSubida';

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
  altControlado,
  anchoVista = 0,
  alCambiar,
  sugerencia,
  error,
}: {
  nombre: string;
  etiqueta: string;
  kind: 'product' | 'banner' | 'site' | 'category' | 'review' | 'warranty' | 'expense';
  inicial?: ImagenInicial | undefined;
  ayuda?: string | undefined;
  recorte45?: boolean;
  /** Solo banners: sin valor = una imagen responsive (480…2400); `desktop`/`movil` son los conjuntos antiguos. */
  variante?: 'unica' | 'desktop' | 'movil';
  /**
   * Texto alternativo que ya se pide en otro campo del formulario: si se indica, este selector no lo repite y usa
   * ese valor al subir.
   */
  altControlado?: string;
  /** Ancho mínimo de la variante que se muestra como miniatura (0 = la más chica). */
  anchoVista?: number;
  /** Avisa a la vista previa del formulario cuando cambia la imagen elegida. */
  alCambiar?: (imagen: ImagenInicial) => void;
  /** Nombre del elemento (categoría, producto) ya conocido en el formulario: solo se muestra como ejemplo en el campo. */
  sugerencia?: string | undefined;
  error?: string | undefined;
}) {
  const id = useId();
  const [actual, setActual] = useState<ImagenInicial>(inicial ?? null);
  const [altPropio, setAlt] = useState(inicial?.alt ?? '');
  const alt = altControlado ?? altPropio;
  const [subiendo, setSubiendo] = useState(false);
  const [falla, setFalla] = useState<FalloSubida | string | null>(null);

  async function alElegir(archivo: File | undefined) {
    if (!archivo) return;
    setFalla(null);
    if (alt.trim().length < 3) {
      setFalla(
        altControlado !== undefined
          ? 'Primero escribe el texto alternativo del banner (al menos 3 caracteres).'
          : 'Primero describe la imagen (texto alternativo de al menos 3 caracteres).',
      );
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
      const r = await enviarSubida<Subida>('/api/admin/media', datos, { valida: (c) => Boolean(c.id) });
      if (!r.ok) {
        setFalla(r.fallo);
        return;
      }
      const cuerpo = r.cuerpo;
      // Miniatura: la variante más chica con el ancho pedido (o la mayor si ninguna llega).
      const anchos = Object.keys(cuerpo.variants ?? {}).map(Number).sort((a, b) => a - b);
      const ancho = anchos.find((a) => a >= anchoVista) ?? anchos.at(-1);
      const nueva = { id: cuerpo.id, ruta: ancho ? (cuerpo.variants?.[String(ancho)] ?? '') : '', alt: cuerpo.alt ?? alt };
      setActual(nueva);
      alCambiar?.(nueva);
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
      {altControlado === undefined ? (
        <div className="adm-campo">
          <label htmlFor={`${id}-alt`} className="adm-etiqueta">
            Texto alternativo
          </label>
          <input
            id={`${id}-alt`}
            className="adm-input"
            value={altPropio}
            maxLength={200}
            onChange={(e) => setAlt(e.target.value)}
            placeholder={sugerencia?.trim() ? `Ej.: ${sugerencia.trim()}` : 'Describe lo que se ve en la imagen'}
          />
        </div>
      ) : null}
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
      <AvisoSubida fallo={mensaje} />
    </fieldset>
  );
}
