'use client';

import { useId, useRef, useState } from 'react';
import {
  ETIQUETA_ROL_IMAGEN,
  ROLES_IMAGEN,
  mover,
  normalizarImagenes,
  type ImagenForm,
  type RolImagen,
} from '@/lib/admin/catalogo/productos';
import { TEXTOS_SUBIDA, ALT_MINIMO, enviarSubida, type FalloSubida } from '@/lib/admin/mensaje-subida';
import { AvisoAltPendiente, AvisoSubida } from './AvisoSubida';

type Subida = { id: string; variants: Record<string, string>; alt: string };

/**
 * Galería del producto: subir varias imágenes (texto alternativo obligatorio), elegir principal y de cursor,
 * reordenar y quitar. Si se eligen archivos sin descripción suficiente quedan pendientes (no se pierden) y se suben con
 * «Subir ahora». Sube por `POST /api/admin/media` con recorte 4:5 (§ imágenes).
 */
export function ProductoImagenes({
  imagenes,
  alCambiar,
  altSugerido,
  error,
}: {
  imagenes: readonly ImagenForm[];
  alCambiar: (siguientes: ImagenForm[]) => void;
  altSugerido: string;
  error?: string | undefined;
}) {
  const id = useId();
  const [alt, setAlt] = useState('');
  const [subiendo, setSubiendo] = useState(false);
  const [falla, setFalla] = useState<FalloSubida | string | null>(null);
  /** Archivos elegidos que esperan su texto alternativo. */
  const [pendientes, setPendientes] = useState<File[]>([]);
  const refAlt = useRef<HTMLInputElement>(null);
  const textoAlt = alt.trim() || altSugerido.trim();
  const altListo = textoAlt.length >= ALT_MINIMO;

  async function subir(archivos: readonly File[]) {
    if (archivos.length === 0) return;
    setFalla(null);
    setPendientes([]);
    setSubiendo(true);
    const nuevas: ImagenForm[] = [];
    try {
      for (const archivo of archivos) {
        const datos = new FormData();
        datos.set('file', archivo);
        datos.set('kind', 'product');
        datos.set('alt', textoAlt);
        datos.set('recorte45', 'true');
        const r = await enviarSubida<Subida>('/api/admin/media', datos, {
          valida: (c) => Boolean(c.id),
          ...(archivos.length > 1 ? { archivo: archivo.name } : {}),
        });
        if (!r.ok) {
          setFalla(r.fallo);
          break;
        }
        const cuerpo = r.cuerpo;
        nuevas.push({ media_id: cuerpo.id, role: 'gallery', ruta: cuerpo.variants?.['400'] ?? '', alt: cuerpo.alt ?? textoAlt });
      }
    } finally {
      setSubiendo(false);
      if (nuevas.length) alCambiar(normalizarImagenes([...imagenes, ...nuevas]));
    }
  }

  function alElegir(archivos: File[]) {
    setFalla(null);
    if (archivos.length === 0) return;
    if (!altListo) {
      // No es un error: quedan pendientes y se pide la descripción.
      setPendientes(archivos);
      refAlt.current?.focus();
      return;
    }
    void subir(archivos);
  }

  function subirPendientes() {
    if (!altListo) {
      refAlt.current?.focus();
      return;
    }
    void subir(pendientes);
  }

  function cambiarRol(i: number, rol: RolImagen) {
    // Al elegir principal o cursor para una imagen, la que lo tenía pasa a galería.
    const lista = imagenes.map((m, j) => {
      if (j === i) return { ...m, role: rol };
      if (rol !== 'gallery' && m.role === rol) return { ...m, role: 'gallery' as const };
      return m;
    });
    alCambiar(normalizarImagenes(lista));
  }

  const mensaje = falla ?? error;
  return (
    <fieldset className="adm-fieldset">
      <legend>Imágenes</legend>
      {imagenes.length === 0 ? <p className="adm-suave adm-chico">Aún no hay imágenes. Sube la principal primero.</p> : null}
      <ul className="adm-galeria">
        {imagenes.map((m, i) => (
          <li key={m.media_id}>
            {m.ruta ? <img src={`/media/${m.ruta}`} alt={m.alt} /> : <p className="adm-suave adm-chico">Sin vista previa</p>}
            <p className="adm-chico adm-suave">{m.alt}</p>
            <div className="adm-campo">
              <label htmlFor={`${id}-rol-${i}`} className="adm-etiqueta">
                Uso
              </label>
              <select
                id={`${id}-rol-${i}`}
                className="adm-input"
                value={m.role}
                onChange={(e) => cambiarRol(i, e.target.value as RolImagen)}
              >
                {ROLES_IMAGEN.map((r) => (
                  <option key={r} value={r}>
                    {ETIQUETA_ROL_IMAGEN[r]}
                  </option>
                ))}
              </select>
            </div>
            <div className="adm-acciones">
              <button type="button" className="adm-boton adm-boton-secundario adm-boton-chico" aria-label={`Mover imagen ${i + 1} antes`} disabled={i === 0} onClick={() => alCambiar(mover(imagenes, i, -1))}>
                ←
              </button>
              <button type="button" className="adm-boton adm-boton-secundario adm-boton-chico" aria-label={`Mover imagen ${i + 1} después`} disabled={i === imagenes.length - 1} onClick={() => alCambiar(mover(imagenes, i, 1))}>
                →
              </button>
              <button type="button" className="adm-boton adm-boton-secundario adm-boton-chico" onClick={() => alCambiar(normalizarImagenes(imagenes.filter((_, j) => j !== i)))}>
                Quitar
              </button>
            </div>
          </li>
        ))}
      </ul>
      <div className="adm-campo">
        <label htmlFor={`${id}-alt`} className="adm-etiqueta">
          Texto alternativo para las imágenes que subas
        </label>
        <input
          ref={refAlt}
          id={`${id}-alt`}
          className="adm-input"
          value={alt}
          maxLength={200}
          aria-describedby={`${id}-alt-ayuda`}
          placeholder={altSugerido || 'Describe lo que se ve en la imagen'}
          onChange={(e) => setAlt(e.target.value)}
        />
        <p id={`${id}-alt-ayuda`} className="adm-suave adm-chico">
          {TEXTOS_SUBIDA.ayudaAlt} Si lo dejas vacío se usa el nombre del producto.
        </p>
      </div>
      <div className="adm-campo">
        <label htmlFor={`${id}-archivos`} className="adm-etiqueta">
          Subir imágenes
        </label>
        <input
          id={`${id}-archivos`}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,image/avif"
          disabled={subiendo}
          onChange={(e) => {
            alElegir(Array.from(e.target.files ?? []));
            e.target.value = '';
          }}
        />
        <p className="adm-suave adm-chico">
          JPG, PNG, WebP o AVIF; se convierten a WebP al subir. La primera es la principal; la segunda puede ser la de cursor. {subiendo ? 'Subiendo…' : ''}
        </p>
      </div>
      <AvisoAltPendiente
        archivos={pendientes.map((f) => f.name)}
        altListo={altListo}
        subiendo={subiendo}
        alSubir={subirPendientes}
        alDescartar={() => setPendientes([])}
      />
      <AvisoSubida fallo={mensaje} />
    </fieldset>
  );
}
