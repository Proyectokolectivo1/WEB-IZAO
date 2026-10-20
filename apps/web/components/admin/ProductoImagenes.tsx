'use client';

import { useId, useState } from 'react';
import {
  ETIQUETA_ROL_IMAGEN,
  ROLES_IMAGEN,
  mover,
  normalizarImagenes,
  type ImagenForm,
  type RolImagen,
} from '@/lib/admin/catalogo/productos';

type Subida = { id: string; variants: Record<string, string>; alt: string };

/**
 * Galería del producto: subir varias imágenes (texto alternativo obligatorio), elegir principal y de cursor,
 * reordenar y quitar. Sube por `POST /api/admin/media` con recorte 4:5 (§ imágenes).
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
  const [falla, setFalla] = useState<string | null>(null);
  const textoAlt = alt.trim() || altSugerido.trim();

  async function subir(archivos: FileList | null) {
    if (!archivos || archivos.length === 0) return;
    setFalla(null);
    if (textoAlt.length < 3) {
      setFalla('Primero escribe el nombre del producto o un texto alternativo de al menos 3 caracteres.');
      return;
    }
    setSubiendo(true);
    const nuevas: ImagenForm[] = [];
    try {
      for (const archivo of Array.from(archivos)) {
        const datos = new FormData();
        datos.set('file', archivo);
        datos.set('kind', 'product');
        datos.set('alt', textoAlt);
        datos.set('recorte45', 'true');
        const r = await fetch('/api/admin/media', { method: 'POST', body: datos });
        const cuerpo = (await r.json().catch(() => ({}))) as Partial<Subida> & { error?: string };
        if (!r.ok || !cuerpo.id) {
          setFalla(`${archivo.name}: ${cuerpo.error ?? 'no se pudo subir.'}`);
          break;
        }
        nuevas.push({ media_id: cuerpo.id, role: 'gallery', ruta: cuerpo.variants?.['400'] ?? '', alt: cuerpo.alt ?? textoAlt });
      }
    } catch {
      setFalla('No se pudo subir la imagen. Revisa tu conexión.');
    } finally {
      setSubiendo(false);
      if (nuevas.length) alCambiar(normalizarImagenes([...imagenes, ...nuevas]));
    }
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
          id={`${id}-alt`}
          className="adm-input"
          value={alt}
          maxLength={200}
          placeholder={altSugerido || 'Describe lo que se ve en la imagen'}
          onChange={(e) => setAlt(e.target.value)}
        />
      </div>
      <div className="adm-campo">
        <label htmlFor={`${id}-archivos`} className="adm-etiqueta">
          Subir imágenes
        </label>
        <input
          id={`${id}-archivos`}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp"
          disabled={subiendo}
          onChange={(e) => {
            void subir(e.target.files);
            e.target.value = '';
          }}
        />
        <p className="adm-suave adm-chico">
          JPG, PNG o WebP hasta 15 MB. La primera es la principal; la segunda puede ser la de cursor. {subiendo ? 'Subiendo…' : ''}
        </p>
      </div>
      {mensaje ? (
        <p className="adm-error-campo" role="alert">
          {mensaje}
        </p>
      ) : null}
    </fieldset>
  );
}
