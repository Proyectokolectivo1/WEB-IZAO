'use client';

import { useId, useRef, useState } from 'react';
import { TEXTOS_SUBIDA, altSuficiente, enviarSubida, type FalloSubida } from '@/lib/admin/mensaje-subida';
import { AvisoAltPendiente, AvisoSubida } from './AvisoSubida';

export type ImagenInicial = { id: string; ruta: string; alt: string } | null;

type Subida = { id: string; variants: Record<string, string>; alt: string };

/**
 * Sube una imagen a `POST /api/admin/media` y deja su id en un campo oculto.
 * El texto alternativo es obligatorio (accesibilidad y SEO, §27.1): el campo va antes del archivo. Si se elige el archivo
 * sin descripción suficiente, queda pendiente (no se pierde), se lleva el foco al campo y se sube con «Subir ahora».
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
  idCampoAlt,
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
  /** Con `altControlado`: id del campo de texto alternativo del formulario, para llevarle el foco cuando falta. */
  idCampoAlt?: string;
  /** Ancho mínimo de la variante que se muestra como miniatura (0 = la más chica). */
  anchoVista?: number;
  /** Avisa a la vista previa del formulario cuando cambia la imagen elegida. */
  alCambiar?: (imagen: ImagenInicial) => void;
  /** Nombre del elemento (categoría, producto) ya conocido en el formulario: solo se muestra como ejemplo en el campo. */
  sugerencia?: string | undefined;
  error?: string | undefined;
}) {
  const id = useId();
  const refAlt = useRef<HTMLInputElement>(null);
  const refArchivo = useRef<HTMLInputElement>(null);
  const [actual, setActual] = useState<ImagenInicial>(inicial ?? null);
  const [altPropio, setAlt] = useState(inicial?.alt ?? '');
  const alt = altControlado ?? altPropio;
  const [subiendo, setSubiendo] = useState(false);
  const [falla, setFalla] = useState<FalloSubida | string | null>(null);
  /** Archivo elegido que espera su texto alternativo. */
  const [pendiente, setPendiente] = useState<File | null>(null);

  function enfocarAlt() {
    const campo = altControlado !== undefined ? (idCampoAlt ? document.getElementById(idCampoAlt) : null) : refAlt.current;
    campo?.focus();
  }

  function descartar() {
    setPendiente(null);
    if (refArchivo.current) refArchivo.current.value = '';
  }

  async function subir(archivo: File) {
    setFalla(null);
    setPendiente(null);
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
      if (refArchivo.current) refArchivo.current.value = '';
    }
  }

  function alElegir(archivo: File | undefined) {
    setFalla(null);
    if (!archivo) {
      setPendiente(null);
      return;
    }
    if (!altSuficiente(alt)) {
      // No es un error: el archivo queda pendiente y se pide la descripción.
      setPendiente(archivo);
      enfocarAlt();
      return;
    }
    void subir(archivo);
  }

  function subirPendiente() {
    if (!pendiente) return;
    if (!altSuficiente(alt)) {
      enfocarAlt();
      return;
    }
    void subir(pendiente);
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
            ref={refAlt}
            id={`${id}-alt`}
            className="adm-input"
            value={altPropio}
            maxLength={200}
            aria-describedby={`${id}-alt-ayuda`}
            onChange={(e) => setAlt(e.target.value)}
            placeholder={sugerencia?.trim() ? `Ej.: ${sugerencia.trim()}` : 'Describe lo que se ve en la imagen'}
          />
          <p id={`${id}-alt-ayuda`} className="adm-suave adm-chico">
            {TEXTOS_SUBIDA.ayudaAlt}
          </p>
        </div>
      ) : null}
      <div className="adm-campo">
        <label htmlFor={`${id}-archivo`} className="adm-etiqueta">
          {actual ? 'Reemplazar imagen' : 'Subir imagen'}
        </label>
        <input
          ref={refArchivo}
          id={`${id}-archivo`}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif"
          disabled={subiendo}
          onChange={(e) => alElegir(e.target.files?.[0])}
        />
        <p className="adm-suave adm-chico">
          JPG, PNG, WebP o AVIF; se convierte a WebP al subir. {ayuda ?? ''} {subiendo ? 'Subiendo…' : ''}
        </p>
      </div>
      <AvisoAltPendiente
        archivos={pendiente ? [pendiente.name] : []}
        altListo={altSuficiente(alt)}
        subiendo={subiendo}
        alSubir={subirPendiente}
        alDescartar={descartar}
      />
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
