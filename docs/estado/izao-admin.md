# Bitácora izao-admin

## Hecho
- Oleada 0: login /admin con MFA, roles, bloqueo, cookie propia, factor aprobado (D-018, D-020, D-021).
- T2.5 pipeline de imágenes: ver hash en `git log --grep T2.5`. `apps/web/lib/admin/media/` (validar por magic bytes, procesar con sharp, guardar, registrar) y `POST /api/admin/media` (solo admin). Dependencia nueva: `sharp`.
- `apps/web/lib/admin/auditoria.ts`: `auditarCambio()` genérico para las acciones del panel (usar en todo CRUD).

## Pendiente
- T2.6 CRUD del panel (marcas, familias, géneros, concentraciones, categorías, productos y variantes con precio/stock/visibilidad por país, vínculo MasterShop, imágenes principal/hover/galería, SEO, duplicar/archivar, colecciones y destacados).
- T2.7 importación/exportación CSV y Excel (`exceljs`), flag `izao.skip_catalog_refresh` con refresco por lote (preguntar a izao-db cómo invocarlo desde el servidor), imágenes masivas `SKU_1.jpg`.
- Anotar para el módulo de pagos (Oleada 3): impedir activar contra entrega en `payment_method_settings` mientras `country_settings.cod_enabled` sea falso.

## Siguiente paso exacto
1. Empezar T2.6 por el CRUD simple de marcas (`/admin/marcas`): lista paginada con filtros en la URL, formulario con zod compartido, Server Action con `requerirAdmin({modulo:'marcas'...})` (agregar 'marcas' a `permissions.ts` ya existe como `catalogo_auxiliar`), `auditarCambio`, `revalidateTag`. Reutilizar ese patrón para familias, géneros y concentraciones.
2. Componente de subida de imagen (cliente) que llama a `POST /api/admin/media` con `kind`, `alt` obligatorio y `recorte45`.
3. Dinero: `@izao/core/money` (`fromMajorString`).

## Decisiones / avisos al líder
- `apps/web/lib/db/` (cliente tipado de izao-db) aún no existe; hoy uso `crearClienteServicio()` (`lib/auth/supabase/servicio.ts`) con tipos locales. Cuando exista, migrar.
- Rutas del panel nuevas: agregar sus módulos a `lib/auth/permissions.ts` (hoy solo hay `catalogo_auxiliar`, `productos`, `categorias`, `colecciones`; las rutas deben coincidir con `MODULOS[...].ruta`).
- `MEDIA_ROOT` sin definir en desarrollo usa `apps/web/.media-dev/` (ignorada por git).

## Punto de retoma
T2.5 cerrada y verde (lint, typecheck, test, build). Contexto agotado: retomar en T2.6 con el CRUD de marcas.
