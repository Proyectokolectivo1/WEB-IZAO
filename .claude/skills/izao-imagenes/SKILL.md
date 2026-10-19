---
name: izao-imagenes
description: Úsala al implementar o cambiar la subida, conversión a WebP, almacenamiento o entrega de imágenes de Izao (productos, banners, contenido del sitio, reseñas, garantías) o el componente de imagen responsiva.
---

# Imágenes de Izao

Referencia: `docs/ESPECIFICACION.md` §27.1, tabla `media` en §6.2.

## Subida

- Solo desde el servidor (Route Handler del panel o formulario público). Tipos aceptados por *magic bytes*: JPG, PNG, WebP, AVIF. Máximo 15 MB (videos de garantía: hasta 30 MB, se guardan tal cual en disco, sin convertir).
- Subida múltiple con progreso; arrastrar para reordenar; marcar principal y hover; `alt` obligatorio para publicar.

## Conversión (`sharp`)

1. `.rotate()` por EXIF y eliminación de metadatos.
2. Producto: recorte opcional a 4:5 centrado (el admin puede ajustar el punto focal).
3. WebP calidad 80, `effort: 5`, anchos 400, 800 y 1600 sin agrandar (`withoutEnlargement`).
4. Banners: variantes desktop y móvil se procesan por separado con anchos 800/1600/2400 (desktop) y 400/800/1200 (móvil).
5. LQIP: 16 px de ancho, WebP base64.
6. Escribir en `${MEDIA_ROOT}/{kind}/{yyyy}/{mm}/{uuid}-{ancho}.webp` de forma atómica (archivo temporal + `rename`).
7. Registrar en `media` con `variants`, dimensiones, `lqip`, `bytes`.
8. No conservar la original salvo ajuste "guardar originales".

Procesar en el `worker` (cola `media`) si la imagen supera 5 MB; si no, en línea. Limitar concurrencia de `sharp` a 2 para no ahogar el VPS.

## Entrega

- Nginx sirve `/media/` con `Cache-Control: public, max-age=31536000, immutable`. Los nombres incluyen UUID, así que nunca se sobreescriben.
- Componente `<IzaoImage>` en `packages/ui`: `<img srcset sizes>` con las variantes, LQIP como `background-image`, `width`/`height` para reservar espacio, `loading="lazy"` por defecto, `fetchpriority="high"` y `loading="eager"` solo en la imagen LCP. **No** usar el optimizador en tiempo real de `next/image`.

## Borrado

Al quitar una imagen se marca huérfana; un job semanal borra archivos de `media` sin referencias con más de 7 días.
