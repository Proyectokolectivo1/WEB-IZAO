# Bitácora izao-admin

## Hecho
- Oleada 0: login /admin con MFA, roles, bloqueo, cookie propia (D-018, D-020, D-021).
- T2.5 pipeline de imágenes (`lib/admin/media/`, `POST /api/admin/media`, sharp). Hash: `git log --grep T2.5`.
- T2.6a atributos (marcas, familias, géneros, concentraciones): `git log --grep "T2.6"` (primer commit). Ruta `/admin/atributos/[tipo]/[id|nuevo]` (módulo `catalogo_auxiliar`).
  Piezas reutilizables: `lib/admin/crud/{comun,servidor}.ts` (slug, errores por campo, `adminDeAccion`, `invalidarCatalogo`, `traducirErrorBd`), `components/admin/{SelectorImagen,BotonConfirmar,Campo*,Paginacion,BuscadorLista}`, `app/admin/crud.css`. Acciones nuevas `catalogo.gestionar` y `catalogo.importar` (solo admin).

## Pendiente
- T2.6b categorías (árbol 2 niveles, visibilidad por país, imagen) -> `/admin/categorias`.
- T2.6c productos+variantes+imágenes+SEO+duplicar/archivar -> `/admin/productos`. BLOQUEADO por RPC atómica `admin_guardar_producto` (pedida a izao-db, ya anotada en docs/estado/izao-db.md; avisará).
- T2.6d colecciones y destacados -> `/admin/colecciones`.
- T2.7 import/export CSV+Excel (`exceljs`), RPC `admin_importar_catalogo` (izao-db), imágenes masivas `SKU_1.jpg`.
- Módulo de pagos (Oleada 3): impedir `payment_method_settings` activo con `cod_enabled` falso.

## Decisiones / avisos
- Sin `react-hook-form` (no está instalado): formularios con `useActionState` + zod en servidor; el esquema zod es el mismo del servidor.
- `apps/web/lib/db/` no existe: uso `crearClienteServicio()` con tipos locales.
- Escrituras multi-tabla (producto) requieren RPC transaccional: supabase-js no abre transacciones.
- `MEDIA_ROOT` sin definir en desarrollo usa `apps/web/.media-dev/`. Imágenes se sirven en `/media/<ruta>`.
- Al habilitar un módulo: `disponible: true` en `permissions.ts` y actualizar la lista en `permissions.test.ts`.

## Punto de retoma
T2.6a cerrada y verde. Seguir con categorías (reutilizar el patrón de `atributos`).
