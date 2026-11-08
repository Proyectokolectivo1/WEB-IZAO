/**
 * Entrada que esbuild empaqueta para `e2e/admin-subida-mensaje.spec.ts` y `e2e/admin-subida-alt.spec.ts`: monta en el
 * navegador los subidores REALES (`SelectorImagen`, `ProductoImagenes`). El panel completo exige sesión con MFA, que el
 * Supabase falso no simula.
 *
 * `window.__SUBIDA__.modo`: `categoria` (por defecto, alt propio), `banner` (alt en otro campo, como FormularioBanner) o
 * `producto` (galería con varias imágenes).
 */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CampoTexto } from '@/components/admin/CampoTexto';
import { ProductoImagenes } from '@/components/admin/ProductoImagenes';
import { SelectorImagen } from '@/components/admin/SelectorImagen';
import type { ImagenForm } from '@/lib/admin/catalogo/productos';

declare global {
  interface Window {
    __SUBIDA__?: { modo?: 'categoria' | 'banner' | 'producto'; altInicial?: string };
  }
}

function Banner({ altInicial }: { altInicial: string }) {
  const [alt, setAlt] = useState(altInicial);
  return (
    <fieldset className="adm-fieldset">
      <legend>Imagen del banner</legend>
      <p className="adm-suave adm-chico">Sube una sola imagen horizontal y ancha, de 1920 x 700 px.</p>
      <CampoTexto
        id="alt"
        name="alt"
        etiqueta="Texto alternativo"
        value={alt}
        onChange={(e) => setAlt(e.target.value)}
        maxLength={200}
        ayuda="Describe lo que se ve en el banner; lo leen los lectores de pantalla."
      />
      <SelectorImagen
        nombre="desktop_media_id"
        etiqueta="Archivo de imagen"
        kind="banner"
        altControlado={alt}
        idCampoAlt="alt"
        anchoVista={800}
        ayuda="Recomendado 1920 x 700 px."
      />
    </fieldset>
  );
}

function Producto({ altInicial }: { altInicial: string }) {
  const [imagenes, setImagenes] = useState<ImagenForm[]>([]);
  return <ProductoImagenes imagenes={imagenes} alCambiar={setImagenes} altSugerido={altInicial} />;
}

const raiz = document.getElementById('raiz');
if (raiz) {
  const { modo = 'categoria', altInicial = '' } = window.__SUBIDA__ ?? {};
  createRoot(raiz).render(
    <div className="adm">
      {modo === 'banner' ? (
        <Banner altInicial={altInicial} />
      ) : modo === 'producto' ? (
        <Producto altInicial={altInicial} />
      ) : (
        <SelectorImagen nombre="image_id" etiqueta="Imagen de la categoría" kind="category" sugerencia="Árabes" />
      )}
    </div>,
  );
}
