# Bitácora izao-admin

## Hecho
- Oleada 0: login /admin con MFA, roles, bloqueo, cookie propia (D-018, D-020, D-021).
- T2.5 pipeline de imágenes (`lib/admin/media/`, `POST /api/admin/media`, sharp). `git log --grep T2.5`.
- T2.6 (hashes con `git log --grep "T2.6"`):
  - 609a915 atributos: marcas, familias, géneros, concentraciones -> `/admin/atributos/[tipo]/[id|nuevo]` (módulo `catalogo_auxiliar`).
  - 955e990 categorías (2 niveles, visibilidad/orden por país, imagen y banner) -> `/admin/categorias[/id|nueva]`.
  - 4425602 colecciones (manual con orden / por regla) y destacados por país -> `/admin/colecciones[/id|nueva|destacados]`.
- Piezas reutilizables: `lib/admin/crud/{comun,servidor,cliente-falso}.ts` (slug, errores por campo, `adminDeAccion(modulo, accion)`, `invalidarCatalogo/Producto`, `traducirErrorBd`, cliente Supabase falso para pruebas); `components/admin/{SelectorImagen,BotonConfirmar,Campo*,Paginacion,BuscadorLista,PestanasPais}`; `app/admin/crud.css`.
- Patrón por módulo: `lib/admin/catalogo/<x>.ts` (zod + lógica pura) + `<x>-servidor.ts` (BD + auditoría + invalidación, cliente inyectado) + pruebas con `clienteFalso` + `app/admin/(panel)/<ruta>/{page,[id]/page,acciones}.ts(x)`.
- Permisos: acciones `catalogo.gestionar` y `catalogo.importar` (solo admin). Módulos habilitados: atributos, categorías, colecciones (probado en `permissions.test.ts`).

## Pendiente
- T2.6c cerrada (a008f5d): `/admin/productos[/nuevo|/id]`, editor con variantes/imágenes/duplicar/archivar. Sin buscador MasterShop (ids a mano) hasta que izao-logistica exponga `GET /api/products`; falta editar el `alt` de una imagen ya subida; descripción HTML sin sanear (renderizado de la tienda debe sanear).
- T2.7 cerrada (ver commit "T2.7"): `/admin/productos/importar`; API `/api/admin/catalogo/{importar,exportar,plantilla,imagenes}`; `lib/admin/catalogo/{csv,xlsx,zip,archivo,importacion,importacion-servidor}.ts`. Excel y ZIP sin dependencias (node:zlib) para no tocar package.json/lockfile; si se prefiere `exceljs`, solo cambia `xlsx.ts`.
- Falta: importación en el worker con progreso (hoy síncrona por lotes de 200, `maxDuration` 300 s); probar con un .xlsx real de Excel; prueba de humo en navegador (no hay Supabase/MFA local).
- Oleada 3 (pagos): impedir `payment_method_settings` activo con `cod_enabled` falso.

## Decisiones / avisos
- Sin `react-hook-form` (no instalado): formularios con `useActionState` + zod del servidor.
- `apps/web/lib/db/` no existe: uso `crearClienteServicio()` con tipos locales.
- Categorías: guardar categoría + `category_countries` son 2 escrituras (no atómicas); un fallo del segundo se reporta y se puede reintentar.
- `npm build` falla hoy por `apps/web/lib/store/fuentes.ts` (spread en `next/font`, de izao-tienda); mis rutas compilan (build verde antes de ese cambio). Lint, typecheck y test en la raíz: verdes.
- `MEDIA_ROOT` sin definir usa `apps/web/.media-dev/`; las imágenes se sirven en `/media/<ruta>`.
- Al habilitar un módulo: `disponible: true` en `permissions.ts` y actualizar la lista en `permissions.test.ts`.

## Punto de retoma
T2.6a/b/c/d y T2.7 cerradas y verdes (tsc de mis archivos, eslint, vitest 462). Siguiente: lo que asigne el líder (dashboard `izao-metricas`, T4.x) o los pendientes de arriba.
